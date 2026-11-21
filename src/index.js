import { renderPage } from './page.js';
import { handleWebhook } from './webhook.js';
import { handleUpload } from './upload.js';
import { handleFile } from './file.js';
import { handleList } from './list.js';
import { json, normalizePath, joinPath, nameError, parentOf } from './utils.js';
import {
  addDir, dirExists, initSchema,
  softDeleteFile, softDeleteDir,
  restoreItem,
  moveItem, copyItem, renameItem, findNameClash, conflictResult,
  getTrashList, getAllDirs
} from './kv.js';
import { deleteChannelMessage } from './telegram.js';

// 获取北京时间日期字符串 (例如 20261026)
function getBeijingDate() {
  const now = new Date();
  const bjTime = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = bjTime.getUTCFullYear();
  const m = String(bjTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bjTime.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// 新建目录
async function handleMkdir(request, env) {
  let body;
  try { body = await request.json(); } catch (err) { return json({ error: '无效请求' }, 400); }

  const parent = normalizePath(body.parent || '');
  const name = (body.name || '').trim();

  const invalid = nameError(name);
  if (invalid) return json({ error: invalid }, 400);
  if (!(await dirExists(env, parent))) return json({ error: '父目录不存在' }, 400);

  const clash = await findNameClash(env, parent, name);
  if (clash) return json(conflictResult(name, parent, clash), 409);

  const path = joinPath(parent, name);
  await addDir(env, path);
  return json({ ok: true, path });
}

// 删除（移入回收站）
async function handleDelete(request, env) {
  let body;
  try { body = await request.json(); } catch (err) { return json({ error: '无效请求' }, 400); }

  const type = body.type;
  const targetDate = getBeijingDate();
  const now = Date.now();

  if (type === 'file') {
    const id = body.id;
    if (!id) return json({ error: '缺少 id' }, 400);
    const res = await softDeleteFile(env, id, targetDate, now);
    if (!res.ok) return json({ error: '文件不存在' }, 404);
    return json({ ok: true });
  }

  if (type === 'dir') {
    const path = normalizePath(body.path || '');
    if (path === '') return json({ error: '不能删除根目录' }, 400);
    const res = await softDeleteDir(env, path, targetDate, now);
    if (!res.ok) return json({ error: '删除失败' }, 400);
    return json({ ok: true, fileCount: res.fileCount });
  }

  return json({ error: '未知类型' }, 400);
}

// 获取回收站列表
async function handleTrash(request, env) {
  const list = await getTrashList(env);
  return json(list);
}

// 恢复文件或目录
async function handleRestore(request, env) {
  let body;
  try { body = await request.json(); } catch (err) { return json({ error: '无效请求' }, 400); }
  
  const { type, id, path } = body;
  const res = await restoreItem(env, type, id, path);
  if (!res.ok) return json({ error: res.error || '恢复失败' }, 400);
  return json({ ok: true });
}

// 移动 / 复制
async function handleMoveCopy(request, env, action) {
  let body;
  try { body = await request.json(); } catch (err) { return json({ error: '无效请求' }, 400); }

  const { type, source } = body; // source: 文件的 id 或目录的 path
  const target = normalizePath(body.targetDir || '');

  if (!source) return json({ error: '缺少操作对象' }, 400);
  if (!(await dirExists(env, target))) return json({ error: '目标目录不存在' }, 400);

  // 同名冲突策略由前端冲突弹窗决定；未指定时后端不擅自处置
  const opts = { trashDate: getBeijingDate() };
  if (['overwrite', 'skip', 'rename'].indexOf(body.onConflict) >= 0) opts.onConflict = body.onConflict;

  const res = action === 'move'
    ? await moveItem(env, type, source, target, opts)
    : await copyItem(env, type, source, target, opts);

  if (res.conflict) return json(res, 409);
  if (!res.ok) return json({ error: res.error || '操作失败' }, 400);
  return json({ ok: true, skipped: !!res.skipped, name: res.name || null, path: res.path || null });
}

// 重命名
async function handleRename(request, env) {
  let body;
  try { body = await request.json(); } catch (err) { return json({ error: '无效请求' }, 400); }

  const { type, source } = body;
  const newName = String(body.newName || '').trim();

  if (!source) return json({ error: '缺少操作对象' }, 400);
  const invalid = nameError(newName);
  if (invalid) return json({ error: invalid }, 400);

  const res = await renameItem(env, type, source, newName);
  if (res.conflict) return json(res, 409);
  if (!res.ok) return json({ error: res.error || '重命名失败' }, 400);
  return json({ ok: true, name: res.name || null, path: res.path || null });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      await initSchema(env);

      // --- Telegram & 基础上传 ---
      if (pathname === '/webhook' && request.method === 'POST') return handleWebhook(request, env);
      if (pathname === '/api/upload' && request.method === 'POST') return handleUpload(request, env);

      // --- 列表获取 ---
      if (pathname === '/api/list' && request.method === 'GET') {
        const path = normalizePath(url.searchParams.get('path') || '');
        return handleList(env, path);
      }

      // --- 目录操作 ---
      if (pathname === '/api/mkdir' && request.method === 'POST') return handleMkdir(request, env);
      
      // --- 删除（移入回收站） ---
      if (pathname === '/api/delete' && request.method === 'POST') return handleDelete(request, env);

      // --- 回收站与恢复 ---
      if (pathname === '/api/trash' && request.method === 'GET') return handleTrash(request, env);
      if (pathname === '/api/restore' && request.method === 'POST') return handleRestore(request, env);

      // --- 目录树（供移动/复制弹窗使用） ---
      if (pathname === '/api/tree' && request.method === 'GET') {
        const dirs = await getAllDirs(env);
        return json(dirs);
      }

      // --- 移动、复制与重命名 ---
      if (pathname === '/api/move' && request.method === 'POST') return handleMoveCopy(request, env, 'move');
      if (pathname === '/api/copy' && request.method === 'POST') return handleMoveCopy(request, env, 'copy');
      if (pathname === '/api/rename' && request.method === 'POST') return handleRename(request, env);

      // --- 文件下载 ---
      const fileMatch = pathname.match(/^\/file\/([A-Za-z0-9]{10,14})$/);
      if (fileMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        return handleFile(request, env, fileMatch[1]);
      }

      if (pathname === '/favicon.ico') return new Response(null, { status: 204 });

      // --- 页面渲染 ---
      if (request.method === 'GET') {
        return new Response(renderPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('未捕获的错误:', err);
      return json({ error: '服务器内部错误' }, 500);
    }
  },
};