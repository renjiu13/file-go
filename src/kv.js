import { genShortId, ID_LENGTH, parentOf, basename } from './utils.js';

// Schema 是否已初始化（模块级缓存）
let schemaReady = false;

// 初始化数据库表结构（幂等，可重复执行）
export async function initSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        message_id INTEGER,
        name TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        mime TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS dirs (
        path TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      )`
    ),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_files_path ON files (path)'),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS idem (
        update_id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL
      )`
    ),
  ]);
  schemaReady = true;
}

// 生成不重复的短 ID
export async function newShortId(env) {
  for (let i = 0; i < 10; i++) {
    const id = genShortId(ID_LENGTH);
    const row = await env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(id).first();
    if (!row) return id;
  }
  return genShortId(ID_LENGTH + 4);
}

// 保存文件元信息（含父目录 path 和 TG 消息 id）
export async function saveFile(env, meta) {
  await env.DB.prepare(
    `INSERT INTO files (id, file_id, message_id, name, size, mime, path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      meta.id,
      meta.fileId,
      meta.messageId || null,
      meta.name,
      meta.size || 0,
      meta.mime || '',
      meta.path || '',
      meta.createdAt || Date.now()
    )
    .run();
}

// 获取文件元信息（映射为 camelCase，兼容 file.js）
export async function getFileMeta(env, id) {
  const row = await env.DB.prepare(
    'SELECT id, file_id, message_id, name, size, mime, path, created_at FROM files WHERE id = ?'
  )
    .bind(id)
    .first();
  if (!row) return null;
  return {
    id: row.id,
    fileId: row.file_id,
    messageId: row.message_id,
    name: row.name,
    size: row.size,
    mime: row.mime,
    path: row.path,
    createdAt: row.created_at,
  };
}

// 获取所有目录路径（数组）
export async function getDirs(env) {
  const res = await env.DB.prepare('SELECT path FROM dirs').all();
  return res.results.map((r) => r.path);
}

// 新增目录（已存在则忽略）
export async function addDir(env, path) {
  if (path === '') return;
  await env.DB.prepare('INSERT OR IGNORE INTO dirs (path, created_at) VALUES (?, ?)')
    .bind(path, Date.now())
    .run();
}

// 递归确保目录及其所有父目录存在
export async function ensureDir(env, path) {
  if (path === '') return;
  const segs = path.split('/');
  let cur = '';
  for (const seg of segs) {
    cur = cur === '' ? seg : cur + '/' + seg;
    await addDir(env, cur);
  }
}

// 判断目录是否存在（根目录恒存在）
export async function dirExists(env, path) {
  if (path === '') return true;
  const row = await env.DB.prepare('SELECT path FROM dirs WHERE path = ?').bind(path).first();
  return !!row;
}

// 列出某目录下的子目录和文件
export async function listDir(env, path) {
  // 子目录
  const dirs = await getDirs(env);
  const subDirs = dirs
    .filter((d) => parentOf(d) === path)
    .map((d) => ({ name: basename(d), path: d }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 文件
  const res = await env.DB.prepare(
    'SELECT id, name, size, mime, created_at FROM files WHERE path = ?'
  )
    .bind(path)
    .all();
  const files = res.results.map((r) => ({
    id: r.id,
    name: r.name,
    size: r.size,
    mime: r.mime,
    createdAt: r.created_at,
  }));
  files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { dirs: subDirs, files };
}

// 幂等性检查：根据 update_id 判断是否已处理过
// 返回 true 表示新请求，false 表示重复请求
export async function checkIdempotent(env, updateId) {
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO idem (update_id, created_at) VALUES (?, ?)'
  )
    .bind(updateId, Date.now())
    .run();
  return (res.meta.changes || 0) > 0;
}

// 删除单个文件（返回其 message_id 供删除 TG 消息）
export async function deleteFile(env, id) {
  const row = await env.DB.prepare('SELECT id, message_id FROM files WHERE id = ?').bind(id).first();
  if (!row) return { ok: false };
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  return { ok: true, messageId: row.message_id };
}

// 级联删除目录（连同其下所有子目录和文件）
export async function deleteDir(env, path) {
  if (path === '') return { ok: false, reason: 'root' };
  const files = await env.DB.prepare(
    'SELECT id, message_id FROM files WHERE path = ? OR path LIKE ?'
  )
    .bind(path, path + '/%')
    .all();
  const messageIds = files.results.map((r) => r.message_id).filter((m) => m != null);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM files WHERE path = ? OR path LIKE ?').bind(path, path + '/%'),
    env.DB.prepare('DELETE FROM dirs WHERE path = ? OR path LIKE ?').bind(path, path + '/%'),
  ]);

  return { ok: true, fileCount: files.results.length, messageIds };
}
