// 极简 WebDAV 挂载点（/dav），给“改个小文件”这种场景用。
//
// 设计取舍：
//   - 认证用 Basic，用户名/口令默认都是 filego，可用 WEBDAV_USER / WEBDAV_PASS 覆盖；
//     与网页登录（PASSWORD_HASH）完全独立，便于只在需要时挂载。
//   - 只接受 ≤16 MiB 的 PUT（一个分片），直接流式转发给 Telegram，不落内存；
//     更大的文件返回 413，让用户走网页的分片上传。
//   - PROPPATCH / LOCK / UNLOCK 只回最小可用的合法响应，不持久化锁；
//     Finder / Windows 资源管理器 / rclone 这类客户端能正常挂载、读写、改名。
//   - 所有元数据操作仍然走 nodes 表，因此和网页端完全一致（回收站、命名规则、复制共享分片）。
import { guessMime, nameError, DEFAULT_CHUNK_SIZE } from './utils.js';
import {
  copyNode,
  createDir,
  getChild,
  getNode,
  listChildren,
  moveNode,
  renameNode,
  softDelete,
  insertFileNode,
} from './db/nodes.js';
import { addPart } from './db/parts.js';
import { multipartLength, uploadPartToChannel } from './telegram.js';
import { serveNode } from './routes/file.js';

export const DAV_PREFIX = '/dav';
export const DAV_MAX_PUT = DEFAULT_CHUNK_SIZE;
export const DAV_ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK';

const DAV_HEADERS = { DAV: '1, 2', Allow: DAV_ALLOW };

function davHeaders(extra) {
  return { ...DAV_HEADERS, ...(extra || {}) };
}

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xml(discovery, status) {
  return new Response(discovery, {
    status: status || 207,
    headers: davHeaders({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' }),
  });
}

function statusResponse(status, text) {
  return new Response(text == null ? null : text, {
    status,
    headers: davHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }),
  });
}

// ---- Basic 认证 ----

function davCredentials(env) {
  return {
    user: String(env.WEBDAV_USER || 'filego'),
    pass: String(env.WEBDAV_PASS || 'filego'),
  };
}

function constantTimeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function basicAuthorized(env, request) {
  const header = request.headers.get('Authorization') || '';
  if (!/^Basic /i.test(header)) return false;
  let raw = '';
  try {
    raw = atob(header.replace(/^Basic\s+/i, '').trim());
  } catch (_err) {
    return false;
  }
  const idx = raw.indexOf(':');
  if (idx < 0) return false;
  const user = raw.slice(0, idx);
  const pass = raw.slice(idx + 1);
  const want = davCredentials(env);
  return constantTimeEqual(user, want.user) && constantTimeEqual(pass, want.pass);
}

function challenge() {
  return new Response('需要 WebDAV 认证', {
    status: 401,
    headers: davHeaders({
      'WWW-Authenticate': 'Basic realm="File-Go WebDAV", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    }),
  });
}

// ---- 路径 ----

function segmentsOf(url) {
  const rest = url.pathname.slice(DAV_PREFIX.length);
  return rest
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch (_err) {
        return s;
      }
    });
}

function hrefOf(segs, isDir) {
  const body = segs.map(encodeURIComponent).join('/');
  return DAV_PREFIX + '/' + body + (isDir && body ? '/' : '');
}

// 逐段走下来，返回 { node, parentId }；缺任意一层返回 null。
// node 为 null 表示“父目录存在但末段不存在”（PUT 新建用）。
async function resolveDav(env, segs) {
  if (!segs.length) return { node: null, parentId: null, exists: true };
  let parentId = null;
  for (let i = 0; i < segs.length; i++) {
    const child = await getChild(env, parentId, segs[i]);
    const last = i === segs.length - 1;
    if (!child) {
      if (last) return { node: null, parentId, exists: false };
      return null;
    }
    if (!last) {
      if (child.kind !== 'dir') return null;
      parentId = child.id;
      continue;
    }
    return { node: child, parentId, exists: true };
  }
  return null;
}

