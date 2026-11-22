import { json, normalizePath } from '../utils.js';
import { dirExists } from '../db/dirs.js';
import { batchTrash, batchRestore, batchMove, batchCopy } from '../db/batch.js';
import { readJson, getBeijingDate, conflictOpts } from './common.js';

// 批量接口的入参都是 { items: [{ type, id | path }, ...] }，
// 逐项执行、汇总成功 / 跳过 / 失败，部分失败不影响其他项。

// 批量放入回收站
export async function handleBatchTrash(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: '无效请求' }, 400);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ error: '请先选择要删除的项目' }, 400);
  return json(await batchTrash(env, items, getBeijingDate()));
}

// 批量恢复
export async function handleBatchRestore(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: '无效请求' }, 400);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ error: '请先选择要恢复的项目' }, 400);
  const opts = conflictOpts(body);
  if (body.targetDir !== undefined) opts.targetDir = normalizePath(body.targetDir || '');
  return json(await batchRestore(env, items, opts));
}

// 批量移动
export async function handleBatchMove(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: '无效请求' }, 400);
  const items = Array.isArray(body.items) ? body.items : [];
  const target = normalizePath(body.targetDir || '');
  if (!items.length) return json({ error: '请先选择要移动的项目' }, 400);
  if (!(await dirExists(env, target))) return json({ error: '目标目录不存在' }, 400);
  return json(await batchMove(env, items, target, conflictOpts(body)));
}

// 批量复制
export async function handleBatchCopy(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: '无效请求' }, 400);
  const items = Array.isArray(body.items) ? body.items : [];
  const target = normalizePath(body.targetDir || '');
  if (!items.length) return json({ error: '请先选择要复制的项目' }, 400);
  if (!(await dirExists(env, target))) return json({ error: '目标目录不存在' }, 400);
  return json(await batchCopy(env, items, target, conflictOpts(body)));
}
