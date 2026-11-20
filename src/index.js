import { renderPage } from './page.js';
import { handleWebhook } from './webhook.js';
import { handleUpload } from './upload.js';
import { handleFile } from './file.js';
import { handleList } from './list.js';
import { json, normalizePath, joinPath, isValidName } from './utils.js';
import { addDir, dirExists, initSchema, deleteFile, deleteDir } from './kv.js';
import { deleteChannelMessage } from './telegram.js';

// 新建目录
async function handleMkdir(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: '无效请求' }, 400);
  }

  const parent = normalizePath(body.parent || '');
  const name = (body.name || '').trim();

  if (!isValidName(name)) {
    return json({ error: '目录名不合法' }, 400);
  }
  if (!(await dirExists(env, parent))) {
    return json({ error: '父目录不存在' }, 400);
  }

  const path = joinPath(parent, name);
  if (await dirExists(env, path)) {
    return json({ error: '目录已存在' }, 409);
  }

  await addDir(env, path);
  return json({ ok: true, path });
}

// 删除文件或目录（级联）
async function handleDelete(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: '无效请求' }, 400);
  }

  const type = body.type;

  if (type === 'file') {
    const id = body.id;
    if (!id) return json({ error: '缺少 id' }, 400);

    const res = await deleteFile(env, id);
    if (!res.ok) return json({ error: '文件不存在' }, 404);

    // 尝试删除 Telegram 频道中的消息（仅 48 小时内有效，失败忽略）
    if (res.messageId != null) {
      await deleteChannelMessage(env, res.messageId);
    }
    return json({ ok: true });
  }

  if (type === 'dir') {
    const path = normalizePath(body.path || '');
    if (path === '') return json({ error: '不能删除根目录' }, 400);

    const res = await deleteDir(env, path);
    if (!res.ok) return json({ error: '删除失败' }, 400);

    // 尝试删除频道中对应文件的消息
    for (const messageId of res.messageIds) {
      await deleteChannelMessage(env, messageId);
    }
    return json({ ok: true, fileCount: res.fileCount });
  }

  return json({ error: '未知类型' }, 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // 初始化数据库表结构（幂等）
      await initSchema(env);

      // Telegram Webhook
      if (pathname === '/webhook' && request.method === 'POST') {
        return handleWebhook(request, env);
      }

      // 网页上传
      if (pathname === '/api/upload' && request.method === 'POST') {
        return handleUpload(request, env);
      }

      // 目录内容
      if (pathname === '/api/list' && request.method === 'GET') {
        const path = normalizePath(url.searchParams.get('path') || '');
        return handleList(env, path);
      }

      // 新建目录
      if (pathname === '/api/mkdir' && request.method === 'POST') {
        return handleMkdir(request, env);
      }

      // 删除文件或目录
      if (pathname === '/api/delete' && request.method === 'POST') {
        return handleDelete(request, env);
      }

      // 文件下载 / 预览（支持 10~14 位短 ID）
      const fileMatch = pathname.match(/^\/file\/([A-Za-z0-9]{10,14})$/);
      if (fileMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        return handleFile(request, env, fileMatch[1]);
      }

      // favicon 忽略
      if (pathname === '/favicon.ico') {
        return new Response(null, { status: 204 });
      }

      // 首页 / 目录浏览（SPA，前端解析 pathname 决定当前目录）
      if (request.method === 'GET') {
        return new Response(renderPage(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('未捕获的错误:', err);
      return json({ error: '服务器内部错误' }, 500);
    }
  },
};
