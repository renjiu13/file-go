import {
  genShortId,
  ID_LENGTH,
  parentOf,
  basename,
  // 如有需要的其它工具函数（normalizePath、joinPath 等）请自行实现或从 utils 引入
} from './utils.js';

// ---------- 初始化锁 ----------
let schemaReady = false;
let initPromise = null;

// ---------- 数据库结构 ----------
export async function initSchema(env) {
  if (schemaReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await env.DB.batch([
        // files 表（新增软删除字段）
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
        // dirs 表（新增软删除字段）
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
        // 索引
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_files_path ON files (path)'),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_dirs_parent ON dirs (parent_path)'),
      ]);

      // -------- 旧表迁移：如果旧表缺少新字段则补齐 ----------
      // dirs.parent_path 已在创建时提供，若是旧库需要补列：
      const dirsInfo = await env.DB.prepare('PRAGMA table_info(dirs)').all();
      if (!dirsInfo.results.some(col => col.name === 'parent_path')) {
        await env.DB.prepare(
          "ALTER TABLE dirs ADD COLUMN parent_path TEXT NOT NULL DEFAULT ''"
        ).run();

        // 回填 parent_path
        const allDirs = await env.DB.prepare('SELECT path FROM dirs').all();
        const stmts = allDirs.results.map(row => {
          const parent = parentOf(row.path) || '';
          return env.DB.prepare('UPDATE dirs SET parent_path = ? WHERE path = ?')
            .bind(parent, row.path);
        });
        if (stmts.length) await env.DB.batch(stmts);
      }

      // 同理检查并补齐软删除字段（如果是旧库）
      const filesInfo = await env.DB.prepare('PRAGMA table_info(files)').all();
      if (!filesInfo.results.some(col => col.name === 'is_deleted')) {
        await env.DB.prepare(
          "ALTER TABLE files ADD COLUMN is_deleted INTEGER DEFAULT 0"
        ).run();
        await env.DB.prepare(
          "ALTER TABLE files ADD COLUMN trash_date TEXT"
        ).run();
        await env.DB.prepare(
          "ALTER TABLE files ADD COLUMN original_path TEXT"
        ).run();
      }
      const dirsInfo2 = await env.DB.prepare('PRAGMA table_info(dirs)').all();
      if (!dirsInfo2.results.some(col => col.name === 'is_deleted')) {
        await env.DB.prepare(
          "ALTER TABLE dirs ADD COLUMN is_deleted INTEGER DEFAULT 0"
        ).run();
        await env.DB.prepare(
          "ALTER TABLE dirs ADD COLUMN trash_date TEXT"
        ).run();
        await env.DB.prepare(
          "ALTER TABLE dirs ADD COLUMN original_path TEXT"
        ).run();
      }

      schemaReady = true;
    } catch (err) {
      console.error('Schema 初始化失败:', err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

// ---------- 短 ID ----------
export async function newShortId(env) {
  for (let i = 0; i < 10; i++) {
    const id = genShortId(ID_LENGTH);
    const row = await env.DB.prepare('SELECT id FROM files WHERE id = ?')
      .bind(id)
      .first();
    if (!row) return id;
  }
  return genShortId(ID_LENGTH + 4);
}

// ---------- 保存文件 ----------
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

// ---------- 读取文件 ----------
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

// ---------- 目录管理 ----------
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
  const row = await env.DB.prepare('SELECT path FROM dirs WHERE path = ?')
    .bind(path)
    .first();
  return !!row;
}

// ---------- 列出目录 ----------
export async function listDir(env, path) {
  // 子目录
  const dirsRes = await env.DB.prepare(
    'SELECT path FROM dirs WHERE parent_path = ? AND is_deleted = 0'
  )
    .bind(path)
    .all();
  const subDirs = dirsRes.results
    .map(r => ({ name: basename(r.path), path: r.path }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 文件
  const filesRes = await env.DB.prepare(
    'SELECT id, name, size, mime, created_at FROM files WHERE path = ? AND is_deleted = 0'
  )
    .bind(path)
    .all();
  const files = filesRes.results.map(r => ({
    id: r.id,
    name: r.name,
    size: r.size,
    mime: r.mime,
    createdAt: r.created_at,
  }));
  files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { dirs: subDirs, files };
}

// ---------- 幂等性检查 ----------
export async function checkIdempotent(env, updateId) {
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO idem (update_id, created_at) VALUES (?, ?)'
  )
    .bind(updateId, Date.now())
    .run();
  return (res.meta.changes || 0) > 0;
}

// ---------- 删除文件 ----------
export async function deleteFile(env, id) {
  const row = await env.DB.prepare('SELECT id, message_id FROM files WHERE id = ?')
    .bind(id)
    .first();
  if (!row) return { ok: false };
  await env.DB.prepare('DELETE FROM files WHERE id = ?')
    .bind(id)
    .run();
  return { ok: true, messageId: row.message_id };
}

// ---------- 软删除 ----------
export async function softDeleteFile(env, id, trashDate) {
  const row = await env.DB.prepare(
    'SELECT id, path, message_id FROM files WHERE id = ? AND is_deleted = 0'
  )
    .bind(id)
    .first();
  if (!row) return { ok: false };

  await env.DB.prepare(
    'UPDATE files SET is_deleted = 1, trash_date = ?, original_path = path WHERE id = ?'
  )
    .bind(trashDate, id)
    .run();

  return { ok: true, messageId: row.message_id };
}

export async function softDeleteDir(env, path, trashDate) {
  const start = path + '/';
  const end = path + '0';

  // 获取将被软删的文件数量（仅作统计，可去掉）
  const files = await env.DB.prepare(
    'SELECT id FROM files WHERE (path = ? OR (path >= ? AND path < ?)) AND is_deleted = 0'
  )
    .bind(path, start, end)
    .all();

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE files SET is_deleted = 1, trash_date = ?, original_path = path WHERE path = ? OR (path >= ? AND path < ?)'
    )
      .bind(trashDate, path, start, end),
    env.DB.prepare(
      'UPDATE dirs SET is_deleted = 1, trash_date = ?, original_path = path WHERE path = ? OR (path >= ? AND path < ?)'
    )
      .bind(trashDate, path, start, end),
    // 目录自身记录
    env.DB.prepare(
      'UPDATE dirs SET is_deleted = 1, trash_date = ?, original_path = path WHERE path = ?'
    )
      .bind(trashDate, path),
  ]);

  return { ok: true, fileCount: files.results.length };
}

