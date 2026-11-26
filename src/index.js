import { renderPage } from './page/index.js';
import { json } from './utils.js';
import { initSchema } from './db/schema.js';
import { runCleanup } from './cron.js';
import { handleWebhook } from './routes/webhook.js';
import { handleFile, handleManifest } from './routes/file.js';
import { handleList, handleTree } from './routes/list.js';
import {
  handleCopy,
  handleDelete,
  handleMkdir,
  handleMove,
  handleRename,
  handleRestore,
} from './routes/items.js';
import { handleBatch } from './routes/batch.js';
import { handleTrash } from './routes/trash.js';
import { authEnabled, checkCsrf, currentSession, isWriteMethod, readLocked, safeNext } from './auth.js';
import {
  csrfRejected,
  handleLogin,
  handleLoginPage,
  handleLogout,
  handleMe,
  unauthorized,
} from './routes/auth.js';
import {
  handleAbort,
  handleComplete,
  handleInit,
  handlePart,
  handleStatus,
} from './routes/upload.js';

// ID 是 16 位 base62；旧的 10 位 ID 也继续接受
const ID = '([A-Za-z0-9]{6,32})';
const RE_UPLOAD = new RegExp(`^/api/upload/${ID}$`);
const RE_UPLOAD_PART = new RegExp(`^/api/upload/${ID}/part/(\\d+)$`);
const RE_UPLOAD_COMPLETE = new RegExp(`^/api/upload/${ID}/complete$`);
const RE_UPLOAD_ABORT = new RegExp(`^/api/upload/${ID}/abort$`);
const RE_MANIFEST = new RegExp(`^/api/files/${ID}/manifest$`);
const RE_FILE = new RegExp(`^/file/${ID}$`);

const API_POST = {
  '/api/mkdir': handleMkdir,
  '/api/rename': handleRename,
  '/api/move': handleMove,
  '/api/copy': handleCopy,
  '/api/delete': handleDelete,
  '/api/restore': handleRestore,
  '/api/batch': handleBatch,
  '/api/upload/init': handleInit,
};

function webhookAllowed(env, request) {
  if (!env.WEBHOOK_SECRET) return true;
  return request.headers.get('X-Telegram-Bot-Api-Secret-Token') === env.WEBHOOK_SECRET;
}

// 未登录也能看的路径：登录页本身、公开分享、favicon
function isPublicReadPath(pathname) {
  return pathname === '/favicon.ico' || pathname.startsWith('/i/');
}

function loginRedirect(url) {
  const next = safeNext(url.pathname + url.search);
  return new Response(null, {
    status: 302,
    headers: { Location: '/login?next=' + encodeURIComponent(next), 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      await initSchema(env);

      if (method === 'OPTIONS') return new Response(null, { status: 204 });

      // --- 登录：页面与三个接口都不需要已有会话 ---
      if (pathname === '/login' && (method === 'GET' || method === 'HEAD')) {
        return handleLoginPage(env, request, url);
      }
      if (pathname === '/api/login' && method === 'POST') return handleLogin(env, request);
      if (pathname === '/api/logout' && (method === 'POST' || method === 'GET')) {
        return handleLogout(env, request);
      }
      if (pathname === '/api/me' && method === 'GET') return handleMe(env, request);

      // --- Telegram webhook ---
      if (pathname === '/webhook') {
        if (method === 'GET') return json({ ok: true });
        if (method !== 'POST') return json({ error: '方法不允许' }, 405);
        if (!webhookAllowed(env, request)) return json({ error: 'forbidden' }, 403);
        return handleWebhook(env, request);
      }

      // --- 鉴权门：只在配置了 PASSWORD_HASH 时生效 ---
      // 读默认公开（本仓库按“公开文件列表”使用），写必须登录 + CSRF；
      // REQUIRE_LOGIN_FOR_READ=1 时读也要求会话。
      if (authEnabled(env)) {
        const session = await currentSession(env, request);
        const write = isWriteMethod(method);
        if (write && !session.ok) return unauthorized();
        if (write && !checkCsrf(request, url)) return csrfRejected();
        if (!session.ok && readLocked(env) && !isPublicReadPath(pathname)) {
          if (pathname.startsWith('/api/')) return unauthorized();
          return loginRedirect(url);
        }
      }

      // --- 分片上传 ---
      let m;
      if ((m = pathname.match(RE_UPLOAD_PART)) && method === 'PUT') {
        return handlePart(env, request, m[1], m[2]);
      }
      if ((m = pathname.match(RE_UPLOAD_COMPLETE)) && method === 'POST') {
        return handleComplete(env, request, m[1]);
      }
      if ((m = pathname.match(RE_UPLOAD_ABORT)) && method === 'POST') {
        return handleAbort(env, request, m[1]);
      }
      if ((m = pathname.match(RE_UPLOAD)) && method === 'GET') {
        return handleStatus(env, m[1]);
      }

      // --- 清单与下载 ---
      if ((m = pathname.match(RE_MANIFEST)) && method === 'GET') {
        return handleManifest(env, m[1]);
      }
      if ((m = pathname.match(RE_FILE)) && (method === 'GET' || method === 'HEAD')) {
        return handleFile(env, m[1], request, url);
      }

      // --- 元数据接口 ---
      if (method === 'GET') {
        if (pathname === '/api/list') return handleList(env, url);
        if (pathname === '/api/tree') return handleTree(env);
        if (pathname === '/api/trash') return handleTrash(env);
      }
      if (method === 'POST' && API_POST[pathname]) {
        return API_POST[pathname](env, request);
      }

      if (pathname.startsWith('/api/')) return json({ error: '接口不存在' }, 404);
      if (pathname === '/favicon.ico') return new Response(null, { status: 204 });

      // --- 页面：其余 GET 一律回单页应用，路径由前端从地址栏解析 ---
      if (method === 'GET') {
        return new Response(renderPage(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('未捕获的错误:', err);
      return json({ error: '服务器内部错误', detail: err && err.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    await initSchema(env);
    ctx.waitUntil(runCleanup(env).catch((err) => console.error('清理任务失败:', err)));
  },
};
