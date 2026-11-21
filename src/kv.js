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

// ---------- 同名冲突 ----------
// Windows 语义：同一目录内名称不区分大小写且唯一，文件与文件夹共用一个命名空间。
// exclude 形如 { id } 或 { path }，用于重命名/移动时排除自身。
export async function findNameClash(env, parentPath, name, exclude) {
  const excludeId = exclude && exclude.id ? exclude.id : null;
  const excludePath = exclude && exclude.path ? exclude.path : null;

  const sql = excludeId
    ? 'SELECT id, name FROM files WHERE path = ? AND LOWER(name) = LOWER(?) AND is_deleted = 0 AND id != ?'
    : 'SELECT id, name FROM files WHERE path = ? AND LOWER(name) = LOWER(?) AND is_deleted = 0';
  const stmt = excludeId
    ? env.DB.prepare(sql).bind(parentPath, name, excludeId)
    : env.DB.prepare(sql).bind(parentPath, name);
  const fileRow = await stmt.first();
  if (fileRow) return { kind: 'file', id: fileRow.id, name: fileRow.name };

  // 回收站中的目录仍占用 path 主键，所以这里不过滤 is_deleted
  const dirsRes = await env.DB.prepare('SELECT path FROM dirs WHERE parent_path = ?')
    .bind(parentPath)
    .all();
  const lower = String(name).toLowerCase();
  for (const r of dirsRes.results) {
    if (r.path === excludePath) continue;
    if (basename(r.path).toLowerCase() === lower) {
      return { kind: 'dir', path: r.path, name: basename(r.path) };
    }
  }
  return null;
}

// 回收站中的目录仍占用原 path，替换无法落位，只能保留两者或跳过
const DIR_NO_OVERWRITE = '文件夹同名冲突不支持替换，请选择保留两者或跳过';

