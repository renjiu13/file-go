// 建表与旧库字段兼容：每个 Worker 实例首次访问时跑一次。

let schemaReady = false;
let initPromise = null;

export async function initSchema(env) {
  if (schemaReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
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
            created_at INTEGER NOT NULL,
            is_deleted INTEGER DEFAULT 0,
            trash_date TEXT,
            original_path TEXT
          )`
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS dirs (
            path TEXT PRIMARY KEY,
            parent_path TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            is_deleted INTEGER DEFAULT 0,
            trash_date TEXT,
            original_path TEXT
          )`
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS idem (
            update_id INTEGER PRIMARY KEY,
            created_at INTEGER NOT NULL
          )`
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS upload_ledger (
            upload_key TEXT PRIMARY KEY,
            file_ref TEXT NOT NULL,
            name TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            path TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
          )`
        ),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_files_path ON files (path)'),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_dirs_parent ON dirs (parent_path)'),
      ]);

      // 旧表字段兼容（忽略"已存在"错误）
      try {
        await env.DB.prepare("ALTER TABLE dirs ADD COLUMN parent_path TEXT NOT NULL DEFAULT ''").run();
      } catch (e) {}
      try {
        await env.DB.prepare("ALTER TABLE files ADD COLUMN is_deleted INTEGER DEFAULT 0").run();
        await env.DB.prepare("ALTER TABLE files ADD COLUMN trash_date TEXT").run();
        await env.DB.prepare("ALTER TABLE files ADD COLUMN original_path TEXT").run();
      } catch (e) {}
      try {
        await env.DB.prepare("ALTER TABLE dirs ADD COLUMN is_deleted INTEGER DEFAULT 0").run();
        await env.DB.prepare("ALTER TABLE dirs ADD COLUMN trash_date TEXT").run();
        await env.DB.prepare("ALTER TABLE dirs ADD COLUMN original_path TEXT").run();
      } catch (e) {}

      schemaReady = true;
    } catch (err) {
      console.error('Schema 初始化失败:', err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}
