import { basename } from '../utils.js';

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
export const DIR_NO_OVERWRITE = '文件夹同名冲突不支持替换，请选择保留两者或跳过';

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
