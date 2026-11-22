import { softDeleteFile, softDeleteDir, restoreItem } from './trash.js';
import { moveItem, copyItem } from './relocate.js';

// ---------- 批量操作 ----------
// 统一返回：{ success, skipped, failed, results: [{type, source, ok, ...}] }
// 逐项执行，部分失败不影响其他项；冲突缺省时直接返回冲突项。

function makeBatchResult() {
  return { success: 0, skipped: 0, failed: 0, results: [] };
}

function pushResult(out, item, res) {
  const entry = { type: item.type, source: item.source || item.id || item.path };
  if (res.ok && res.skipped) {
    out.skipped++;
    entry.ok = true;
    entry.skipped = true;
  } else if (res.ok) {
    out.success++;
    entry.ok = true;
    if (res.name) entry.name = res.name;
    if (res.path) entry.path = res.path;
    if (res.newId) entry.newId = res.newId;
  } else if (res.conflict) {
    out.failed++;
    entry.ok = false;
    entry.conflict = true;
    entry.clashKind = res.clashKind;
    entry.clashName = res.clashName;
    entry.name = res.name;
    entry.targetDir = res.targetDir;
    entry.error = res.error;
  } else {
    out.failed++;
    entry.ok = false;
    entry.error = res.error || '操作失败';
  }
  out.results.push(entry);
}

// 批量放入回收站
export async function batchTrash(env, items, trashDate) {
  const out = makeBatchResult();
  for (const it of items) {
    try {
      if (it.type === 'file') {
        const res = await softDeleteFile(env, it.id, trashDate);
        pushResult(out, it, res.ok ? { ok: true } : { ok: false, error: '文件不存在或已删除' });
      } else if (it.type === 'dir') {
        const res = await softDeleteDir(env, it.path, trashDate);
        pushResult(out, it, res.ok ? { ok: true } : { ok: false, error: '删除失败' });
      } else {
        pushResult(out, it, { ok: false, error: '未知类型' });
      }
    } catch (e) {
      pushResult(out, it, { ok: false, error: e.message || '系统错误' });
    }
  }
  return out;
}

// 批量恢复
export async function batchRestore(env, items, opts = {}) {
  const out = makeBatchResult();
  // overwrite 时需要回收站日期归档被替换项
  const restoreOpts = { ...opts, trashDate: opts.trashDate };
  for (const it of items) {
    try {
      const id = it.type === 'dir' ? it.path : it.id;
      const res = await restoreItem(env, it.type, id, restoreOpts);
      pushResult(out, it, res);
    } catch (e) {
      pushResult(out, it, { ok: false, error: e.message || '系统错误' });
    }
  }
  return out;
}

// 批量移动
export async function batchMove(env, items, targetDir, opts = {}) {
  const out = makeBatchResult();
  for (const it of items) {
    try {
      const source = it.type === 'dir' ? it.path : it.id;
      const res = await moveItem(env, it.type, source, targetDir, opts);
      pushResult(out, it, res);
    } catch (e) {
      pushResult(out, it, { ok: false, error: e.message || '系统错误' });
    }
  }
  return out;
}

// 批量复制
export async function batchCopy(env, items, targetDir, opts = {}) {
  const out = makeBatchResult();
  for (const it of items) {
    try {
      const source = it.type === 'dir' ? it.path : it.id;
      const res = await copyItem(env, it.type, source, targetDir, opts);
      pushResult(out, it, res);
    } catch (e) {
      pushResult(out, it, { ok: false, error: e.message || '系统错误' });
    }
  }
  return out;
}
