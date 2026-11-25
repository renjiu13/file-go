// nodes 表上的全部目录/文件操作。
//
// 目录树用 parent_id 表示，根目录没有节点（parent_id = NULL）。
// 删除只改元数据（deleted_at/trash_id），Telegram 分片保留；
// 上传中和已删除的节点不出现在正常列表里。

import { genShortId } from '../utils.js';
import { newShortId } from './ids.js';
import {
  DIR_NO_OVERWRITE,
  conflictResult,
  findClash,
  normalizeConflict,
  uniqueName,
} from './naming.js';

export function mapNode(r) {
  if (!r) return null;
  return {
    id: r.id,
    parentId: r.parent_id ?? null,
    kind: r.kind,
    status: r.status,
    name: r.name,
    size: Number(r.size) || 0,
    mime: r.mime || '',
    chunkSize: r.chunk_size ?? null,
    chunkCount: Number(r.chunk_count) || 0,
    replaceId: r.replace_id ?? null,
    expiresAt: r.expires_at ?? null,
    createdAt: Number(r.created_at) || 0,
    updatedAt: Number(r.updated_at) || 0,
    deletedAt: r.deleted_at ?? null,
    trashId: r.trash_id ?? null,
  };
}

export async function getNode(env, id) {
  const row = await env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first();
  return mapNode(row);
}

// 取一个可用目录：必须是未删除、已完成的 dir；根目录用 null
export async function getLiveDir(env, id) {
  if (!id) return { id: null, name: '' };
  const node = await getNode(env, id);
  if (!node || node.kind !== 'dir' || node.status !== 'ready' || node.deletedAt) return null;
  return node;
}

export async function listChildren(env, parentId) {
  const dirsRes = await env.DB.prepare(
    `SELECT id, name, created_at FROM nodes
     WHERE parent_id IS ? AND kind = 'dir' AND status = 'ready' AND deleted_at IS NULL
     ORDER BY name COLLATE NOCASE ASC`
  ).bind(parentId).all();

  const filesRes = await env.DB.prepare(
    `SELECT id, name, size, mime, created_at, chunk_count FROM nodes
     WHERE parent_id IS ? AND kind = 'file' AND status = 'ready' AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC`
  ).bind(parentId).all();

  return {
    dirs: (dirsRes.results || []).map((r) => ({
      id: r.id,
      kind: 'dir',
      name: r.name,
      createdAt: Number(r.created_at) || 0,
    })),
    files: (filesRes.results || []).map((r) => ({
      id: r.id,
      kind: 'file',
      name: r.name,
      size: Number(r.size) || 0,
      mime: r.mime || '',
      createdAt: Number(r.created_at) || 0,
      chunkCount: Number(r.chunk_count) || 0,
    })),
  };
}

// 路径 → 目录节点。逐段查询，路径层级通常只有几层，查询数可控。
// 返回 { id, crumbs: [{id, name, path}] }；中间任意一段不存在返回 null。
export async function resolvePath(env, path) {
  const segs = String(path || '').split('/').filter(Boolean);
  let parentId = null;
  let acc = '';
  const crumbs = [];
  for (const seg of segs) {
    const row = await env.DB.prepare(
      `SELECT id, name FROM nodes
       WHERE parent_id IS ? AND name = ? COLLATE NOCASE
         AND kind = 'dir' AND status = 'ready' AND deleted_at IS NULL
       LIMIT 1`
    ).bind(parentId, seg).first();
    if (!row) return null;
    parentId = row.id;
    acc = acc ? acc + '/' + row.name : row.name;
    crumbs.push({ id: row.id, name: row.name, path: acc });
  }
  return { id: parentId, crumbs };
}

