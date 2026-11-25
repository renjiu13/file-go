// 分片上传：init → 若干 part → complete。
//
// Worker 在这里只做三件事：命名与冲突的权威判断、把请求体流式转给 Telegram、
// 把 file_id/message_id 写进 file_parts。哈希由浏览器算好放在请求头里。

import { DEFAULT_CHUNK_SIZE, json, sanitizeName } from '../utils.js';
import {
  DIR_NO_OVERWRITE,
  conflictResult,
  findClash,
  normalizeConflict,
  uniqueName,
} from '../db/naming.js';
import {
  getNode,
  getLiveDir,
  insertFileNode,
  isUniqueError,
  softDeleteStmt,
} from '../db/nodes.js';
import { abortUpload, addPart, getPart, getParts } from '../db/parts.js';
import { multipartLength, uploadPartToChannel } from '../telegram.js';
import { conflictOpts, NO_STORE, readJson } from './common.js';

export const UPLOAD_TTL_MS = 24 * 3600 * 1000;

// 单个文件上限只做防呆；真正的约束是分片数与 Telegram 配额
const MAX_FILE_SIZE = 1024 * 1024 * 1024 * 1024; // 1 TiB

function expectedPartSize(node, idx) {
  if (idx === node.chunkCount - 1) return node.size - idx * node.chunkSize;
  return node.chunkSize;
}

export async function handleInit(env, request) {
  const body = await readJson(request);
  if (!body) return json({ error: '请求格式错误' }, 400, NO_STORE);

  const parent = await getLiveDir(env, body.parentId || null);
  if (!parent) return json({ error: '目标目录不存在' }, 404, NO_STORE);

  const name = sanitizeName(body.name || '');
  if (!name) return json({ error: '文件名不能为空' }, 400, NO_STORE);

  const size = Number(body.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    return json({ error: '文件大小不合法（空文件不支持上传）' }, 400, NO_STORE);
  }
  if (size > MAX_FILE_SIZE) return json({ error: '文件过大' }, 400, NO_STORE);

  const mime = typeof body.mime === 'string' && body.mime
    ? body.mime.slice(0, 200)
    : null;

  const mode = normalizeConflict(conflictOpts(body));
  const clash = await findClash(env, parent.id, name);
  if (clash && !mode) return json(conflictResult(name, parent.id, clash), 409, NO_STORE);
  if (clash && (mode === 'overwrite' || mode === 'replace') && clash.kind === 'dir') {
    return json({ ok: false, conflict: true, error: DIR_NO_OVERWRITE, clashKind: 'dir' }, 400, NO_STORE);
  }
  if (clash && mode === 'skip') {
    return json({ ok: true, skipped: true, name: clash.name }, 200, NO_STORE);
  }

  let finalName = name;
  let replaceId = null;
  if (clash) {
    if (mode === 'overwrite' || mode === 'replace') {
      finalName = clash.name;
      replaceId = clash.id;
    } else {
      finalName = await uniqueName(env, parent.id, name);
    }
  }

  const chunkSize = Math.min(size, DEFAULT_CHUNK_SIZE);
  const chunkCount = Math.max(1, Math.ceil(size / chunkSize));
  const expiresAt = Date.now() + UPLOAD_TTL_MS;

  const { id } = await insertFileNode(env, {
    parentId: parent.id,
    name: finalName,
    size,
    mime,
    status: 'uploading',
    chunkSize,
    chunkCount,
    replaceId,
    expiresAt,
  });

  return json({
    ok: true,
    id,
    name: finalName,
    size,
    mime,
    chunkSize,
    chunkCount,
    expiresAt,
    replaced: replaceId ? clash.name : null,
  }, 200, NO_STORE);
}