// ---------- 回收站列表 ----------
export async function getTrashList(env) {
  const res = await env.DB.prepare(
    `SELECT id, name, size, mime, trash_date, original_path
     FROM files
     WHERE is_deleted = 1
     ORDER BY trash_date DESC, name ASC`
  )
    .all();

  const grouped = {};
  for (const r of res.results) {
    if (!grouped[r.trash_date]) grouped[r.trash_date] = [];
    grouped[r.trash_date].push({
      id: r.id,
      name: r.name,
      size: r.size,
      mime: r.mime,
      originalPath: r.original_path,
    });
  }
  return grouped;
}

// ---------- 恢复 ----------
export async function restoreItem(env, type, id) {
  if (type === 'file') {
    const row = await env.DB.prepare(
      'SELECT original_path FROM files WHERE id = ? AND is_deleted = 1'
    )
      .bind(id)
      .first();
    if (!row) return { ok: false, error: '回收站中无此文件' };

    // 检查目标位置是否已被占用（未软删的同路径文件）
    const exist = await env.DB.prepare(
      'SELECT id FROM files WHERE path = ? AND is_deleted = 0'
    )
      .bind(row.original_path)
      .first();
    if (exist) return { ok: false, error: '原目录已有同名文件，无法恢复' };

    await env.DB.prepare(
      `UPDATE files
       SET is_deleted = 0,
           path = original_path,
           trash_date = NULL,
           original_path = NULL
       WHERE id = ?`
    )
      .bind(id)
      .run();

    return { ok: true };
  }

  if (type === 'dir') {
    // 简化实现：把整个目录标记为非删除
    await env.DB.prepare(
      `UPDATE dirs
       SET is_deleted = 0,
           trash_date = NULL,
           original_path = NULL
       WHERE path = ? AND is_deleted = 1`
    )
      .bind(id) // 这里的 id 实际传入的是目录路径
      .run();

    // 关联文件也一起恢复
    await env.DB.prepare(
      `UPDATE files
       SET is_deleted = 0,
           path = original_path,
           trash_date = NULL,
           original_path = NULL
       WHERE path LIKE ? || '/%' AND is_deleted = 1`
    )
      .bind(id)
      .run();

    return { ok: true };
  }

  return { ok: false };
}

