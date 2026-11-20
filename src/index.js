import { renderPage } from './page.js';
import { handleWebhook } from './webhook.js';
import { handleUpload } from './upload.js';
import { handleFile } from './file.js';
import { handleList } from './list.js';
import { json, normalizePath, joinPath, isValidName, parentOf } from './utils.js';
import { 
  addDir, dirExists, initSchema, 
  softDeleteFile, softDeleteDir, // 软删除
  restoreItem,                   // 恢复
  moveItem, copyItem,            // 移动、复制
  getTrashList                   // 获取回收站列表
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

  if (!isValidName(name)) return json({ error: '目录名不合法' }, 400);
  if (!(await dirExists(env, parent))) return json({ error: '父目录不存在' }, 400);

  const path = joinPath(parent, name);
  if (await dirExists(env, path)) return json({ error: '目录已存在' }, 409);

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

  const { type, source, targetDir } = body; // source: 文件的 id 或目录的 path
  const target = normalizePath(targetDir || '');
  
  if (!(await dirExists(env, target))) return json({ error: '目标目录不存在' }, 400);

  if (action === 'move') {
    const res = await moveItem(env, type, source, target);
    if (!res.ok) return json({ error: res.error || '移动失败' }, 400);
    return json({ ok: true });
  } else {
    const res = await copyItem(env, type, source, target);
    if (!res.ok) return json({ error: res.error || '复制失败' }, 400);
    return json({ ok: true });
  }
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

      // --- 移动与复制 ---
      if (pathname === '/api/move' && request.method === 'POST') return handleMoveCopy(request, env, 'move');
      if (pathname === '/api/copy' && request.method === 'POST') return handleMoveCopy(request, env, 'copy');

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