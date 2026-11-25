// 路由层共用的小工具。

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 前端可能用 onConflict / conflictMode / mode 三种字段名之一
export function conflictOpts(body) {
  if (!body) return null;
  return body.onConflict || body.conflictMode || body.mode || null;
}

// 目录/文件元数据接口一律不缓存
export const NO_STORE = { 'Cache-Control': 'no-store' };

export function originOf(request) {
  return new URL(request.url).origin;
}
