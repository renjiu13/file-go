import { genShortId, ID_LENGTH, parentOf, basename } from './utils.js';

// Schema 初始化锁，防止并发重复建表
let schemaReady = false;
let initPromise = null;

// 初始化数据库表结构（幂等，包含旧表迁移逻辑）
export async function initSchema(env) {
  if (schemaReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 1. 先按最新结构建表（如果表不存在）
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
            parent_path TEXT NOT NULL DEFAULT '',
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

      // 2. 检查 dirs 表是否包含 parent_path 字段（针对旧库平滑升级）
      const tableInfo = await env.DB.prepare('PRAGMA table_info(dirs)').all();
      const hasParentPath = tableInfo.results.some((col) => col.name === 'parent_path');

      if (!hasParentPath) {
        // 加列
        await env.DB.prepare("ALTER TABLE dirs ADD COLUMN parent_path TEXT NOT NULL DEFAULT ''").run();
        
        // 回填数据
        const allDirs = await env.DB.prepare('SELECT path FROM dirs').all();
        const stmts = allDirs.results.map((row) => {
          const parent = parentOf(row.path) || ''; 
          return env.DB.prepare('UPDATE dirs SET parent_path = ? WHERE path = ?').bind(parent, row.path);
        });
        if (stmts.length > 0) await env.DB.batch(stmts);
      }

      // 3. 确保 parent_path 索引存在（必须等字段加好之后建）
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_dirs_parent ON dirs (parent_path)').run();

      schemaReady = true;
    } catch (err) {
      console.error('Schema 初始化失败:', err);
      initPromise = null; // 失败允许重试
      throw err;
    }
  })();

  return initPromise;
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

// 保存文件元信息
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

// 获取文件元信息（供 file.js 使用）
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

// 新增目录（写入 parent_path 用于极速查询）
export async function addDir(env, path) {
  if (path === '') return;
  const parent = parentOf(path) || '';
  await env.DB.prepare('INSERT OR IGNORE INTO dirs (path, parent_path, created_at) VALUES (?, ?, ?)')
    .bind(path, parent, Date.now())
    .run();
}

// 递归确保目录及其父目录存在
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

// 🚀 【核心优化】列出某目录下的子目录和文件（彻底告别全量扫描）
export async function listDir(env, path) {
  // 1. 查询子目录：利用 parent_path 和索引直接命中
  const dirsRes = await env.DB.prepare('SELECT path FROM dirs WHERE parent_path = ?').bind(path).all();
  const subDirs = dirsRes.results
    .map((r) => ({ name: basename(r.path), path: r.path }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 2. 查询文件：利用 path 和索引直接命中
  const filesRes = await env.DB.prepare(
    'SELECT id, name, size, mime, created_at FROM files WHERE path = ?'
  )
    .bind(path)
    .all();
    
  const files = filesRes.results.map((r) => ({
    id: r.id,
    name: r.name,
    size: r.size,
    mime: r.mime,
    createdAt: r.created_at,
  }));
  
  // 按创建时间倒序
  files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { dirs: subDirs, files };
}

// 幂等性检查
export async function checkIdempotent(env, updateId) {
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO idem (update_id, created_at) VALUES (?, ?)'
  )
    .bind(updateId, Date.now())
    .run();
  return (res.meta.changes || 0) > 0;
}

// 删除单个文件
export async function deleteFile(env, id) {
  const row = await env.DB.prepare('SELECT id, message_id FROM files WHERE id = ?').bind(id).first();
  if (!row) return { ok: false };
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  return { ok: true, messageId: row.message_id };
}

// 🚀 【安全修复】级联删除目录，用范围查询代替 LIKE 避免误删
export async function deleteDir(env, path) {
  if (path === '') return { ok: false, reason: 'root' };
  
  // 安全的路径前缀匹配：从 path + '/' 开始，到 path + '0' 结束
  const start = path + '/';
  const end = path + '0';

  const files = await env.DB.prepare(
    'SELECT id, message_id FROM files WHERE path = ? OR (path >= ? AND path < ?)'
  )
    .bind(path, start, end)
    .all();
    
  const messageIds = files.results.map((r) => r.message_id).filter((m) => m != null);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM files WHERE path = ? OR (path >= ? AND path < ?)').bind(path, start, end),
    env.DB.prepare('DELETE FROM dirs WHERE path = ? OR (path >= ? AND path < ?)').bind(path, start, end),
  ]);

  return { ok: true, fileCount: files.results.length, messageIds };
}