// 全部活跃目录及计算出的路径，供移动/复制弹窗列目录树。
export async function getTree(env) {
  const res = await env.DB.prepare(
    `SELECT id, parent_id, name FROM nodes
     WHERE kind = 'dir' AND status = 'ready' AND deleted_at IS NULL`
  ).all();
  const rows = res.results || [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathCache = new Map();
  const pathOf = (id) => {
    if (pathCache.has(id)) return pathCache.get(id);
    const row = byId.get(id);
    if (!row) return '';
    const parentPath = row.parent_id ? pathOf(row.parent_id) : '';
    const p = parentPath ? parentPath + '/' + row.name : row.name;
    pathCache.set(id, p);
    return p;
  };
  return rows
    .map((r) => ({ id: r.id, path: pathOf(r.id) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
}

export async function createDir(env, parentId, name) {
  const now = Date.now();
  const clash = await findClash(env, parentId, name);
  if (clash) return conflictResult(name, parentId, clash);
  const id = await newShortId(env);
  await env.DB.prepare(
    `INSERT INTO nodes (id, parent_id, kind, status, name, size, mime, chunk_size, chunk_count, created_at, updated_at)
     VALUES (?, ?, 'dir', 'ready', ?, 0, NULL, NULL, 0, ?, ?)`
  ).bind(id, parentId, name, now, now).run();
  return { ok: true, id, name, kind: 'dir' };
}

// 按路径确保目录存在（Webhook 的 caption 用），遇到同名文件时保留两者。
export async function ensureDirPath(env, path) {
  const segs = String(path || '').split('/').filter(Boolean);
  let parentId = null;
  for (const seg of segs) {
    const found = await env.DB.prepare(
      `SELECT id FROM nodes
       WHERE parent_id IS ? AND name = ? COLLATE NOCASE
         AND kind = 'dir' AND status = 'ready' AND deleted_at IS NULL
       LIMIT 1`
    ).bind(parentId, seg).first();
    if (found) {
      parentId = found.id;
      continue;
    }
    const finalName = (await findClash(env, parentId, seg)) ? await uniqueName(env, parentId, seg) : seg;
    const id = await newShortId(env);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO nodes (id, parent_id, kind, status, name, size, mime, chunk_size, chunk_count, created_at, updated_at)
       VALUES (?, ?, 'dir', 'ready', ?, 0, NULL, NULL, 0, ?, ?)`
    ).bind(id, parentId, finalName, now, now).run();
    parentId = id;
  }
  return parentId;
}

// 新建文件节点（上传初始化、Webhook、复制共用）
export async function insertFileNode(env, opts) {
  const now = Date.now();
  const id = opts.id || (await newShortId(env));
  await env.DB.prepare(
    `INSERT INTO nodes (id, parent_id, kind, status, name, size, mime, chunk_size, chunk_count,
                        replace_id, expires_at, created_at, updated_at)
     VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    opts.parentId ?? null,
    opts.status || 'ready',
    opts.name,
    opts.size || 0,
    opts.mime || null,
    opts.chunkSize ?? null,
    opts.chunkCount || 0,
    opts.replaceId ?? null,
    opts.expiresAt ?? null,
    opts.createdAt || now,
    now
  ).run();
  return { id, createdAt: opts.createdAt || now };
}

// 祖先链上是否存在 ancestorId（移动/复制时防环）
export async function isDescendant(env, nodeId, ancestorId) {
  let cur = nodeId;
  for (let guard = 0; cur && guard < 1000; guard++) {
    if (cur === ancestorId) return true;
    const node = await getNode(env, cur);
    cur = node ? node.parentId : null;
  }
  return false;
}

export async function renameNode(env, id, newName, rawConflict = null) {
  const node = await getNode(env, id);
  if (!node || node.deletedAt) return { ok: false, error: '文件不存在' };
  const onConflict = normalizeConflict(rawConflict);
  const clash = await findClash(env, node.parentId, newName, id);

  let finalName = newName;
  let trashClash = null;
  if (clash) {
    if (!onConflict) return conflictResult(newName, node.parentId, clash);
    if (onConflict === 'skip') return { ok: true, skipped: true, id, name: node.name };
    if (onConflict === 'overwrite' || onConflict === 'replace') {
      if (clash.kind === 'dir') return { ok: false, conflict: true, error: DIR_NO_OVERWRITE, clashKind: 'dir' };
      trashClash = clash.id;
    } else {
      finalName = await uniqueName(env, node.parentId, newName, id);
    }
  }

  const now = Date.now();
  try {
    if (trashClash) {
      await env.DB.batch([
        softDeleteStmt(env, trashClash, now),
        env.DB.prepare('UPDATE nodes SET name = ?, updated_at = ? WHERE id = ?')
          .bind(finalName, now, id),
      ]);
    } else {
      await env.DB.prepare('UPDATE nodes SET name = ?, updated_at = ? WHERE id = ?')
        .bind(finalName, now, id).run();
    }
  } catch (err) {
    if (isUniqueError(err)) return conflictResult(finalName, node.parentId, await findClash(env, node.parentId, finalName, id) || clash);
    throw err;
  }
  return { ok: true, id, name: finalName };
}

export async function moveNode(env, id, targetId, rawConflict = null) {
  const node = await getNode(env, id);
  if (!node || node.deletedAt) return { ok: false, error: '文件不存在' };
  const target = await getLiveDir(env, targetId || null);
  if (!target) return { ok: false, error: '目标目录不存在' };
  if ((node.parentId || null) === (target.id || null)) return { ok: false, error: '文件已在该目录中' };
  if (node.kind === 'dir' && (await isDescendant(env, target.id, id))) {
    return { ok: false, error: '不能移动到自身或子文件夹中' };
  }

  const onConflict = normalizeConflict(rawConflict);
  const clash = await findClash(env, target.id, node.name, id);
  let finalName = node.name;
  let trashClash = null;
  if (clash) {
    if (!onConflict) return conflictResult(node.name, target.id, clash);
    if (onConflict === 'skip') return { ok: true, skipped: true, id, name: node.name };
    if (onConflict === 'overwrite' || onConflict === 'replace') {
      if (clash.kind === 'dir') return { ok: false, conflict: true, error: DIR_NO_OVERWRITE, clashKind: 'dir' };
      trashClash = clash.id;
    } else {
      finalName = await uniqueName(env, target.id, node.name, id);
    }
  }

  const now = Date.now();
  try {
    const stmts = [];
    if (trashClash) stmts.push(softDeleteStmt(env, trashClash, now));
    stmts.push(
      env.DB.prepare('UPDATE nodes SET parent_id = ?, name = ?, updated_at = ? WHERE id = ?')
        .bind(target.id, finalName, now, id)
    );
    await env.DB.batch(stmts);
  } catch (err) {
    if (isUniqueError(err)) return conflictResult(finalName, target.id, await findClash(env, target.id, finalName, id) || clash);
    throw err;
  }
  return { ok: true, id, name: finalName, parentId: target.id };
}

// 复制：文件复制分片引用（tg_file_id 复用，message_id 置空，避免以后误删源消息），
// 目录复制用递归 CTE 一次取出整棵子树，按深度批量插入。
export async function copyNode(env, id, targetId, rawConflict = null) {
  const src = await getNode(env, id);
  if (!src || src.deletedAt) return { ok: false, error: '文件不存在' };
  const target = await getLiveDir(env, targetId || null);
  if (!target) return { ok: false, error: '目标目录不存在' };
  if (src.kind === 'dir' && (await isDescendant(env, target.id, id))) {
    return { ok: false, error: '不能复制到自身或子文件夹中' };
  }

  const onConflict = normalizeConflict(rawConflict);
  const clash = await findClash(env, target.id, src.name);
  let finalName = src.name;
  let trashClash = null;
  if (clash) {
    if (!onConflict) return conflictResult(src.name, target.id, clash);
    if (onConflict === 'skip') return { ok: true, skipped: true, id: null, name: src.name };
    if (onConflict === 'overwrite' || onConflict === 'replace') {
      if (clash.kind === 'dir') return { ok: false, conflict: true, error: DIR_NO_OVERWRITE, clashKind: 'dir' };
      trashClash = clash.id;
    } else {
      finalName = await uniqueName(env, target.id, src.name);
    }
  }

  const now = Date.now();
  let newTopId;

  if (src.kind === 'file') {
    newTopId = genShortId(16);
    const stmts = [];
    if (trashClash) stmts.push(softDeleteStmt(env, trashClash, now));
    stmts.push(
      env.DB.prepare(
        `INSERT INTO nodes (id, parent_id, kind, status, name, size, mime, chunk_size, chunk_count, created_at, updated_at)
         VALUES (?, ?, 'file', 'ready', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newTopId, target.id, finalName, src.size, src.mime || null, src.chunkSize, src.chunkCount, now, now)
    );
    stmts.push(
      env.DB.prepare(
        `INSERT INTO file_parts (node_id, idx, tg_file_id, message_id, size, sha256)
         SELECT ?, idx, tg_file_id, NULL, size, sha256 FROM file_parts WHERE node_id = ?`
      ).bind(newTopId, id)
    );
    try {
      await env.DB.batch(stmts);
    } catch (err) {
      if (isUniqueError(err)) return conflictResult(finalName, target.id, await findClash(env, target.id, finalName) || clash);
      throw err;
    }
    return { ok: true, id: newTopId, name: finalName, kind: 'file' };
  }

  // 目录：一次查询取出整棵子树（不含已删除节点）
  const subRes = await env.DB.prepare(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM nodes WHERE id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
       WHERE n.deleted_at IS NULL
     )
     SELECT id, parent_id, kind, status, name, size, mime, chunk_size, chunk_count, created_at
     FROM nodes WHERE id IN (SELECT id FROM sub)`
  ).bind(id).all();
  const rows = subRes.results || [];
  if (!rows.length) return { ok: false, error: '文件不存在' };

  const partsRes = await env.DB.prepare(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM nodes WHERE id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
       WHERE n.deleted_at IS NULL
     )
     SELECT node_id, idx, tg_file_id, size, sha256
     FROM file_parts WHERE node_id IN (SELECT id FROM sub)`
  ).bind(id).all();
  const parts = partsRes.results || [];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const depthOf = (rid) => {
    let depth = 0;
    let cur = byId.get(rid);
    while (cur && cur.parent_id) {
      depth++;
      cur = byId.get(cur.parent_id);
    }
    return depth;
  };
  const newIds = new Map();
  for (const row of rows) newIds.set(row.id, genShortId(16));

  const ordered = rows.slice().sort((a, b) => depthOf(a.id) - depthOf(b.id));
  const nodeStmts = [];
  if (trashClash) nodeStmts.push(softDeleteStmt(env, trashClash, now));

  for (const row of ordered) {
    const isTop = row.id === id;
    const newParent = isTop ? target.id : newIds.get(row.parent_id) || target.id;
    nodeStmts.push(
      env.DB.prepare(
        `INSERT INTO nodes (id, parent_id, kind, status, name, size, mime, chunk_size, chunk_count, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        newIds.get(row.id),
        newParent,
        row.kind,
        isTop ? finalName : row.name,
        Number(row.size) || 0,
        row.mime || null,
        row.chunk_size ?? null,
        Number(row.chunk_count) || 0,
        Number(row.created_at) || now,
        now
      )
    );
    if (isTop) newTopId = newIds.get(row.id);
  }

  for (const part of parts) {
    nodeStmts.push(
      env.DB.prepare(
        `INSERT INTO file_parts (node_id, idx, tg_file_id, message_id, size, sha256)
         VALUES (?, ?, ?, NULL, ?, ?)`
      ).bind(newIds.get(part.node_id), part.idx, part.tg_file_id, part.size, part.sha256 ?? null)
    );
  }

  try {
    for (let i = 0; i < nodeStmts.length; i += 40) {
      await env.DB.batch(nodeStmts.slice(i, i + 40));
    }
  } catch (err) {
    if (isUniqueError(err)) return conflictResult(finalName, target.id, await findClash(env, target.id, finalName) || clash);
    throw err;
  }
  return { ok: true, id: newTopId, name: finalName, kind: 'dir' };
}

// 递归软删除整棵子树：所有节点标记 deleted_at 并共享顶层节点的 trash_id。
// 导出成语句是为了能和「上传完成」的改名放在同一个 D1 batch 里。
export function softDeleteStmt(env, id, now) {
  return env.DB.prepare(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM nodes WHERE id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
       WHERE n.deleted_at IS NULL
     )
     UPDATE nodes SET deleted_at = ?, trash_id = ?, updated_at = ?
     WHERE id IN (SELECT id FROM sub)`
  ).bind(id, now, id, now);
}

export async function softDelete(env, id, now = Date.now()) {
  const node = await getNode(env, id);
  if (!node || node.deletedAt) return { ok: false, error: '文件不存在' };
  const res = await softDeleteStmt(env, id, now).run();
  return {
    ok: true,
    id,
    name: node.name,
    kind: node.kind,
    count: Number(res && res.meta && res.meta.changes) || 1,
  };
}

// 回收站按 trash_id 恢复整组；同名时按「保留两者」自动改名。
export async function restoreNode(env, id) {
  const node = await getNode(env, id);
  if (!node || !node.deletedAt) return { ok: false, error: '文件不在回收站' };
  if (node.trashId !== node.id) return { ok: false, error: '请恢复回收站中的顶层项' };

  let parent = null;
  if (node.parentId) {
    parent = await getNode(env, node.parentId);
    if (!parent || parent.deletedAt || parent.kind !== 'dir') {
      return { ok: false, error: '原上级目录已不存在' };
    }
  }

  let finalName = node.name;
  if (await findClash(env, node.parentId, node.name)) {
    finalName = await uniqueName(env, node.parentId, node.name, id);
  }

  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE nodes SET name = ?, updated_at = ? WHERE id = ?')
        .bind(finalName, now, id),
      env.DB.prepare('UPDATE nodes SET deleted_at = NULL, trash_id = NULL, updated_at = ? WHERE trash_id = ?')
        .bind(now, id),
    ]);
  } catch (err) {
    if (isUniqueError(err)) return { ok: false, conflict: true, error: '恢复时命名冲突，请重试' };
    throw err;
  }
  return { ok: true, id, name: finalName, parentId: parent ? parent.id : null };
}

// 回收站列表：只显示顶层项（id = trash_id），按删除日期分组。
export async function getTrashList(env) {
  const res = await env.DB.prepare(
    `SELECT * FROM nodes WHERE deleted_at IS NOT NULL AND id = trash_id
     ORDER BY deleted_at DESC, id DESC`
  ).all();
  const rows = res.results || [];
  if (!rows.length) return [];

  const allRes = await env.DB.prepare('SELECT id, parent_id, name FROM nodes').all();
  const byId = new Map((allRes.results || []).map((r) => [r.id, r]));
  const pathOf = (nid) => {
    let acc = '';
    let cur = byId.get(nid);
    for (let guard = 0; cur && guard < 1000; guard++) {
      acc = acc ? cur.name + '/' + acc : cur.name;
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
    }
    return acc;
  };

  const groups = new Map();
  for (const row of rows) {
    const node = mapNode(row);
    const date = beijingDate(node.deletedAt);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push({
      id: node.id,
      kind: node.kind,
      name: node.name,
      size: node.size,
      mime: node.mime,
      originalPath: pathOf(node.id),
      deletedAt: node.deletedAt,
      trashDate: date,
    });
  }
  return Array.from(groups, ([date, items]) => ({ date, items })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function beijingDate(ts) {
  const d = new Date((Number(ts) || Date.now()) + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function isUniqueError(err) {
  return /UNIQUE constraint failed/i.test(String(err && err.message ? err.message : err));
}

