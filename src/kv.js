import {
  genShortId,
  ID_LENGTH,
  parentOf,
  basename,
  joinPath
} from './utils.js';

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

export async function newShortId(env) {
  for (let i = 0; i < 10; i++) {
    const id = genShortId(ID_LENGTH);
    const row = await env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(id).first();
    if (!row) return id;
  }
  return genShortId(ID_LENGTH + 4);
}

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

export async function getFileMeta(env, id) {
  const row = await env.DB.prepare(
    'SELECT id, file_id, message_id, name, size, mime, path, created_at, is_deleted FROM files WHERE id = ?'
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
    isDeleted: !!row.is_deleted,
  };
}

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
  const dirsRes = await env.DB.prepare(
    'SELECT path FROM dirs WHERE parent_path = ? AND is_deleted = 0'
  )
    .bind(path)
    .all();
  const subDirs = dirsRes.results
    .map((r) => ({ name: basename(r.path), path: r.path }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const filesRes = await env.DB.prepare(
    'SELECT id, name, size, mime, created_at FROM files WHERE path = ? AND is_deleted = 0'
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
  files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { dirs: subDirs, files };
}

export async function checkIdempotent(env, updateId) {
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO idem (update_id, created_at) VALUES (?, ?)'
  )
    .bind(updateId, Date.now())
    .run();

  // 低概率清理 7 天前的幂等记录，防止无限增长
  if (Math.random() < 0.01) {
    try {
      await env.DB.prepare('DELETE FROM idem WHERE created_at < ?')
        .bind(Date.now() - 7 * 86400 * 1000)
        .run();
    } catch (e) {}
  }

  return (res.meta.changes || 0) > 0;
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

  const files = await env.DB.prepare(
    'SELECT id FROM files WHERE (path = ? OR (path >= ? AND path < ?)) AND is_deleted = 0'
  )
    .bind(path, start, end)
    .all();

  // 只更新未删除行，保留之前单独删除项的原始删除日期
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE files SET is_deleted = 1, trash_date = ?, original_path = path WHERE (path = ? OR (path >= ? AND path < ?)) AND is_deleted = 0'
    ).bind(trashDate, path, start, end),
    env.DB.prepare(
      'UPDATE dirs SET is_deleted = 1, trash_date = ?, original_path = path WHERE (path = ? OR (path >= ? AND path < ?)) AND is_deleted = 0'
    ).bind(trashDate, path, start, end),
  ]);

  return { ok: true, fileCount: files.results.length };
}

// ---------- 回收站 ----------
// 返回按删除日期分组的对象，item 带 type 字段。
// 被删目录里的子目录和文件也全部列出，方便核对与单独恢复。
export async function getTrashList(env) {
  const [filesRes, dirsRes] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, name, size, mime, trash_date, original_path, path FROM files WHERE is_deleted = 1'
    ),
    env.DB.prepare(
      'SELECT path, trash_date FROM dirs WHERE is_deleted = 1'
    ),
  ]);

  const grouped = {};

  for (const d of dirsRes.results) {
    const key = d.trash_date || 'unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      type: 'dir',
      path: d.path,
      name: basename(d.path),
      trashDate: d.trash_date,
    });
  }

  for (const f of filesRes.results) {
    const key = f.trash_date || 'unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      type: 'file',
      id: f.id,
      name: f.name,
      size: f.size,
      mime: f.mime,
      originalPath: f.original_path,
      trashDate: f.trash_date,
    });
  }

  const sorted = {};
  Object.keys(grouped).sort().reverse().forEach((k) => {
    sorted[k] = grouped[k];
  });
  return sorted;
}

