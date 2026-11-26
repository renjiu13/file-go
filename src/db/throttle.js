// 登录限速：按来源 IP 记连续失败次数。
// 15 分钟窗口内失败满 5 次开始拦截，拦截时长 30s×2^(n-5)，上限 15 分钟。

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const MAX_BLOCK_MS = 15 * 60 * 1000;
const KEEP_MS = 24 * 60 * 60 * 1000;

export async function throttleState(env, key, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const row = await env.DB.prepare(
    'SELECT fails, first_at, blocked_until FROM auth_throttle WHERE key = ?',
  ).bind(key).first();
  if (!row) return { fails: 0, blockedUntil: 0 };
  if (row.blocked_until && row.blocked_until > t) {
    return { fails: row.fails || 0, blockedUntil: row.blocked_until };
  }
  if (t - row.first_at > WINDOW_MS) return { fails: 0, blockedUntil: 0 };
  return { fails: row.fails || 0, blockedUntil: 0 };
}

export async function recordFailure(env, key, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const row = await env.DB.prepare(
    'SELECT fails, first_at FROM auth_throttle WHERE key = ?',
  ).bind(key).first();
  const fresh = !row || t - row.first_at > WINDOW_MS;
  const fails = fresh ? 1 : (row.fails || 0) + 1;
  const firstAt = fresh ? t : row.first_at;
  let blockedUntil = 0;
  if (fails >= MAX_FAILS) {
    const step = Math.min(MAX_BLOCK_MS, 30 * 1000 * Math.pow(2, fails - MAX_FAILS));
    blockedUntil = t + step;
  }
  await env.DB.prepare(
    'INSERT INTO auth_throttle (key, fails, first_at, blocked_until) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, ' +
    'first_at = excluded.first_at, blocked_until = excluded.blocked_until',
  ).bind(key, fails, firstAt, blockedUntil || null).run();
  return { fails, blockedUntil };
}

export async function clearThrottle(env, key) {
  await env.DB.prepare('DELETE FROM auth_throttle WHERE key = ?').bind(key).run();
}

export async function cleanThrottle(env, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const result = await env.DB.prepare('DELETE FROM auth_throttle WHERE first_at < ?')
    .bind(t - KEEP_MS).run();
  return (result && result.meta && result.meta.changes) || 0;
}

export const THROTTLE_LIMITS = { WINDOW_MS, MAX_FAILS, MAX_BLOCK_MS };