// Windows 的「保留两者」命名：report.pdf → report (1).pdf
export function buildCandidate(name, n) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} (${n})`;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

export async function uniqueName(env, parentPath, name, exclude) {
  if (!(await findNameClash(env, parentPath, name, exclude))) return name;
  for (let i = 1; i <= 999; i++) {
    const candidate = buildCandidate(name, i);
    if (!(await findNameClash(env, parentPath, candidate, exclude))) return candidate;
  }
  return `${name} (${Date.now()})`;
}

// 冲突时返回给上层统一结构，前端据此弹出 替换/跳过/保留两者
export function conflictResult(name, targetDir, clash) {
  return {
    ok: false,
    conflict: true,
    name,
    targetDir,
    clashKind: clash.kind,
    clashName: clash.name,
    clashId: clash.id || null,
    clashPath: clash.path || null,
    error: `此位置已包含名为“${clash.name}”的${clash.kind === 'dir' ? '文件夹' : '文件'}`,
  };
}

// 把 oldPath 整棵子树搬到 newPath（父目录改为 newParent），前缀用 substr 精确剥离
async function relocateDir(env, oldPath, newPath, newParent) {
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
async function isPathSubtreeBusy(env, path) {
  const row = await env.DB.prepare('SELECT path FROM dirs WHERE path = ? OR (path >= ? AND path < ?)')
    .bind(path, path + '/', path + '0')
    .first();
  return !!row;
}

// ---------- 重命名 ----------
export async function renameItem(env, type, source, newName) {
  if (type === 'file') {
    const row = await env.DB.prepare('SELECT name, path FROM files WHERE id = ? AND is_deleted = 0')
      .bind(source)
      .first();
    if (!row) return { ok: false, error: '文件不存在或已删除' };
    if (row.name === newName) return { ok: false, error: '名称未改变' };

    const clash = await findNameClash(env, row.path, newName, { id: source });
    if (clash) return conflictResult(newName, row.path, clash);

    await env.DB.prepare('UPDATE files SET name = ? WHERE id = ?').bind(newName, source).run();
    return { ok: true, name: newName, path: row.path };
  }

  if (type === 'dir') {
    const oldPath = source;
    if (!oldPath) return { ok: false, error: '不能重命名根目录' };
    if (!(await dirExists(env, oldPath))) return { ok: false, error: '目录不存在或已删除' };

    const parent = parentOf(oldPath) || '';
    if (basename(oldPath) === newName) return { ok: false, error: '名称未改变' };

    const clash = await findNameClash(env, parent, newName, { path: oldPath });
    if (clash) return conflictResult(newName, parent, clash);

    const newPath = joinPath(parent, newName);
    if (await isPathSubtreeBusy(env, newPath)) {
      return { ok: false, error: '该名称已被占用（可能位于回收站）' };
    }

    await relocateDir(env, oldPath, newPath, parent);
    return { ok: true, path: newPath, oldPath };
  }

  return { ok: false, error: '未知类型' };
}

// ---------- 移动 ----------
// opts: { onConflict: 'overwrite' | 'skip' | 'rename'，缺省时冲突直接返回 }
//       { trashDate: 覆盖时被替换项的回收站归档日期 }
export async function moveItem(env, type, source, targetDir, opts = {}) {
  const onConflict = opts.onConflict;

  if (type === 'file') {
    const row = await env.DB.prepare(
      'SELECT id, name, path FROM files WHERE id = ? AND is_deleted = 0'
    )
      .bind(source)
      .first();
    if (!row) return { ok: false, error: '文件不存在或已删除' };

    if (row.path === targetDir) return { ok: false, error: '文件已在该目录下，无需移动' };

    const clash = await findNameClash(env, targetDir, row.name, { id: source });
    if (clash) {
      if (!onConflict) return conflictResult(row.name, targetDir, clash);
      if (onConflict === 'skip') return { ok: true, skipped: true };
      if (onConflict === 'overwrite') {
        if (clash.kind === 'dir') return { ok: false, error: '同名项是文件夹，请改用保留两者或跳过' };
        if (!opts.trashDate) return { ok: false, error: '缺少回收站日期' };
        await softDeleteFile(env, clash.id, opts.trashDate);
      }
    }

    const finalName = onConflict === 'rename'
      ? await uniqueName(env, targetDir, row.name, { id: source })
      : row.name;

    await env.DB.prepare('UPDATE files SET path = ?, name = ? WHERE id = ?')
      .bind(targetDir, finalName, source)
      .run();
    return { ok: true, name: finalName };
  }

  if (type === 'dir') {
    const oldPath = source;
    if (!oldPath) return { ok: false, error: '不能移动根目录' };
    if (!(await dirExists(env, oldPath))) return { ok: false, error: '目录不存在或已删除' };

    // 防止移入自身或其子目录
    if (targetDir === oldPath || targetDir.startsWith(oldPath + '/')) {
      return { ok: false, error: '不能移动到自身或其子目录中' };
    }

    const folderName = basename(oldPath);
    let newPath = joinPath(targetDir, folderName);

    if (newPath === oldPath) return { ok: false, error: '目录已在该位置，无需移动' };

    // 目录不做「替换」：回收站里的同名目录仍占用原路径，无法安全落位
    const clash = await findNameClash(env, targetDir, folderName, { path: oldPath });
    if (clash) {
      if (!onConflict) return conflictResult(folderName, targetDir, clash);
      if (onConflict === 'skip') return { ok: true, skipped: true };
      if (onConflict === 'overwrite') return { ok: false, error: DIR_NO_OVERWRITE };
      newPath = joinPath(targetDir, await uniqueName(env, targetDir, folderName, { path: oldPath }));
    }

    if (await isPathSubtreeBusy(env, newPath)) {
      return { ok: false, error: '目标路径已被占用（可能存在于回收站中）' };
    }

    await relocateDir(env, oldPath, newPath, targetDir);
    return { ok: true, path: newPath };
  }

  return { ok: false, error: '未知类型' };
}

// ---------- 复制 ----------
// 复制时不排除源自身：把 a.txt 粘贴到它所在的目录同样算同名冲突，
// 与 Windows 一致，交给冲突对话框决定。
export async function copyItem(env, type, source, targetDir, opts = {}) {
  const onConflict = opts.onConflict;

  if (type === 'file') {
    const meta = await getFileMeta(env, source);
    if (!meta || meta.isDeleted) return { ok: false, error: '找不到源文件' };

    const clash = await findNameClash(env, targetDir, meta.name);
    if (clash) {
      if (!onConflict) return conflictResult(meta.name, targetDir, clash);
      if (onConflict === 'skip') return { ok: true, skipped: true };
      if (onConflict === 'overwrite') {
        // 粘贴回自己所在的目录：覆盖自己没有任何效果
        if (clash.kind === 'file' && clash.id === source) return { ok: true, skipped: true, newId: source };
        if (clash.kind === 'dir') return { ok: false, error: '同名项是文件夹，请改用保留两者或跳过' };
        if (!opts.trashDate) return { ok: false, error: '缺少回收站日期' };
        await softDeleteFile(env, clash.id, opts.trashDate);
      }
    }

    const finalName = onConflict === 'rename'
      ? await uniqueName(env, targetDir, meta.name)
      : meta.name;

    const newId = await newShortId(env);
    await env.DB.prepare(
      `INSERT INTO files (id, file_id, message_id, name, size, mime, path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(newId, meta.fileId, meta.messageId, finalName, meta.size, meta.mime, targetDir, Date.now())
      .run();
    return { ok: true, newId, name: finalName };
  }

  if (type === 'dir') {
    if (!(await dirExists(env, source))) return { ok: false, error: '目录不存在或已删除' };

    // 防止复制进自身或其子目录
    if (targetDir === source || targetDir.startsWith(source + '/')) {
      return { ok: false, error: '不能复制到自身或其子目录中' };
    }

    const folderName = basename(source);
    let newPath = joinPath(targetDir, folderName);

    // 同移动：回收站中的同名目录仍占用路径，替换无法安全落位
    const clash = await findNameClash(env, targetDir, folderName);
    if (clash) {
      if (!onConflict) return conflictResult(folderName, targetDir, clash);
      if (onConflict === 'skip') return { ok: true, skipped: true };
      if (onConflict === 'overwrite') return { ok: false, error: DIR_NO_OVERWRITE };
      newPath = joinPath(targetDir, await uniqueName(env, targetDir, folderName));
    }

    // 子树内残留的目录行（含回收站）会让复制结果不可见
    if (await isPathSubtreeBusy(env, newPath)) {
      return { ok: false, error: '目标路径已被占用（可能存在于回收站中）' };
    }

    const stack = [{ oldPath: source, destPath: newPath }];
    while (stack.length) {
      const { oldPath, destPath } = stack.pop();

      await addDir(env, destPath);

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
          .bind(newId, f.file_id, f.message_id, f.name, f.size, f.mime, destPath, Date.now())
          .run();
      }

      const subDirs = await env.DB.prepare(
        'SELECT path FROM dirs WHERE parent_path = ? AND is_deleted = 0'
      )
        .bind(oldPath)
        .all();
      for (const d of subDirs.results) {
        stack.push({ oldPath: d.path, destPath: joinPath(destPath, basename(d.path)) });
      }
    }
    return { ok: true, path: newPath };
  }

  return { ok: false, error: '未知类型' };
}
