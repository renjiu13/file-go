// 单个节点的元数据操作：新建目录、重命名、移动、复制、删除、恢复。
// 这些操作只改 D1，从不触碰 Telegram。

import { json, nameError } from '../utils.js';
import {
  copyNode,
  createDir,
  getLiveDir,
  moveNode,
  renameNode,
  restoreNode,
  softDelete,
} from '../db/nodes.js';
import { conflictOpts, NO_STORE, readJson } from './common.js';

function respond(r) {
  if (r && r.ok) return json(r, 200, NO_STORE);
  if (r && r.conflict) return json(r, 409, NO_STORE);
  return json(r || { error: '操作失败' }, 400, NO_STORE);
}

export async function handleMkdir(env, request) {
  const body = await readJson(request);
  if (!body || !body.name) return json({ error: '缺少目录名' }, 400, NO_STORE);
  const parent = await getLiveDir(env, body.parentId || null);
  if (!parent) return json({ error: '目标目录不存在' }, 404, NO_STORE);
  const err = nameError(body.name);
  if (err) return json({ error: err }, 400, NO_STORE);
  return respond(await createDir(env, parent.id, body.name));
}

export async function handleRename(env, request) {
  const body = await readJson(request);
  if (!body || !body.id) return json({ error: '缺少文件 id' }, 400, NO_STORE);
  const err = nameError(body.name || '');
  if (err) return json({ error: err }, 400, NO_STORE);
  return respond(await renameNode(env, body.id, body.name, conflictOpts(body)));
}

export async function handleMove(env, request) {
  const body = await readJson(request);
  if (!body || !body.id) return json({ error: '缺少文件 id' }, 400, NO_STORE);
  return respond(await moveNode(env, body.id, body.targetId ?? null, conflictOpts(body)));
}

export async function handleCopy(env, request) {
  const body = await readJson(request);
  if (!body || !body.id) return json({ error: '缺少文件 id' }, 400, NO_STORE);
  return respond(await copyNode(env, body.id, body.targetId ?? null, conflictOpts(body)));
}

export async function handleDelete(env, request) {
  const body = await readJson(request);
  if (!body || !body.id) return json({ error: '缺少文件 id' }, 400, NO_STORE);
  return respond(await softDelete(env, body.id));
}

export async function handleRestore(env, request) {
  const body = await readJson(request);
  if (!body || !body.id) return json({ error: '缺少文件 id' }, 400, NO_STORE);
  return respond(await restoreNode(env, body.id));
}