// ---------- 恢复 ----------
export async function restoreItem(env, type, id) {
  if (type === 'file') {
    const row = await env.DB.prepare(
      'SELECT original_path, path FROM files WHERE id = ? AND is_deleted = 1'
    )
      .bind(id)
      .first();
    if (!row) return { ok: false, error: '回收站中无此文件' };

    const parentDir = row.original_path || row.path || '';
    if (!(await dirExists(env, parentDir))) {
      return { ok: false, error: '原目录已被删除，请先恢复所属目录' };
    }

    const exist = await env.DB.prepare(
      'SELECT id FROM files WHERE path = ? AND name = (SELECT name FROM files WHERE id = ?) AND is_deleted = 0'
    )
      .bind(parentDir, id)
      .first();
    if (exist) return { ok: false, error: '原目录已有同名文件，无法恢复' };

    await env.DB.prepare(
      `UPDATE files
       SET is_deleted = 0, path = original_path, trash_date = NULL, original_path = NULL
       WHERE id = ?`
    )
      .bind(id)
      .run();

    return { ok: true };
  }

  if (type === 'dir') {
    // 目录恢复时传入的是路径
    const path = id;
    const row = await env.DB.prepare(
      'SELECT path FROM dirs WHERE path = ? AND is_deleted = 1'
    )
      .bind(path)
      .first();
    if (!row) return { ok: false, error: '回收站中无此目录' };

    // 上级目录也被删除时禁止单独恢复，避免产生正常视图不可见的孤立目录
    const parent = parentOf(path) || '';
    if (!(await dirExists(env, parent))) {
      return { ok: false, error: '上级目录已被删除，请先恢复上级目录' };
    }

    const start = path + '/';
    const end = path + '0';

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE dirs
         SET is_deleted = 0, trash_date = NULL, original_path = NULL
         WHERE path = ? OR (path >= ? AND path < ?)`
      ).bind(path, start, end),
      env.DB.prepare(
        `UPDATE files
         SET is_deleted = 0, trash_date = NULL, original_path = NULL
         WHERE path = ? OR (path >= ? AND path < ?)`
      ).bind(path, start, end),
    ]);

    return { ok: true };
  }

  return { ok: false, error: '未知类型' };
}

// ---------- 移动 ----------
export async function moveItem(env, type, source, targetDir) {
  if (type === 'file') {
    const row = await env.DB.prepare(
      'SELECT id, name, path FROM files WHERE id = ? AND is_deleted = 0'
    )
      .bind(source)
      .first();
    if (!row) return { ok: false, error: '文件不存在或已删除' };

    if (row.path === targetDir) return { ok: false, error: '文件已在该目录下，无需移动' };

    const conflict = await env.DB.prepare(
      'SELECT id FROM files WHERE path = ? AND name = ? AND is_deleted = 0 AND id != ?'
    )
      .bind(targetDir, row.name, source)
      .first();
    if (conflict) return { ok: false, error: '目标目录下已有同名文件' };

    await env.DB.prepare('UPDATE files SET path = ? WHERE id = ?')
      .bind(targetDir, source)
      .run();
    return { ok: true };
  }

  if (type === 'dir') {
    const oldPath = source;
    if (!oldPath) return { ok: false, error: '不能移动根目录' };

    // 防止移入自身或其子目录
    if (targetDir === oldPath || targetDir.startsWith(oldPath + '/')) {
      return { ok: false, error: '不能移动到自身或其子目录中' };
    }

    const folderName = basename(oldPath);
    const newPath = joinPath(targetDir, folderName);

    if (newPath === oldPath) return { ok: false, error: '目录已在该位置，无需移动' };

    // 目标子树内任何已存在的目录行（含回收站中的）都会引发主键冲突
    const clash = await env.DB.prepare(
      'SELECT path FROM dirs WHERE path = ? OR (path >= ? AND path < ?)'
    )
      .bind(newPath, newPath + '/', newPath + '0')
      .first();
    if (clash) return { ok: false, error: '目标路径已被占用（可能存在于回收站中）' };

    // 用 substr 精确剥离旧前缀，避免 replace 的子串污染
    // L = 旧目录路径长度 + 1，用于 substr 跳过 "oldPath" 本身
    const L = oldPath.length + 1;
    const start = oldPath + '/';
    const end = oldPath + '0';

    await env.DB.batch([
      // 目录自身：path 改为新路径，parent_path 改为目标目录
      env.DB.prepare('UPDATE dirs SET path = ?, parent_path = ? WHERE path = ?')
        .bind(newPath, targetDir, oldPath),
      // 子孙目录：path 和 parent_path 同步前缀替换
      env.DB.prepare(
        'UPDATE dirs SET path = ? || substr(path, ?), parent_path = ? || substr(parent_path, ?) WHERE path >= ? AND path < ?'
      ).bind(newPath, L, newPath, L, start, end),
      // 文件（含直属文件 path = oldPath 和子孙文件）：只改 path
      env.DB.prepare(
        'UPDATE files SET path = ? || substr(path, ?) WHERE path = ? OR (path >= ? AND path < ?)'
      ).bind(newPath, L, oldPath, start, end),
    ]);

    return { ok: true };
  }

  return { ok: false, error: '未知类型' };
}

// ---------- 复制 ----------
export async function copyItem(env, type, source, targetDir) {
  if (type === 'file') {
    const meta = await getFileMeta(env, source);
    if (!meta || meta.isDeleted) return { ok: false, error: '找不到源文件' };

    const newId = await newShortId(env);
    await env.DB.prepare(
      `INSERT INTO files (id, file_id, message_id, name, size, mime, path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(newId, meta.fileId, meta.messageId, meta.name, meta.size, meta.mime, targetDir, Date.now())
      .run();
    return { ok: true, newId };
  }

  if (type === 'dir') {
    // 防止复制进自身或其子目录
    if (targetDir === source || targetDir.startsWith(source + '/')) {
      return { ok: false, error: '不能复制到自身或其子目录中' };
    }

    const firstNewPath = joinPath(targetDir, basename(source));
    // 目标已存在同名目录（含回收站中的）会导致复制结果不可见，直接拒绝
    const clash = await env.DB.prepare('SELECT path FROM dirs WHERE path = ?')
      .bind(firstNewPath)
      .first();
    if (clash) return { ok: false, error: '目标目录下已有同名文件夹' };

    const stack = [{ oldPath: source, newParent: targetDir }];
    while (stack.length) {
      const { oldPath, newParent } = stack.pop();
      const newPath = joinPath(newParent, basename(oldPath));

      await addDir(env, newPath);

      const files = await env.DB.prepare(
        'SELECT * FROM files WHERE path = ? AND is_deleted = 0'
      )
        .bind(oldPath)
        .all();

      for (const f of files.results) {
        const newId = await newShortId(env);
        await env.DB.prepare(
          `INSERT INTO files (id, file_id, message_id, name, size, mime, path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(newId, f.file_id, f.message_id, f.name, f.size, f.mime, newPath, Date.now())
          .run();
      }

      const subDirs = await env.DB.prepare(
        'SELECT path FROM dirs WHERE parent_path = ? AND is_deleted = 0'
      )
        .bind(oldPath)
        .all();
      for (const d of subDirs.results) {
        stack.push({ oldPath: d.path, newParent: newPath });
      }
    }
    return { ok: true };
  }

  return { ok: false, error: '未知类型' };
}