// ---- PROPFIND ----

function propXml(node, segs) {
  const isDir = node.kind === 'dir';
  const modified = new Date(node.updatedAt || node.createdAt || Date.now()).toUTCString();
  const etag = '"' + node.id + '"';
  let props =
    '<D:displayname>' + xmlEscape(node.name) + '</D:displayname>' +
    '<D:getlastmodified>' + modified + '</D:getlastmodified>' +
    '<D:getetag>' + etag + '</D:getetag>' +
    '<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope>' +
    '<D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>' +
    '<D:lockdiscovery/>';
  if (isDir) {
    props += '<D:resourcetype><D:collection/></D:resourcetype>';
  } else {
    props +=
      '<D:resourcetype/>' +
      '<D:getcontentlength>' + Number(node.size) + '</D:getcontentlength>' +
      '<D:getcontenttype>' + xmlEscape(node.mime || guessMime(node.name) || 'application/octet-stream') + '</D:getcontenttype>';
  }
  return (
    '<D:response><D:href>' + xmlEscape(hrefOf(segs, isDir)) + '</D:href>' +
    '<D:propstat><D:prop>' + props + '</D:prop>' +
    '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
  );
}

function multistatus(body) {
  return xml('<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">' + body + '</D:multistatus>');
}

// ---- 主入口 ----

