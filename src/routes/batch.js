// 批量操作：前端生成清单，这里逐项执行并返回逐项结果。
// 免费版每次调用最多 50 次 D1 查询，所以单次批量上限压到 8 项，前端自动分批。

import { json } from '../utils.js';
import { copyNode, moveNode, restoreNode, softDeleteStmt } from '../db/nodes.js';
import { conflictOpts, NO_STORE, readJson } from './common.js';

export const MAX_BATCH_ITEMS = 8;

export async function handleBatch(env, request) {
  const body = await readJson(request);
  if (!body || !Array.isArray(body.items)) {
    return json({ error: '请求格式错误' }, 400, NO_STORE);
  }
  const action = body.action;
  if (!['trash', 'restore', 'move', 'copy'].includes(action)) {
    return json({ error: `未知批量操作：${action}` }, 400, NO_STORE);
  }
  if (body.items.length > MAX_BATCH_ITEMS) {
    return json({ error: `单次批量最多 ${MAX_BATCH_ITEMS} 项`, max: MAX_BATCH_ITEMS }, 400, NO_STORE);
  }

  const ids = body.items.map((it) => (it && (it.id || it.source)) || null);
  if (ids.some((id) => !id)) return json({ error: '存在缺少 id 的项' }, 400, NO_STORE);

  const results = [];
  let success = 0;
  let skipped = 0;
  let failed = 0;

  if (action === 'trash') {
    // 软删除可以完全用语句表达：一次 batch 就够，不消耗逐项查询。
    const now = Date.now();
    const stmts = ids.map((id) => softDeleteStmt(env, id, now));
    await env.DB.batch(stmts);
    for (const id of ids) results.push({ id, ok: true });
    success = ids.length;
  } else {
    const onConflict = conflictOpts(body);
    const targetId = body.targetId ?? null;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      let r;
      try {
        if (action === 'restore') r = await restoreNode(env, id);
        else if (action === 'move') r = await moveNode(env, id, targetId, onConflict);
        else r = await copyNode(env, id, targetId, onConflict);
      } catch (err) {
        r = { ok: false, error: err.message || '操作失败' };
      }
      if (r.ok && r.skipped) skipped += 1;
      else if (r.ok) success += 1;
      else failed += 1;
      results.push(Object.assign({ id }, r));
    }
  }

  return json({ success, skipped, failed, results }, 200, NO_STORE);
}
