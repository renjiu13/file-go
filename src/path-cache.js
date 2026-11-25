// tg_file_id → file_path 的两级缓存。
//
// Telegram 保证 file_path 至少 1 小时有效；缓存保守设 45 分钟，失效时清除并重试一次。
// 内存 Map 命中时零子请求；跨隔离实例靠 Cache API（尽力而为，不依赖持久性）。

import { getFilePath } from './telegram.js';

const MEM_TTL_MS = 45 * 60 * 1000;
const mem = new Map(); // fileId -> { path, exp }

function cacheKey(fileId) {
  return 'https://tg-file-store.internal/file-path/' + encodeURIComponent(fileId);
}

function getCache() {
  try {
    if (typeof caches !== 'undefined' && caches.default) return caches.default;
  } catch {
    /* 运行环境没有 Cache API 时退化为纯内存缓存 */
  }
  return null;
}

export async function getCachedFilePath(env, fileId) {
  const resolved = await resolveFilePath(env, fileId);
  return resolved.path;
}

// 返回 { path, cached }：cached 表示没有为 getFile 花子请求，下载侧据此做预算规划。
export async function resolveFilePath(env, fileId) {
  const now = Date.now();
  const hit = mem.get(fileId);
  if (hit && hit.exp > now) return { path: hit.path, cached: true };

  const cache = getCache();
  const key = cacheKey(fileId);
  if (cache) {
    try {
      const res = await cache.match(key);
      if (res) {
        const data = await res.json();
        if (data && data.path && Number(data.exp) > now) {
          mem.set(fileId, { path: data.path, exp: Number(data.exp) });
          return { path: data.path, cached: true };
        }
      }
    } catch {
      /* 缓存读失败按未命中处理 */
    }
  }

  let path;
  try {
    path = await getFilePath(env, fileId);
  } catch (err) {
    // 缓存里的 file_path 可能已失效：清掉重试一次
    await invalidateCachedFilePath(env, fileId);
    path = await getFilePath(env, fileId);
  }
  const exp = now + MEM_TTL_MS;
  mem.set(fileId, { path, exp });
  if (cache) {
    try {
      const body = JSON.stringify({ path, exp });
      await cache.put(key, new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${Math.floor(MEM_TTL_MS / 1000)}` },
      }));
    } catch {
      /* 写入缓存失败不影响下载 */
    }
  }
  return { path, cached: false };
}

export async function invalidateCachedFilePath(env, fileId) {
  mem.delete(fileId);
  const cache = getCache();
  if (cache) {
    try { await cache.delete(cacheKey(fileId)); } catch { /* ignore */ }
  }
}

// 测试用：清空内存缓存
export function __resetPathCache() {
  mem.clear();
}
