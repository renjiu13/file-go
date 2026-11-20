import { renderPage } from './page.js';
import { handleWebhook } from './webhook.js';
import { handleUpload } from './upload.js';
import { handleFile } from './file.js';
import { handleList } from './list.js';
import { json } from './utils.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // 首页：上传页面 + 最近文件列表
      if (pathname === '/' && request.method === 'GET') {
        return new Response(renderPage(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // Telegram Webhook
      if (pathname === '/webhook' && request.method === 'POST') {
        return handleWebhook(request, env);
      }

      // 网页上传
      if (pathname === '/api/upload' && request.method === 'POST') {
        return handleUpload(request, env);
      }

      // 文件列表 API
      if (pathname === '/api/files' && request.method === 'GET') {
        return handleList(env);
      }

      // 文件下载 / 预览（支持 10~14 位短 ID）
      const fileMatch = pathname.match(/^\/file\/([A-Za-z0-9]{10,14})$/);
      if (fileMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        return handleFile(request, env, fileMatch[1]);
      }

      // 404
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('未捕获的错误:', err);
      return json({ error: '服务器内部错误' }, 500);
    }
  },
};