// ---------- 移动 ----------
export async function moveItem(env, type, source, targetDir) {
  if (type === 'file') {
    await env.DB.prepare('UPDATE files SET path = ? WHERE id = ?')
      .bind(targetDir, source)
      .run();
    return { ok: true };
  }

  if (type === 'dir') {
    const oldPath = source;
    const folderName = basename(oldPath);
    const newPath = `${targetDir}/${folderName}`;

    // 防止目标已有同名目录
    const exist = await env.DB.prepare(
      'SELECT path FROM dirs WHERE path = ? AND is_deleted = 0'
    )
      .bind(newPath)
      .first();
    if (exist) return { ok: false, error: '目标目录下已有同名文件夹' };

    // 级联更新 dirs
    await env.DB.prepare(
      `UPDATE dirs
       SET path = replace(path, ?, ?)
       WHERE path = ? OR path LIKE ? || '/%'`
    )
      .bind(oldPath, newPath, oldPath, oldPath)
      .run();

    // 级联更新 files
    await env.DB.prepare(
      `UPDATE files
       SET path = replace(path, ?, ?)
       WHERE path = ? OR path LIKE ? || '/%'`
    )
      .bind(oldPath, newPath, oldPath, oldPath)
      .run();

    return { ok: true };
  }

  return { ok: false };
}

// ---------- 复制 ----------
export async function copyItem(env, type, source, targetDir) {
  if (type === 'file') {
    // 读取原文件元信息
    const meta = await getFileMeta(env, source);
    if (!meta) return { ok: false, error: '找不到源文件' };

    // 生成新 short id
    const newId = await newShortId(env);
    const newMeta = {
      ...meta,
      id: newId,
      path: targetDir,
      createdAt: Date.now(),
    };
    await saveFile(env, newMeta);
    return { ok: true, newId };
  }

  if (type === 'dir') {
    // 递归复制目录下的所有文件和子目录
    const stack = [{ oldPath: source, newParent: targetDir }];
    while (stack.length) {
      const { oldPath, newParent } = stack.pop();
      const newPath = `${newParent}/${basename(oldPath)}`;

      // 创建目标目录
      await addDir(env, newPath);

      // 复制该目录下的文件
      const files = await env.DB.prepare(
        `SELECT * FROM files WHERE path = ? AND is_deleted = 0`
      )
        .bind(oldPath)
        .all();
      for (const f of files.results) {
        const newId = await newShortId(env);
        await env.DB.prepare(
          `INSERT INTO files (id, file_id, message_id, name, size, mime, path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            newId,
            f.file_id,
            f.message_id,
            f.name,
            f.size,
            f.mime,
            newPath,
            Date.now()
          )
          .run();
      }

      // 继续遍历子目录
      const subDirs = await env.DB.prepare(
        `SELECT path FROM dirs WHERE parent_path = ? AND is_deleted = 0`
      )
        .bind(oldPath)
        .all();
      for (const d of subDirs.results) {
        stack.push({ oldPath: d.path, newParent: newPath });
      }
    }
    return { ok: true };
  }

  return { ok: false };
}
