// 登录相关接口：/login 页面、POST /api/login、POST /api/logout、GET /api/me。
import { json } from '../utils.js';
import {
  authEnabled,
  checkCsrf,
  clearSessionCookie,
  clientKey,
  currentSession,
  isSecureRequest,
  issueSession,
  readLocked,
  safeNext,
  sessionCookie,
  verifyPassword,
} from '../auth.js';
import { clearThrottle, recordFailure, throttleState } from '../db/throttle.js';
import { renderLogin } from '../page/login.js';

function html(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}

export async function handleLoginPage(env, request, url) {
  const next = safeNext(url.searchParams.get('next') || '/');
  if (!authEnabled(env)) return redirect('/');
  const session = await currentSession(env, request);
  if (session.ok) return redirect(next);
  return html(renderLogin({ next, configured: true }));
}

export async function handleLogin(env, request) {
  if (!authEnabled(env)) return json({ ok: true, open: true }, 200, { 'Cache-Control': 'no-store' });

  // 登录本身没有既有会话可被利用，不强制 CSRF 头；同源校验仍由 Origin 承担
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: '来源不合法' }, 403, { 'Cache-Control': 'no-store' });
  }

  let body = null;
  try {
    body = await request.json();
  } catch (_err) {
    return json({ error: '请求格式错误' }, 400, { 'Cache-Control': 'no-store' });
  }
  const password = body && typeof body.password === 'string' ? body.password : '';
  if (!password) return json({ error: '请输入密码' }, 400, { 'Cache-Control': 'no-store' });
  if (password.length > 4096) return json({ error: '密码过长' }, 400, { 'Cache-Control': 'no-store' });

  const now = Date.now();
  const key = 'login:' + clientKey(request);
  const state = await throttleState(env, key, now);
  if (state.blockedUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
    return json({ error: '尝试过于频繁', retryAfter }, 429, {
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfter),
    });
  }

  const ok = await verifyPassword(env, password);
  if (!ok) {
    const after = await recordFailure(env, key, now);
    if (after.blockedUntil > now) {
      const retryAfter = Math.max(1, Math.ceil((after.blockedUntil - now) / 1000));
      return json({ error: '尝试过于频繁', retryAfter }, 429, {
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfter),
      });
    }
    return json({ error: '密码错误' }, 401, { 'Cache-Control': 'no-store' });
  }

  await clearThrottle(env, key);
  const token = await issueSession(env);
  const secure = isSecureRequest(request);
  return json({ ok: true }, 200, {
    'Cache-Control': 'no-store',
    'Set-Cookie': sessionCookie(env, token, secure),
  });
}

export async function handleLogout(env, request) {
  const secure = isSecureRequest(request);
  return json({ ok: true }, 200, {
    'Cache-Control': 'no-store',
    'Set-Cookie': clearSessionCookie(secure),
  });
}

export async function handleMe(env, request) {
  const enabled = authEnabled(env);
  const session = enabled ? await currentSession(env, request) : { ok: true };
  return json(
    { auth: enabled, loggedIn: enabled ? !!session.ok : true, readLocked: readLocked(env) },
    200,
    { 'Cache-Control': 'no-store' },
  );
}

// 写操作被拒时的统一响应，供 index.js 与 WebDAV 共用
export function unauthorized() {
  return json({ error: '请先登录' }, 401, { 'Cache-Control': 'no-store' });
}

export function csrfRejected() {
  return json({ error: '缺少 CSRF 头 X-File-Go-Csrf' }, 403, { 'Cache-Control': 'no-store' });
}

export { checkCsrf };
