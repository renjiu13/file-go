import { renderPage } from './page/index.js';
import { json, normalizePath } from './utils.js';
import { initSchema } from './db/schema.js';
import { handleWebhook } from './routes/webhook.js';
import { handleUpload } from './routes/upload.js';
import { handleFile } from './routes/file.js';
import { handleList, handleTree } from './routes/list.js';
import { handleMkdir, handleDelete, handleRename, handleMoveCopy } from './routes/items.js';
import { handleTrash, handleRestore } from './routes/trash.js';
import { handleBatchTrash, handleBatchRestore, handleBatchMove, handleBatchCopy } from './routes/batch.js';

// 路由表：这里只做「路径 → 处理函数」的分发，业务都在 routes/ 与 db/ 里。
const API_GET = {
  '/api/list': (request, env, url) => handleList(env, normalizePath(url.searchParams.get('path') || '')),
  '/api/trash': (request, env) => handleTrash(env),
  '/api/tree': (request, env) => handleTree(env),
};

const API_POST = {
  '/api/upload': handleUpload,
  '/api/mkdir': handleMkdir,
  '/api/delete': handleDelete,
  '/api/restore': handleRestore,
  '/api/rename': handleRename,
  '/api/move': (request, env) => handleMoveCopy(request, env, 'move'),
  '/api/copy': (request, env) => handleMoveCopy(request, env, 'copy'),
  '/api/batch-trash': handleBatchTrash,
  '/api/batch-restore': handleBatchRestore,
  '/api/batch-move': handleBatchMove,
  '/api/batch-copy': handleBatchCopy,
};

const FILE_PATH = /^\/file\/([A-Za-z0-9]{10,14})$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      await initSchema(env);

      if (pathname === '/webhook' && request.method === 'POST') return handleWebhook(request, env);

      const handler = (request.method === 'GET' ? API_GET : API_POST)[pathname];
      if (handler) return handler(request, env, url);

      // --- 文件下载 ---
      const fileMatch = pathname.match(FILE_PATH);
      if (fileMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        return handleFile(request, env, fileMatch[1]);
      }

      if (pathname === '/favicon.ico') return new Response(null, { status: 204 });

      // --- 页面渲染：其余 GET 一律回单页应用，当前目录由前端从地址栏解析 ---
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
