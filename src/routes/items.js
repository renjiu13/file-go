import { json, normalizePath, joinPath, nameError } from '../utils.js';
import { addDir, dirExists } from '../db/dirs.js';
import { findNameClash, conflictResult } from '../db/naming.js';
import { renameItem, moveItem, copyItem } from '../db/relocate.js';
import { softDeleteFile, softDeleteDir } from '../db/trash.js';
import { readJson, getBeijingDate, conflictOpts } from './common.js';

// 新建目录
export async function handleMkdir(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: '无效请求' }, 400);

  const parent = normalizePath(body.parent || '');
  const name = (body.name || '').trim();

  const invalid = nameError(name);
  if (invalid) return json({ error: invalid }, 400);
  if (!(await dirExists(env, parent))) return json({ error: '父目录不存在' }, 400);

  const clash = await findNameClash(env, parent, name);
  if (clash) return json(conflictResult(name, parent, clash), 409);

  const path = joinPath(parent, name);
  await addDir(env, path);
  return json({ ok: true, path });
}

// 删除（移入回收站）
export async function handleDelete(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: '无效请求' }, 400);

  const type = body.type;
  const targetDate = getBeijingDate();

  if (type === 'file') {
    const id = body.id;
    if (!id) return json({ error: '缺少 id' }, 400);
    const res = await softDeleteFile(env, id, targetDate);
    if (!res.ok) return json({ error: '文件不存在' }, 404);
    return json({ ok: true });
  }

  if (type === 'dir') {
    const path = normalizePath(body.path || '');
    if (path === '') return json({ error: '不能删除根目录' }, 400);
    const res = await softDeleteDir(env, path, targetDate);
    if (!res.ok) return json({ error: '删除失败' }, 400);
    return json({ ok: true, fileCount: res.fileCount });
  }

  return json({ error: '未知类型' }, 400);
}

// 重命名
export async function handleRename(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: '无效请求' }, 400);

  const { type, source } = body;
  const newName = String(body.newName || '').trim();

  if (!source) return json({ error: '缺少操作对象' }, 400);
  const invalid = nameError(newName);
  if (invalid) return json({ error: invalid }, 400);

  const res = await renameItem(env, type, source, newName, conflictOpts(body));
  if (res.conflict) return json(res, 409);
  if (!res.ok) return json({ error: res.error || '重命名失败' }, 400);
  return json({ ok: true, skipped: !!res.skipped, name: res.name || null, path: res.path || null });
}

// 移动 / 复制
export async function handleMoveCopy(request, env, action) {
  const body = await readJson(request);
  if (!body) return json({ error: '无效请求' }, 400);

  const { type, source } = body; // source: 文件的 id 或目录的 path
  const target = normalizePath(body.targetDir || '');

  if (!source) return json({ error: '缺少操作对象' }, 400);
  if (!(await dirExists(env, target))) return json({ error: '目标目录不存在' }, 400);

  const opts = conflictOpts(body);
  const res = action === 'move'
    ? await moveItem(env, type, source, target, opts)
    : await copyItem(env, type, source, target, opts);

  if (res.conflict) return json(res, 409);
  if (!res.ok) return json({ error: res.error || '操作失败' }, 400);
  return json({ ok: true, skipped: !!res.skipped, name: res.name || null, path: res.path || null });
}
