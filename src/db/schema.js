// 建表与旧库迁移：每个 Worker 实例首次访问时跑一次。
//
// 数据模型是统一 nodes 表：文件、目录、上传中的文件都是节点，Telegram 的
// 物理分片放在 file_parts 里。旧库（files/dirs）迁移后只保留只读数据，
// 新代码不再读写它们。

import { genShortId, parentOf } from '../utils.js';

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT REFERENCES nodes(id),
    kind        TEXT NOT NULL CHECK (kind IN ('dir','file')),
    status      TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading','ready')),
    name        TEXT NOT NULL COLLATE NOCASE,
    size        INTEGER NOT NULL DEFAULT 0,
    mime        TEXT,
    chunk_size  INTEGER,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    replace_id  TEXT,
    expires_at  INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    trash_id    TEXT,
    share_token TEXT
  )`,

  // 同一目录内名称唯一（大小写不敏感），文件与目录共用命名空间。
  // SQLite 的唯一索引把 NULL 当作互不相等，根目录（parent_id IS NULL）
  // 必须单独建一个索引，否则根目录下的同名项不会被拦住。
  `CREATE UNIQUE INDEX IF NOT EXISTS nodes_live_name
     ON nodes(parent_id, name)
     WHERE parent_id IS NOT NULL AND deleted_at IS NULL AND status = 'ready'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS nodes_live_root_name
     ON nodes(name)
     WHERE parent_id IS NULL AND deleted_at IS NULL AND status = 'ready'`,

  `CREATE INDEX IF NOT EXISTS nodes_parent ON nodes(parent_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS nodes_trash ON nodes(trash_id)`,
  `CREATE INDEX IF NOT EXISTS nodes_expiry ON nodes(status, expires_at)`,

  `CREATE TABLE IF NOT EXISTS file_parts (
    node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    tg_file_id TEXT NOT NULL,
    message_id INTEGER,
    size       INTEGER NOT NULL,
    sha256     TEXT,
    PRIMARY KEY (node_id, idx)
  )`,

  // 待删除的 Telegram 消息队列，由 Cron 消费
  `CREATE TABLE IF NOT EXISTS pending_deletes (
    message_id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT
  )`,

  // Webhook 幂等表保留：Telegram 会重投 update，避免重复建节点
  `CREATE TABLE IF NOT EXISTS idem (
    update_id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL
  )`,

  // 登录限速：按来源 IP 记录连续失败次数，避免离线撞库。
  // 只存一行一个 key，Cron 里清理一天前的记录。
  `CREATE TABLE IF NOT EXISTS auth_throttle (
    key           TEXT PRIMARY KEY,
    fails         INTEGER NOT NULL DEFAULT 0,
    first_at      INTEGER NOT NULL,
    blocked_until INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS auth_throttle_first ON auth_throttle(first_at)`,
];

let schemaReady = false;
let initPromise = null;

// 测试进程里会连续创建多个内存库，需要能重置模块级缓存
export function __resetSchemaCache() {
  schemaReady = false;
  initPromise = null;
}

// 老库的 nodes 表由 CREATE TABLE IF NOT EXISTS 建立，新增的列不会被补上，
// 这里单独 ALTER 一次；列已存在时 D1 报 duplicate column，忽略即可。
async function ensureShareColumn(env) {
  try {
    await env.DB.prepare('ALTER TABLE nodes ADD COLUMN share_token TEXT').run();
  } catch (err) {
    if (!/duplicate column/i.test(String((err && err.message) || err))) throw err;
  }
  await env.DB.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS nodes_share_token ' +
    'ON nodes(share_token) WHERE share_token IS NOT NULL',
  ).run();
}

export async function initSchema(env) {
  if (schemaReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await env.DB.batch(SCHEMA_SQL.map((sql) => env.DB.prepare(sql)));
      await ensureShareColumn(env);
      await migrateLegacy(env);
      schemaReady = true;
    } catch (err) {
      console.error('Schema 初始化失败:', err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

// 旧库迁移：只在第一次启动时执行，用 meta 表打标记。
async function migrateLegacy(env) {
  const done = await env.DB.prepare('SELECT v FROM meta WHERE k = ?')
    .bind('legacy_migrated_v1')
    .first();
  if (done) return;

  const hasFiles = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'files'"
  ).first();

  if (hasFiles) {
    try {
      await migrateLegacyRows(env);
    } catch (err) {
      // 迁移失败不写标记，下次请求重试；节点表是空的，重试不会产生重复
      console.error('旧库迁移失败:', err);
      throw err;
    }
  }

  await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)')
    .bind('legacy_migrated_v1', String(Date.now()))
    .run();
}

async function tableColumns(env, table) {
  const res = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((res.results || []).map((r) => r.name));
}

async function migrateLegacyRows(env) {
  const fileCols = await tableColumns(env, 'files');
  const dirCols = await tableColumns(env, 'dirs');

  const filesWhere = fileCols.has('is_deleted') ? 'WHERE is_deleted IS NULL OR is_deleted = 0' : '';
  const dirsWhere = dirCols.has('is_deleted') ? 'WHERE is_deleted IS NULL OR is_deleted = 0' : '';

  const dirRows = dirCols.size
    ? (await env.DB.prepare(`SELECT path FROM dirs ${dirsWhere} ORDER BY path`).all()).results || []
    : [];
  const fileRows = (await env.DB.prepare(
    `SELECT id, file_id, name, size, mime, path, created_at FROM files ${filesWhere}`
  ).all()).results || [];

  const now = Date.now();
  const dirIds = new Map(); // path -> nodeId
  const usedIds = new Set();
  const dirStmts = [];

  // 旧 dirs 表按 path 存，节点表按 parent_id 存：按路径深度重建父子关系。
  for (const row of dirRows) {
    const path = String(row.path || '').replace(/^\/+|\/+$/g, '');
    if (!path) continue;
    const segs = path.split('/');
    let acc = '';
    let parentId = null;
    for (const seg of segs) {
      acc = acc ? acc + '/' + seg : seg;
      if (dirIds.has(acc)) {
        parentId = dirIds.get(acc);
        continue;
      }
      let id = genShortId(16);
      while (usedIds.has(id)) id = genShortId(16);
      usedIds.add(id);
      dirIds.set(acc, id);
      dirStmts.push(
        env.DB.prepare(
          `INSERT INTO nodes (id, parent_id, kind, status, name, size, mime, chunk_size, chunk_count, created_at, updated_at)
           VALUES (?, ?, 'dir', 'ready', ?, 0, NULL, NULL, 0, ?, ?)`
        ).bind(id, parentId, seg, now, now)
      );
      parentId = id;
    }
  }

  if (dirStmts.length) await env.DB.batch(dirStmts);

  // 旧文件的 id 尽量保留，外部链接不会失效；只迁移仍在使用的文件。
  const fileStmts = [];
  const usedFileIds = new Set();
  for (const row of fileRows) {
    const oldPath = String(row.path || '').replace(/^\/+|\/+$/g, '');
    const parentId = oldPath ? dirIds.get(oldPath) || null : null;
    let id = String(row.id || '');
    if (!/^[A-Za-z0-9]{10,16}$/.test(id) || usedFileIds.has(id)) id = genShortId(16);
    while (usedFileIds.has(id)) id = genShortId(16);
    usedFileIds.add(id);

    const size = Number(row.size) || 0;
    const chunkSize = size > 0 ? size : 1;
    const createdAt = Number(row.created_at) || now;
    fileStmts.push(
      env.DB.prepare(
        `INSERT INTO nodes (id, parent_id, kind, status, name, size, mime, chunk_size, chunk_count, created_at, updated_at)
         VALUES (?, ?, 'file', 'ready', ?, ?, ?, ?, 1, ?, ?)`
      ).bind(id, parentId, String(row.name), size, row.mime || null, chunkSize, createdAt, createdAt)
    );
    fileStmts.push(
      env.DB.prepare(
        `INSERT INTO file_parts (node_id, idx, tg_file_id, message_id, size, sha256)
         VALUES (?, 0, ?, NULL, ?, NULL)`
      ).bind(id, row.file_id, size)
    );
  }

  // D1 单条 batch 里的语句数没有硬性小上限，但分成小块更稳
  for (let i = 0; i < fileStmts.length; i += 40) {
    await env.DB.batch(fileStmts.slice(i, i + 40));
  }
}