export async function handlePart(env, request, id, idxRaw) {
  const node = await getNode(env, id);
  if (!node || node.kind !== 'file' || node.deletedAt) {
    return json({ error: '上传不存在' }, 404, NO_STORE);
  }
  if (node.status !== 'uploading') {
    return json({ error: '上传已结束' }, 409, NO_STORE);
  }
  if (node.expiresAt && node.expiresAt < Date.now()) {
    await abortUpload(env, id);
    return json({ error: '上传会话已过期，请重新上传' }, 410, NO_STORE);
  }

  const idx = Number(idxRaw);
  if (!Number.isInteger(idx) || idx < 0 || idx >= node.chunkCount) {
    return json({ error: '分片序号不合法' }, 400, NO_STORE);
  }

  const expected = expectedPartSize(node, idx);
  if (expected <= 0) return json({ error: '分片大小不合法' }, 400, NO_STORE);

  const sha = String(request.headers.get('X-Part-SHA256') || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    return json({ error: '缺少或非法的 X-Part-SHA256 请求头' }, 400, NO_STORE);
  }

  // 浏览器不保证带 Content-Length（HTTP/2 下可能缺失），缺失时按 init 记录的
  // 期望分片大小转发；带了就必须与期望完全一致，避免错位拼接。
  const declared = request.headers.get('Content-Length');
  if (declared !== null && declared !== '') {
    const n = Number(declared);
    if (!Number.isInteger(n) || n !== expected) {
      return json({ error: `分片大小不匹配：期望 ${expected}，收到 ${declared}` }, 400, NO_STORE);
    }
  }

  // 幂等：同序号同哈希直接成功；哈希不同说明是另一份内容，拒绝覆盖
  const existing = await getPart(env, id, idx);
  if (existing) {
    if (existing.sha256 && existing.sha256 !== sha) {
      return json({ error: '该分片已存在且内容不同', idx, sha256: existing.sha256 }, 409, NO_STORE);
    }
    return json({ ok: true, existing: true, idx, size: existing.size, sha256: existing.sha256 || sha }, 200, NO_STORE);
  }

  if (!request.body) return json({ error: '缺少分片内容' }, 400, NO_STORE);

  const boundary = '----tgpart' + crypto.randomUUID().replace(/-/g, '');
  const filename = `${node.name}.part${idx}`;
  const total = multipartLength(env, expected, filename, boundary);

  let uploaded;
  try {
    uploaded = await uploadPartToChannel(env, request.body, total, filename, boundary);
  } catch (err) {
    if (err.telegramStatus === 429) {
      return json({ error: 'Telegram 限流，请稍后重试' }, 429, {
        ...NO_STORE,
        'Retry-After': String(err.retryAfter || 5),
      });
    }
    return json({ error: err.message || '转发到 Telegram 失败' }, 502, NO_STORE);
  }

  try {
    await addPart(env, id, idx, uploaded.fileId, uploaded.messageId, expected, sha);
  } catch (err) {
    if (isUniqueError(err)) {
      const again = await getPart(env, id, idx);
      if (again && (!again.sha256 || again.sha256 === sha)) {
        return json({ ok: true, existing: true, idx, size: again.size, sha256: again.sha256 || sha }, 200, NO_STORE);
      }
      return json({ error: '该分片已存在且内容不同' }, 409, NO_STORE);
    }
    throw err;
  }

  return json({ ok: true, idx, size: expected, sha256: sha }, 200, NO_STORE);
}

export async function handleComplete(env, request, id) {
  const node = await getNode(env, id);
  if (!node || node.kind !== 'file' || node.deletedAt) {
    return json({ error: '上传不存在' }, 404, NO_STORE);
  }
  if (node.status === 'ready') {
    return json({ ok: true, already: true, id, name: node.name }, 200, NO_STORE);
  }

  const parts = await getParts(env, id);
  const byIdx = new Map(parts.map((p) => [p.idx, p]));
  const missing = [];
  const bad = [];
  for (let i = 0; i < node.chunkCount; i++) {
    const part = byIdx.get(i);
    if (!part) {
      missing.push(i);
    } else if (part.size !== expectedPartSize(node, i)) {
      bad.push({ idx: i, size: part.size, expected: expectedPartSize(node, i) });
    }
  }
  if (missing.length || bad.length) {
    return json({ ok: false, error: '分片不完整，不能完成上传', missing, bad }, 409, NO_STORE);
  }

  const target = node.replaceId ? await getNode(env, node.replaceId) : null;
  let name = node.name;

  // 唯一索引冲突时改名重试；replace 目标的软删除与改名放在同一个 batch 里
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = Date.now();
    const stmts = [];
    if (target && !target.deletedAt && target.id !== id) {
      stmts.push(softDeleteStmt(env, target.id, now));
    }
    stmts.push(
      env.DB.prepare(
        `UPDATE nodes SET status = 'ready', name = ?, replace_id = NULL, expires_at = NULL, updated_at = ?
         WHERE id = ?`
      ).bind(name, now, id)
    );
    try {
      await env.DB.batch(stmts);
      return json({ ok: true, id, name, attempts: attempt + 1 }, 200, NO_STORE);
    } catch (err) {
      if (!isUniqueError(err)) throw err;
      name = await uniqueName(env, node.parentId, name, id);
    }
  }
  return json({ ok: false, error: '命名冲突，完成上传失败' }, 409, NO_STORE);
}

export async function handleStatus(env, id) {
  const node = await getNode(env, id);
  if (!node || node.kind !== 'file' || node.deletedAt) {
    return json({ error: '上传不存在' }, 404, NO_STORE);
  }
  const parts = await getParts(env, id);
  return json({
    ok: true,
    node: {
      id: node.id,
      name: node.name,
      size: node.size,
      mime: node.mime,
      chunkSize: node.chunkSize,
      chunkCount: node.chunkCount,
      status: node.status,
      expiresAt: node.expiresAt,
    },
    parts: parts.map((p) => ({ idx: p.idx, size: p.size, sha256: p.sha256 })),
  }, 200, NO_STORE);
}

export async function handleAbort(env, request, id) {
  const node = await getNode(env, id);
  if (!node || node.deletedAt) return json({ error: '上传不存在' }, 404, NO_STORE);
  if (node.status === 'ready') return json({ error: '已完成的文件不能中止' }, 409, NO_STORE);
  const count = await abortUpload(env, id);
  return json({ ok: true, id, parts: count }, 200, NO_STORE);
}
