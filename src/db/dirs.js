import { parentOf, basename } from '../utils.js';

export async function addDir(env, path) {
  if (path === '') return;
  const parent = parentOf(path) || '';
  await env.DB.prepare(
    'INSERT OR IGNORE INTO dirs (path, parent_path, created_at) VALUES (?, ?, ?)'
  )
    .bind(path, parent, Date.now())
    .run();
}

export async function ensureDir(env, path) {
  if (path === '') return;
  const segs = path.split('/');
  let cur = '';
  for (const seg of segs) {
    cur = cur === '' ? seg : cur + '/' + seg;
    await addDir(env, cur);
  }
}

export async function dirExists(env, path) {
  if (path === '') return true;
  const row = await env.DB.prepare('SELECT path FROM dirs WHERE path = ? AND is_deleted = 0')
    .bind(path)
    .first();
  return !!row;
}

// 获取全部活跃目录（供 /api/tree 使用）
export async function getAllDirs(env) {
  const res = await env.DB.prepare('SELECT path FROM dirs WHERE is_deleted = 0').all();
  return res.results.map((r) => r.path).sort();
}

export async function listDir(env, path) {
  const [dirsRes, filesRes] = await env.DB.batch([
    env.DB.prepare(
      'SELECT path, created_at FROM dirs WHERE parent_path = ? AND is_deleted = 0'
    ).bind(path),
    env.DB.prepare(
      'SELECT id, name, size, mime, created_at FROM files WHERE path = ? AND is_deleted = 0'
    ).bind(path),
  ]);
  const subDirs = dirsRes.results
    .map((r) => ({ name: basename(r.path), path: r.path, createdAt: r.created_at }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const files = filesRes.results.map((r) => ({
    id: r.id,
    name: r.name,
    size: r.size,
    mime: r.mime,
    createdAt: r.created_at,
  }));
  files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { dirs: subDirs, files };
}

// 把 oldPath 整棵子树搬到 newPath（父目录改为 newParent），前缀用 substr 精确剥离
export async function relocateDir(env, oldPath, newPath, newParent) {
  const L = oldPath.length + 1;
  const start = oldPath + '/';
  const end = oldPath + '0';

  await env.DB.batch([
    env.DB.prepare('UPDATE dirs SET path = ?, parent_path = ? WHERE path = ?')
      .bind(newPath, newParent, oldPath),
    env.DB.prepare(
      'UPDATE dirs SET path = ? || substr(path, ?), parent_path = ? || substr(parent_path, ?) WHERE path >= ? AND path < ?'
    ).bind(newPath, L, newPath, L, start, end),
    env.DB.prepare(
      'UPDATE files SET path = ? || substr(path, ?) WHERE path = ? OR (path >= ? AND path < ?)'
    ).bind(newPath, L, oldPath, start, end),
  ]);
}

// 目标路径下若已存在任何目录行（含回收站），改名/搬入会撞主键
export async function isPathSubtreeBusy(env, path) {
  const row = await env.DB.prepare('SELECT path FROM dirs WHERE path = ? OR (path >= ? AND path < ?)')
    .bind(path, path + '/', path + '0')
    .first();
  return !!row;
}
