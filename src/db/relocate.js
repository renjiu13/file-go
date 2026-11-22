import { parentOf, basename, joinPath } from '../utils.js';
import { newShortId } from './ids.js';
import { getFileMeta } from './files.js';
import { addDir, dirExists, relocateDir, isPathSubtreeBusy } from './dirs.js';
import { findNameClash, uniqueName, conflictResult, DIR_NO_OVERWRITE } from './naming.js';
import { softDeleteFile } from './trash.js';

// ---------- 重命名 ----------
export async function renameItem(env, type, source, newName, opts) {
  opts = opts || {};
  const onConflict = opts.onConflict;

  if (type === 'file') {
    const row = await env.DB.prepare('SELECT name, path FROM files WHERE id = ? AND is_deleted = 0')
      .bind(source)
      .first();
    if (!row) return { ok: false, error: '文件不存在或已删除' };
    if (row.name === newName) return { ok: false, error: '名称未改变' };

    const clash = await findNameClash(env, row.path, newName, { id: source });
    if (clash) {
      if (!onConflict) return conflictResult(newName, row.path, clash);
      if (onConflict === 'skip') return { ok: true, skipped: true };
      if (onConflict === 'overwrite') {
        if (clash.kind === 'dir') return { ok: false, error: '同名项是文件夹，请改用保留两者或跳过' };
        if (!opts.trashDate) return { ok: false, error: '缺少回收站日期' };
        await softDeleteFile(env, clash.id, opts.trashDate);
      }
    }

    const finalName = onConflict === 'rename'
      ? await uniqueName(env, row.path, newName, { id: source })
      : newName;

    await env.DB.prepare('UPDATE files SET name = ? WHERE id = ?').bind(finalName, source).run();
    return { ok: true, name: finalName, path: row.path };
  }

  if (type === 'dir') {
    const oldPath = source;
    if (!oldPath) return { ok: false, error: '不能重命名根目录' };
    if (!(await dirExists(env, oldPath))) return { ok: false, error: '目录不存在或已删除' };

    const parent = parentOf(oldPath) || '';
    if (basename(oldPath) === newName) return { ok: false, error: '名称未改变' };

    const clash = await findNameClash(env, parent, newName, { path: oldPath });
    if (clash) {
      if (!onConflict) return conflictResult(newName, parent, clash);
      if (onConflict === 'skip') return { ok: true, skipped: true };
      if (onConflict === 'overwrite') return { ok: false, error: DIR_NO_OVERWRITE };
    }

    const finalName = onConflict === 'rename'
      ? await uniqueName(env, parent, newName, { path: oldPath })
      : newName;

    const newPath = joinPath(parent, finalName);
    if (await isPathSubtreeBusy(env, newPath)) {
      return { ok: false, error: '该名称已被占用（可能位于回收站）' };
    }

    await relocateDir(env, oldPath, newPath, parent);
    return { ok: true, path: newPath, oldPath, name: finalName };
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