export async function handleDav(env, request, url) {
  if (!basicAuthorized(env, request)) return challenge();

  const method = request.method;
  const segs = segmentsOf(url);

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: davHeaders({ 'MS-Author-Via': 'DAV' }) });
  }

  if (method === 'PROPFIND') {
    const found = await resolveDav(env, segs);
    if (!found) return statusResponse(404, '路径不存在');
    const { node } = found;
    const depth = String(request.headers.get('Depth') || 'infinity').toLowerCase();

    if (!node) {
      if (segs.length) return statusResponse(404, '路径不存在');
      // 根目录：库里的 parent_id 为 NULL 的那一层
      let body =
        '<D:response><D:href>' + DAV_PREFIX + '/</D:href><D:propstat><D:prop>' +
        '<D:displayname>File-Go</D:displayname>' +
        '<D:resourcetype><D:collection/></D:resourcetype>' +
        '<D:supportedlock/>' +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
      if (depth !== '0') {
        const children = await listChildren(env, null);
        const rows = children.dirs.map((d) => ({ id: d.id, kind: 'dir', name: d.name, createdAt: d.createdAt }))
          .concat(children.files);
        for (const child of rows) body += propXml(child, [child.name]);
      }
      return multistatus(body);
    }

    let body = propXml(node, segs);
    if (node.kind === 'dir' && depth !== '0') {
      const children = await listChildren(env, node.id);
      const rows = children.dirs.map((d) => ({ id: d.id, kind: 'dir', name: d.name, createdAt: d.createdAt }))
        .concat(children.files);
      for (const child of rows) body += propXml(child, segs.concat([child.name]));
    }
    return multistatus(body);
  }

  if (method === 'PROPPATCH') {
    // 不持久化属性，但回 207 让客户端认为成功，避免反复重试
    const names = [];
    try {
      const text = await request.text();
      const re = /<([A-Za-z0-9]+:)?([A-Za-z0-9_.-]+)[^>]*>/g;
      let m;
      while ((m = re.exec(text))) {
        if (m[2] === 'propertyupdate' || m[2] === 'set' || m[2] === 'remove' || m[2] === 'prop') continue;
        names.push(m[2]);
      }
    } catch (_err) {
      /* 忽略请求体解析失败 */
    }
    const props = names.slice(0, 20).map((n) => '<D:' + n + '/>').join('');
    return multistatus(
      '<D:response><D:href>' + xmlEscape(hrefOf(segs, true)) + '</D:href>' +
      '<D:propstat><D:prop>' + props + '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
    );
  }

  if (method === 'GET' || method === 'HEAD') {
    if (!segs.length) return statusResponse(405, '目录不支持 GET');
    const found = await resolveDav(env, segs);
    if (!found || !found.node) return statusResponse(404, '文件不存在');
    if (found.node.kind !== 'file') return statusResponse(405, '目录不支持 GET');
    const node = await getNode(env, found.node.id);
    return serveNode(env, node, request, url, {});
  }

  if (method === 'PUT') {
    if (!segs.length) return statusResponse(405, '不能覆盖根目录');
    const name = segs[segs.length - 1];
    const bad = nameError(name);
    if (bad) return statusResponse(400, bad);
    const found = await resolveDav(env, segs);
    if (!found) return statusResponse(409, '父目录不存在');
    if (found.node && found.node.kind === 'dir') return statusResponse(405, '同名目录已存在');

    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > DAV_MAX_PUT) {
      return statusResponse(413, `WebDAV 单次上传上限 ${DAV_MAX_PUT} 字节，更大的文件请用网页端分片上传`);
    }
    if (!request.body) return statusResponse(400, '缺少请求体');

    let stream = request.body;
    let size = declared;
    if (!size) {
      const buf = new Uint8Array(await request.arrayBuffer());
      size = buf.length;
      if (size > DAV_MAX_PUT) {
        return statusResponse(413, `WebDAV 单次上传上限 ${DAV_MAX_PUT} 字节，更大的文件请用网页端分片上传`);
      }
      stream = new Blob([buf]).stream();
    }
    if (!size) return statusResponse(400, '文件为空');

    const boundary = '----tgpart' + crypto.randomUUID().replace(/-/g, '');
    const total = multipartLength(env, size, name, boundary);
    let uploaded;
    try {
      uploaded = await uploadPartToChannel(env, stream, total, name, boundary);
    } catch (err) {
      if (err.telegramStatus === 429) return statusResponse(429, 'Telegram 限流，请稍后重试');
      return statusResponse(502, 'Telegram 上传失败');
    }

    // 覆盖已有文件：先软删（消息进待删队列），再建同名新节点
    let replaced = false;
    if (found.node) {
      await softDelete(env, found.node.id);
      replaced = true;
    }
    const { id } = await insertFileNode(env, {
      parentId: found.parentId,
      name,
      size,
      mime: guessMime(name) || 'application/octet-stream',
      chunkSize: size,
      chunkCount: 1,
    });
    await addPart(env, id, 0, uploaded.fileId, uploaded.messageId, size, null);
    return new Response(null, {
      status: replaced ? 204 : 201,
      headers: davHeaders({ 'Cache-Control': 'no-store' }),
    });
  }

  if (method === 'MKCOL') {
    if (!segs.length) return statusResponse(405, '根目录已存在');
    const name = segs[segs.length - 1];
    const bad = nameError(name);
    if (bad) return statusResponse(400, bad);
    const found = await resolveDav(env, segs);
    if (!found) return statusResponse(409, '父目录不存在');
    if (found.node) return statusResponse(405, '同名资源已存在');
    const created = await createDir(env, found.parentId, name);
    if (!created.ok) return statusResponse(409, created.error || '创建失败');
    return new Response(null, { status: 201, headers: davHeaders({ 'Cache-Control': 'no-store' }) });
  }

  if (method === 'DELETE') {
    if (!segs.length) return statusResponse(405, '不能删除根目录');
    const found = await resolveDav(env, segs);
    if (!found || !found.node) return statusResponse(404, '资源不存在');
    const res = await softDelete(env, found.node.id);
    if (!res.ok) return statusResponse(500, res.error || '删除失败');
    return new Response(null, { status: 204, headers: davHeaders({ 'Cache-Control': 'no-store' }) });
  }

  if (method === 'MOVE' || method === 'COPY') {
    const dest = request.headers.get('Destination');
    if (!dest) return statusResponse(400, '缺少 Destination 头');
    let destUrl;
    try {
      destUrl = new URL(dest, url.origin);
    } catch (_err) {
      return statusResponse(400, 'Destination 无法解析');
    }
    if (!destUrl.pathname.startsWith(DAV_PREFIX + '/')) return statusResponse(502, 'Destination 不在 /dav 下');
    const destSegs = segmentsOf(destUrl);
    if (!destSegs.length) return statusResponse(405, '目标不能是根目录');

    const source = await resolveDav(env, segs);
    if (!source || !source.node) return statusResponse(404, '源不存在');
    const target = await resolveDav(env, destSegs);
    if (!target) return statusResponse(409, '目标目录不存在');

    const overwrite = String(request.headers.get('Overwrite') || 'T').toUpperCase() !== 'F';
    if (target.node && !overwrite) return statusResponse(412, '目标已存在且 Overwrite: F');
    if (target.node && target.node.id === source.node.id) return statusResponse(403, '源与目标相同');

    const destName = destSegs[destSegs.length - 1];
    const badName = nameError(destName);
    if (badName) return statusResponse(400, badName);

    const policy = overwrite ? 'overwrite' : 'skip';
    const srcName = source.node.name;
    const renaming = srcName !== destName;
    const srcParent = source.node.parentId || null;
    const dstParent = target.parentId || null;

    if (method === 'MOVE') {
      // 同一目录内换名：等价于 rename；跨目录：先 move 再 rename。
      // 换名时先按 keep-both 搬过去，最后一步再按策略覆盖目标，避免误删同名但不同名的项。
      if (srcParent === dstParent) {
        const renamed = await renameNode(env, source.node.id, destName, policy);
        if (!renamed.ok) return statusResponse(renamed.conflict ? 412 : 400, renamed.error || '重命名失败');
        return new Response(null, { status: 204, headers: davHeaders({ 'Cache-Control': 'no-store' }) });
      }
      const moved = await moveNode(env, source.node.id, dstParent, renaming ? 'keep-both' : policy);
      if (!moved.ok) return statusResponse(moved.conflict ? 412 : 400, moved.error || '移动失败');
      if (renaming) {
        const renamed = await renameNode(env, source.node.id, destName, policy);
        if (!renamed.ok) return statusResponse(renamed.conflict ? 412 : 400, renamed.error || '重命名失败');
      }
      return new Response(null, { status: 204, headers: davHeaders({ 'Cache-Control': 'no-store' }) });
    }

    // 复制：先 keep-both 复制到目标目录，再改名并按策略覆盖目标
    const copied = await copyNode(env, source.node.id, dstParent, renaming ? 'keep-both' : policy);
    if (!copied.ok) return statusResponse(copied.conflict ? 412 : 400, copied.error || '复制失败');
    if (renaming) {
      if (target.node) await softDelete(env, target.node.id);
      const renamed = await renameNode(env, copied.id, destName, policy);
      if (!renamed.ok) return statusResponse(renamed.conflict ? 412 : 400, renamed.error || '复制后重命名失败');
    }
    return new Response(null, { status: target.node ? 204 : 201, headers: davHeaders({ 'Cache-Control': 'no-store' }) });
  }

  if (method === 'LOCK') {
    const token = 'opaquelocktoken:' + crypto.randomUUID();
    return new Response(
      '<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>' +
        '<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>' +
        '<D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout>' +
        '<D:locktoken><D:href>' + token + '</D:href></D:locktoken>' +
        '</D:activelock></D:lockdiscovery></D:prop>',
      {
        status: 200,
        headers: davHeaders({
          'Content-Type': 'application/xml; charset=utf-8',
          'Lock-Token': '<' + token + '>',
          'Cache-Control': 'no-store',
        }),
      }
    );
  }

  if (method === 'UNLOCK') {
    return new Response(null, { status: 204, headers: davHeaders({ 'Cache-Control': 'no-store' }) });
  }

  return statusResponse(405, '不支持的方法');
}
