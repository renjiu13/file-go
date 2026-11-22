// files 表读写：上传落库（可带幂等账本）、幂等重放记录、单个文件元信息。

export async function saveFile(env, meta) {
  const insert = env.DB.prepare(
    `INSERT INTO files (id, file_id, message_id, name, size, mime, path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      meta.id,
      meta.fileId,
      meta.messageId || null,
      meta.name,
      meta.size || 0,
      meta.mime || '',
      meta.path || '',
      meta.createdAt || Date.now()
    );

  // 带幂等键时与文件记录同事务落账，之后重试只会重放这一次的结果
  if (!meta.uploadKey) {
    await insert.run();
    return;
  }

  await env.DB.batch([
    insert,
    env.DB.prepare(
      `INSERT OR IGNORE INTO upload_ledger (upload_key, file_ref, name, size, path, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(meta.uploadKey, meta.id, meta.name, meta.size || 0, meta.path || '', Date.now()),
  ]);
}

// 幂等键对应的首次上传结果；重试请求命中它就不会在 Telegram 再存一份
export async function getUploadRecord(env, uploadKey) {
  if (!uploadKey) return null;
  const row = await env.DB.prepare(
    'SELECT file_ref, name, size, path FROM upload_ledger WHERE upload_key = ?'
  )
    .bind(uploadKey)
    .first();
  if (!row) return null;

  // 低概率清理 3 天前的幂等记录，防止无限增长
  if (Math.random() < 0.01) {
    try {
      await env.DB.prepare('DELETE FROM upload_ledger WHERE created_at < ?')
        .bind(Date.now() - 3 * 86400 * 1000)
        .run();
    } catch (e) {}
  }

  return { id: row.file_ref, name: row.name, size: row.size, path: row.path };
}

export async function getFileMeta(env, id) {
  const row = await env.DB.prepare(
    'SELECT id, file_id, message_id, name, size, mime, path, created_at, is_deleted FROM files WHERE id = ?'
  )
    .bind(id)
    .first();
  if (!row) return null;
  return {
    id: row.id,
    fileId: row.file_id,
    messageId: row.message_id,
    name: row.name,
    size: row.size,
    mime: row.mime,
    path: row.path,
    createdAt: row.created_at,
    isDeleted: !!row.is_deleted,
  };
}
