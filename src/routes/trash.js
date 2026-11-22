import { json, normalizePath } from '../utils.js';
import { getTrashList, restoreItem } from '../db/trash.js';
import { readJson, conflictOpts } from './common.js';

// 回收站列表：按删除日期分组
export async function handleTrash(env) {
  return json(await getTrashList(env));
}

// 恢复文件或目录
export async function handleRestore(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: '无效请求' }, 400);

  const { type, id } = body;
  const opts = conflictOpts(body);
  if (body.targetDir !== undefined) opts.targetDir = normalizePath(body.targetDir || '');

  const res = await restoreItem(env, type, id, opts);
  if (res.conflict) return json(res, 409);
  if (!res.ok) return json({ error: res.error || '恢复失败' }, 400);
  return json({ ok: true, name: res.name || null, path: res.path || null });
}
