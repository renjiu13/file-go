// 目录列表 / 目录树

import { json, normalizePath } from '../utils.js';
import { getTree, listChildren, resolvePath } from '../db/nodes.js';
import { NO_STORE } from './common.js';

export async function handleList(env, url) {
  const path = normalizePath(url.searchParams.get('path') || '');
  const dir = await resolvePath(env, path);
  if (!dir) return json({ error: '目录不存在' }, 404, NO_STORE);
  const children = await listChildren(env, dir.id);
  return json({
    path: dir.crumbs.map((c) => c.name).join('/'),
    dirId: dir.id,
    crumbs: dir.crumbs,
    dirs: children.dirs,
    files: children.files,
  }, 200, NO_STORE);
}

export async function handleTree(env) {
  return json({ tree: await getTree(env) }, 200, NO_STORE);
}
