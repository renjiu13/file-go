// file_parts 表：一个文件在 Telegram 上的分片清单。
// 分片本身是私聊/频道里的独立文档消息，tg_file_id 用来 getFile 下载。

export function mapPart(r) {
  return {
    idx: Number(r.idx),
    fileId: r.tg_file_id,
    messageId: r.message_id == null ? null : Number(r.message_id),
    size: Number(r.size),
    sha256: r.sha256 || null,
  };
}

export async function getParts(env, nodeId) {
  const res = await env.DB.prepare(
    'SELECT idx, tg_file_id, message_id, size, sha256 FROM file_parts WHERE node_id = ? ORDER BY idx ASC'
  ).bind(nodeId).all();
  return (res.results || []).map(mapPart);
}

export async function getPart(env, nodeId, idx) {
  const row = await env.DB.prepare(
    'SELECT idx, tg_file_id, message_id, size, sha256 FROM file_parts WHERE node_id = ? AND idx = ?'
  ).bind(nodeId, idx).first();
  return row ? mapPart(row) : null;
}

export async function addPart(env, nodeId, idx, fileId, messageId, size, sha256) {
  await env.DB.prepare(
    `INSERT INTO file_parts (node_id, idx, tg_file_id, message_id, size, sha256)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(nodeId, idx, fileId, messageId ?? null, size, sha256 || null).run();
}

// 待删除的 Telegram 消息：用 batch 一次写多条，避免占满每次调用的查询预算。
export async function queuePendingDeletes(env, messageIds, now = Date.now()) {
  const ids = (messageIds || []).filter((v) => Number.isInteger(v) && v > 0);
  if (!ids.length) return;
  const stmts = ids.map((mid) =>
    env.DB.prepare('INSERT OR IGNORE INTO pending_deletes (message_id, created_at) VALUES (?, ?)').bind(mid, now)
  );
  await env.DB.batch(stmts);
}

export async function listPendingDeletes(env, limit = 40) {
  const res = await env.DB.prepare(
    'SELECT message_id FROM pending_deletes ORDER BY created_at ASC LIMIT ?'
  ).bind(limit).all();
  return (res.results || []).map((r) => Number(r.message_id));
}

export async function dropPendingDeletes(env, messageIds) {
  if (!messageIds.length) return;
  const marks = messageIds.map(() => '?').join(',');
  await env.DB.prepare(`DELETE FROM pending_deletes WHERE message_id IN (${marks})`)
    .bind(...messageIds).run();
}

// 中断上传 / 过期上传：把已上传的分片消息排进删除队列，然后删掉元数据。
export async function abortUpload(env, nodeId, now = Date.now()) {
  const parts = await getParts(env, nodeId);
  const stmts = [];
  for (const part of parts) {
    if (part.messageId) {
      stmts.push(
        env.DB.prepare('INSERT OR IGNORE INTO pending_deletes (message_id, created_at) VALUES (?, ?)')
          .bind(part.messageId, now)
      );
    }
  }
  stmts.push(env.DB.prepare('DELETE FROM file_parts WHERE node_id = ?').bind(nodeId));
  stmts.push(env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(nodeId));
  await env.DB.batch(stmts);
  return parts.length;
}

// 过期的 uploading 节点：一次最多清理 20 个，避免 Cron 超出子请求预算。
export async function expireUploads(env, now = Date.now(), limit = 20) {
  const res = await env.DB.prepare(
    `SELECT id FROM nodes
     WHERE status = 'uploading' AND expires_at IS NOT NULL AND expires_at < ?
     ORDER BY expires_at ASC LIMIT ?`
  ).bind(now, limit).all();
  const nodes = (res.results || []).map((r) => r.id);
  let cleaned = 0;
  for (const id of nodes) {
    const parts = await getParts(env, id);
    const stmts = [];
    for (const part of parts) {
      if (part.messageId) {
        stmts.push(
          env.DB.prepare('INSERT OR IGNORE INTO pending_deletes (message_id, created_at) VALUES (?, ?)')
            .bind(part.messageId, now)
        );
      }
    }
    stmts.push(env.DB.prepare('DELETE FROM file_parts WHERE node_id = ?').bind(id));
    stmts.push(env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(id));
    await env.DB.batch(stmts);
    cleaned += 1;
  }
  return cleaned;
}
