import { parentOf, basename, joinPath } from '../utils.js';
import { dirExists, relocateDir, isPathSubtreeBusy } from './dirs.js';
import { findNameClash, uniqueName, conflictResult, DIR_NO_OVERWRITE } from './naming.js';

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
// opts: { onConflict: 'overwrite'|'skip'|'rename', trashDate, targetDir }
export async function restoreItem(env, type, id, opts) {
  opts = opts || {};
  const onConflict = opts.onConflict;
  const trashDate = opts.trashDate;

  if (type === 'file') {
    const row = await env.DB.prepare(
      'SELECT original_path, path, name FROM files WHERE id = ? AND is_deleted = 1'
    )
      .bind(id)
      .first();
    if (!row) return { ok: false, error: '回收站中无此文件' };

    const targetDir = opts.targetDir !== undefined
      ? opts.targetDir
      : (row.original_path || row.path || '');

    if (!(await dirExists(env, targetDir))) {
      return { ok: false, error: '原目录已被删除，请先恢复所属目录' };
    }

    const name = row.name;
    const clash = await findNameClash(env, targetDir, name, { id: id });
    if (clash) {
      if (!onConflict) return conflictResult(name, targetDir, clash);
      if (onConflict === 'skip') return { ok: true, skipped: true };
      if (onConflict === 'overwrite') {
        if (clash.kind === 'dir') return { ok: false, error: '同名项是文件夹，请改用保留两者或跳过' };
        if (!trashDate) return { ok: false, error: '缺少回收站日期' };
        await softDeleteFile(env, clash.id, trashDate);
      }
    }

    const finalName = onConflict === 'rename'
      ? await uniqueName(env, targetDir, name, { id: id })
      : name;

    await env.DB.prepare(
      `UPDATE files
       SET is_deleted = 0, path = ?, name = ?, trash_date = NULL, original_path = NULL
       WHERE id = ?`
    )
      .bind(targetDir, finalName, id)
      .run();

    return { ok: true, name: finalName };
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

    const folderName = basename(path);
    const origParent = parentOf(path) || '';
    const targetDir = opts.targetDir !== undefined ? opts.targetDir : origParent;

    if (!(await dirExists(env, targetDir))) {
      return { ok: false, error: '上级目录已被删除，请先恢复上级目录' };
    }

    let newPath = joinPath(targetDir, folderName);

    const clash = await findNameClash(env, targetDir, folderName, { path: path });
    if (clash) {
      if (!onConflict) return conflictResult(folderName, targetDir, clash);
      if (onConflict === 'skip') return { ok: true, skipped: true };
      if (onConflict === 'overwrite') return { ok: false, error: DIR_NO_OVERWRITE };
      newPath = joinPath(targetDir, await uniqueName(env, targetDir, folderName, { path: path }));
    }

    if (await isPathSubtreeBusy(env, newPath)) {
      return { ok: false, error: '目标路径已被占用（可能存在于回收站中）' };
    }

    // 如果目标位置和原路径不同，需要先移动再恢复
    if (newPath !== path) {
      await relocateDir(env, path, newPath, targetDir);
    }

    const start = newPath + '/';
    const end = newPath + '0';

    // relocateDir 可能已把路径改成 newPath，统一用 newPath 匹配
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE dirs
         SET is_deleted = 0, trash_date = NULL, original_path = NULL
         WHERE path = ? OR (path >= ? AND path < ?)`
      ).bind(newPath, start, end),
      env.DB.prepare(
        `UPDATE files
         SET is_deleted = 0, trash_date = NULL, original_path = NULL
         WHERE path = ? OR (path >= ? AND path < ?)`
      ).bind(newPath, start, end),
    ]);

    return { ok: true };
  }

  return { ok: false, error: '未知类型' };
}
