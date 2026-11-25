// 同名冲突：Windows 语义，同一目录内名称不区分大小写且唯一，
// 文件与文件夹共用一个命名空间。

// Windows 的「保留两者」命名：report.pdf → report (1).pdf
export function buildCandidate(name, n) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} (${n})`;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

// 同目录下的活跃节点（ready 且未删除）里找同名项；excludeId 用于重命名/移动自身。
export async function findClash(env, parentId, name, excludeId = null) {
  const sql = excludeId
    ? `SELECT id, kind, name FROM nodes
       WHERE parent_id IS ? AND name = ? COLLATE NOCASE
         AND deleted_at IS NULL AND status = 'ready' AND id != ?
       LIMIT 1`
    : `SELECT id, kind, name FROM nodes
       WHERE parent_id IS ? AND name = ? COLLATE NOCASE
         AND deleted_at IS NULL AND status = 'ready'
       LIMIT 1`;
  const stmt = excludeId
    ? env.DB.prepare(sql).bind(parentId, name, excludeId)
    : env.DB.prepare(sql).bind(parentId, name);
  const row = await stmt.first();
  if (!row) return null;
  return { kind: row.kind, id: row.id, name: row.name };
}

export async function uniqueName(env, parentId, name, excludeId = null) {
  if (!(await findClash(env, parentId, name, excludeId))) return name;
  for (let i = 1; i <= 999; i++) {
    const candidate = buildCandidate(name, i);
    if (!(await findClash(env, parentId, candidate, excludeId))) return candidate;
  }
  return `${name} (${Date.now()})`;
}

// 文件夹同名冲突不支持替换（Windows 也没有「合并覆盖」语义）
export const DIR_NO_OVERWRITE = '文件夹同名冲突不支持替换，请选择保留两者或跳过';

// 冲突时返回给上层统一结构，前端据此弹出 替换/跳过/保留两者
export function conflictResult(name, parentId, clash) {
  return {
    ok: false,
    conflict: true,
    name,
    parentId,
    clashKind: clash.kind,
    clashName: clash.name,
    clashId: clash.id || null,
    error: `此位置已包含名为“${clash.name}”的${clash.kind === 'dir' ? '文件夹' : '文件'}`,
  };
}

// 把浏览器传来的 onConflict 规整到受支持的值
export function normalizeConflict(value) {
  return ['replace', 'keep-both', 'skip', 'overwrite', 'rename'].includes(value) ? value : null;
}
