// 路由层公用：解析请求体、组装同名冲突策略、归档回收站日期。

// 请求体不是合法 JSON 时返回 null，由调用方决定怎么回 400
export async function readJson(request) {
  try { return await request.json(); } catch (err) { return null; }
}

// 回收站按删除日期分组，日期取北京时间（例如 20261122）
export function getBeijingDate() {
  const bjTime = new Date(Date.now() + 8 * 3600 * 1000);
  const y = bjTime.getUTCFullYear();
  const m = String(bjTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bjTime.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// 同名冲突策略由前端冲突弹窗决定；未指定时后端不擅自处置
export function conflictOpts(body, trashDate = getBeijingDate()) {
  const opts = { trashDate };
  if (['overwrite', 'skip', 'rename'].indexOf(body.onConflict) >= 0) opts.onConflict = body.onConflict;
  return opts;
}
