// Telegram webhook 去重：同一个 update_id 只处理一次。

export async function checkIdempotent(env, updateId) {
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO idem (update_id, created_at) VALUES (?, ?)'
  )
    .bind(updateId, Date.now())
    .run();

  // 低概率清理 7 天前的幂等记录，防止无限增长
  if (Math.random() < 0.01) {
    try {
      await env.DB.prepare('DELETE FROM idem WHERE created_at < ?')
        .bind(Date.now() - 7 * 86400 * 1000)
        .run();
    } catch (e) {}
  }

  return (res.meta.changes || 0) > 0;
}
