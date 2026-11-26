// 登录：口令哈希、会话签名、限速，以及路由层的读写权限。
import worker from '../src/index.js';
import { fakeEnv } from './helpers/fake-d1.mjs';
import * as kv from './helpers/db.mjs';
import { createAssert } from './helpers/assert.mjs';
import {
  checkCsrf,
  clearSessionCookie,
  clientKey,
  fromBase64Url,
  hashPassword,
  issueSession,
  parsePasswordHash,
  readCookie,
  safeNext,
  sessionCookie,
  toBase64Url,
  verifyPassword,
  verifySession,
} from '../src/auth.js';

const t = createAssert();
const PASSWORD = 'hunter2';
const HASH_ITER = 1000; // 测试用低迭代，生产默认 10 万
const HASH = await hashPassword(PASSWORD, HASH_ITER);
const OTHER_HASH = await hashPassword('other', HASH_ITER);

async function envFor(extra = {}) {
  const { env, db } = fakeEnv({
    BOT_TOKEN: 'tok',
    CHAT_ID: '-100',
    PASSWORD_HASH: HASH,
    SESSION_SECRET: 'test-secret',
    ...extra,
  });
  await kv.initSchema(env);
  return { env, db };
}

function call(env, path, opts = {}) {
  return worker.fetch(new Request('http://local' + path, opts), env);
}

async function postJson(env, path, body, headers = {}) {
  return call(env, path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify(body),
  });
}

async function login(env, password = PASSWORD) {
  const res = await postJson(env, '/api/login', { password });
  const cookie = res.headers.get('Set-Cookie') || '';
  const token = cookie.split(';')[0];
  return { res, cookie, token };
}

// --- 口令哈希 ---
const parsed = parsePasswordHash(HASH);
t.ok(parsed, '哈希串可解析');
t.eq(parsed.iterations, HASH_ITER, '迭代次数写进哈希串');
t.eq(parsed.salt.length, 16, '盐 16 字节');
t.eq(parsed.hash.length, 32, 'PBKDF2-SHA256 输出 32 字节');
t.eq(parsePasswordHash('bcrypt$x'), null, '未知算法拒绝');
t.eq(parsePasswordHash('pbkdf2-sha256$abc$aa$bb'), null, '迭代次数非数字拒绝');
t.eq(parsePasswordHash('pbkdf2-sha256$100$aa$bb'), null, '迭代次数过低拒绝');
t.eq(parsePasswordHash(''), null, '空串拒绝');
t.ok((await hashPassword('x', 1000)) !== (await hashPassword('x', 1000)), '同口令两次哈希不同（随机盐）');
t.ok(await verifyPassword({ PASSWORD_HASH: HASH }, PASSWORD), '正确口令校验通过');
t.ok(!(await verifyPassword({ PASSWORD_HASH: HASH }, PASSWORD + 'x')), '错误口令校验失败');
t.ok(!(await verifyPassword({}, PASSWORD)), '未配置哈希时校验失败');

// --- 会话签名 ---
const token = await issueSession({ SESSION_SECRET: 's1', PASSWORD_HASH: HASH });
t.eq(token.split('.').length, 4, '会话串四段');
t.ok((await verifySession({ SESSION_SECRET: 's1', PASSWORD_HASH: HASH }, token)).ok, '会话可验证');
t.ok(!(await verifySession({ SESSION_SECRET: 's2', PASSWORD_HASH: HASH }, token)).ok, '换密钥后失效');
t.ok(!(await verifySession({ SESSION_SECRET: 's1', PASSWORD_HASH: OTHER_HASH }, token)).ok, '改密码后失效');
t.ok(!(await verifySession({ SESSION_SECRET: 's1', PASSWORD_HASH: HASH }, token + 'x')).ok, '篡改签名失效');
const tampered = token.split('.');
tampered[1] = String(Number(tampered[1]) + 1000);
t.ok(!(await verifySession({ SESSION_SECRET: 's1', PASSWORD_HASH: HASH }, tampered.join('.'))).ok, '篡改过期时间失效');
t.ok(!(await verifySession({ SESSION_SECRET: 's1', PASSWORD_HASH: HASH }, 'garbage')).ok, '乱码票据失效');
t.ok(!(await verifySession({ SESSION_SECRET: 's1', PASSWORD_HASH: HASH }, token, Date.now() + 400 * 86400000)).ok, '过期后失效');
t.ok((await verifySession({ SESSION_SECRET: 's1', PASSWORD_HASH: HASH, SESSION_TTL_HOURS: '1' }, token)).ok, '未过期仍有效');

// --- Cookie 与工具 ---
const cookieHeader = sessionCookie({ SESSION_SECRET: 's', SESSION_TTL_HOURS: '2' }, 'a.b.c.d', false);
t.ok(cookieHeader.startsWith('fg_session='), 'Cookie 名');
t.ok(cookieHeader.includes('HttpOnly'), 'HttpOnly');
t.ok(cookieHeader.includes('SameSite=Lax'), 'SameSite');
t.ok(cookieHeader.includes('Max-Age=7200'), 'Max-Age 跟随 TTL');
t.ok(!cookieHeader.includes('Secure'), 'http 下不带 Secure');
t.ok(sessionCookie({ SESSION_SECRET: 's' }, 'a', true).includes('Secure'), 'https 下带 Secure');
t.ok(clearSessionCookie(false).includes('Max-Age=0'), '登出清 Cookie');

const req = new Request('http://local/', { headers: { Cookie: 'a=1; fg_session=xyz.1; b=2' } });
t.eq(readCookie(req, 'fg_session'), 'xyz.1', '读取会话 Cookie');
t.eq(readCookie(req, 'missing'), null, '缺失返回 null');
t.eq(readCookie(new Request('http://local/'), 'fg_session'), null, '无 Cookie 头');

t.eq(safeNext('/docs/a'), '/docs/a', '相对路径放行');
t.eq(safeNext('//evil.com'), '/', '协议相对被拒');
t.eq(safeNext('https://evil.com'), '/', '绝对地址被拒');
t.eq(safeNext('/a\\b'), '/', '反斜杠被拒');
t.eq(safeNext(''), '/', '空值回落根');

const url = new URL('http://local/api/mkdir');
t.ok(checkCsrf(new Request('http://local/api/mkdir', { method: 'POST', headers: { 'X-File-Go-Csrf': '1' } }), url), 'CSRF 头放行');
t.ok(!checkCsrf(new Request('http://local/api/mkdir', { method: 'POST' }), url), '缺 CSRF 头拒绝');
t.ok(!checkCsrf(new Request('http://local/api/mkdir', { method: 'POST', headers: { 'X-File-Go-Csrf': '1', Origin: 'https://evil.com' } }), url), '跨站 Origin 拒绝');
t.ok(checkCsrf(new Request('http://local/api/mkdir', { method: 'POST', headers: { 'X-File-Go-Csrf': '1', Origin: 'http://local' } }), url), '同源 Origin 放行');

t.eq(clientKey(new Request('http://local/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } })), '1.2.3.4', '优先 CF 头');
t.eq(clientKey(new Request('http://local/', { headers: { 'X-Forwarded-For': '5.6.7.8, 9.9.9.9' } })), '5.6.7.8', '取第一个转发 IP');
t.eq(clientKey(new Request('http://local/')), 'unknown', '无来源标识');

// base64url 往返
const bytes = crypto.getRandomValues(new Uint8Array(32));
t.eq(Array.from(fromBase64Url(toBase64Url(bytes))), Array.from(bytes), 'base64url 往返');
t.ok(!toBase64Url(bytes).includes('+') && !toBase64Url(bytes).includes('/'), 'base64url 无保留字符');

// --- 路由：公开模式（未配置口令） ---
{
  const { env } = fakeEnv({ BOT_TOKEN: 'tok', CHAT_ID: '-100' });
  await kv.initSchema(env);
  t.eq((await call(env, '/')).status, 200, '未配置口令：页面可访问');
  t.eq((await call(env, '/api/list')).status, 200, '未配置口令：列表可访问');
  const mk = await postJson(env, '/api/mkdir', { name: 'open' });
  t.eq(mk.status, 200, '未配置口令：写操作放行（无 CSRF 也放行）');
  const me = await (await call(env, '/api/me')).json();
  t.eq(me, { auth: false, loggedIn: true, readLocked: false }, '/api/me 报告未启用登录');
  const lg = await call(env, '/login');
  t.eq(lg.status, 302, '未启用登录时 /login 跳回首页');
  t.eq(lg.headers.get('Location'), '/', '跳转地址');
}

// --- 路由：启用登录 ---
{
  const { env } = await envFor();
  t.eq((await call(env, '/')).status, 200, '启用登录：列表页公开可读');
  t.eq((await call(env, '/api/list')).status, 200, '启用登录：API 读公开');
  t.eq((await call(env, '/api/tree')).status, 200, '启用登录：目录树公开');

  const anon = await postJson(env, '/api/mkdir', { name: 'x' });
  t.eq(anon.status, 401, '未登录写操作 401');

  const badCsrf = await postJson(env, '/api/mkdir', { name: 'x' }, { 'X-File-Go-Csrf': '1', Origin: 'https://evil.com' });
  t.eq(badCsrf.status, 401, '未登录 + 跨站仍是 401（先判会话）');

  const page = await call(env, '/login');
  t.eq(page.status, 200, '登录页 200');
  const pageHtml = await page.text();
  t.ok(pageHtml.includes('id="pw"'), '登录页有密码框');
  t.ok(!pageHtml.includes('appModule'), '登录页不加载业务模块');
  t.ok(pageHtml.includes('X-File-Go-Csrf'), '登录页带 CSRF 头');

  const wrong = await postJson(env, '/api/login', { password: 'nope' });
  t.eq(wrong.status, 401, '密码错误 401');
  t.eq((await call(env, '/api/login', { method: 'POST', body: 'not-json' })).status, 400, '非 JSON 400');
  t.eq((await postJson(env, '/api/login', {})).status, 400, '空密码 400');
  const crossOrigin = await postJson(env, '/api/login', { password: PASSWORD }, { Origin: 'https://evil.com' });
  t.eq(crossOrigin.status, 403, '跨站登录 403');

  const ok = await login(env);
  t.eq(ok.res.status, 200, '正确密码 200');
  t.ok(ok.cookie.includes('HttpOnly'), '会话 Cookie HttpOnly');
  t.ok(ok.cookie.includes('SameSite=Lax'), '会话 Cookie SameSite');
  const okJson = await ok.res.json();
  t.eq(okJson.ok, true, '登录返回 ok');

  const noCsrf = await postJson(env, '/api/mkdir', { name: 'y' }, { Cookie: ok.token });
  t.eq(noCsrf.status, 403, '已登录但缺 CSRF 头 403');
  const mk = await postJson(env, '/api/mkdir', { name: 'y' }, { Cookie: ok.token, 'X-File-Go-Csrf': '1' });
  t.eq(mk.status, 200, '已登录 + CSRF 头可写');
  const list = await (await call(env, '/api/list', { headers: { Cookie: ok.token } })).json();
  t.eq(list.dirs.map((d) => d.name), ['y'], '写入生效');

  const meAuthed = await (await call(env, '/api/me', { headers: { Cookie: ok.token } })).json();
  t.eq(meAuthed, { auth: true, loggedIn: true, readLocked: false }, '/api/me 已登录');
  const meAnon = await (await call(env, '/api/me')).json();
  t.eq(meAnon, { auth: true, loggedIn: false, readLocked: false }, '/api/me 未登录');

  const loginPageAuthed = await call(env, '/login?next=/docs', { headers: { Cookie: ok.token } });
  t.eq(loginPageAuthed.status, 302, '已登录访问登录页跳转');
  t.eq(loginPageAuthed.headers.get('Location'), '/docs', '跳到 next');
  const badNext = await call(env, '/login?next=//evil.com');
  t.eq(badNext.status, 200, '外站 next 回到登录页');
  t.ok((await badNext.text()).includes('next = "/"'), '外站 next 被清洗成根');

  const logout = await call(env, '/api/logout', { method: 'POST', headers: { Cookie: ok.token } });
  t.eq(logout.status, 200, '登出 200');
  t.ok((logout.headers.get('Set-Cookie') || '').includes('Max-Age=0'), '登出清 Cookie');
}

// --- 限速 ---
{
  const { env } = await envFor();
  const key = { 'CF-Connecting-IP': '9.9.9.9' };
  for (let i = 0; i < 5; i++) {
    const r = await postJson(env, '/api/login', { password: 'bad' + i }, key);
    t.ok(r.status === 401 || r.status === 429, `第 ${i + 1} 次失败返回 401/429`);
  }
  const blocked = await postJson(env, '/api/login', { password: PASSWORD }, key);
  t.eq(blocked.status, 429, '失败 5 次后拦截（正确密码也拦）');
  const retry = Number(blocked.headers.get('Retry-After'));
  t.ok(retry > 0 && retry <= 900, 'Retry-After 合理');
  t.ok((await blocked.json()).retryAfter > 0, '响应体带 retryAfter');

  const other = await postJson(env, '/api/login', { password: PASSWORD }, { 'CF-Connecting-IP': '8.8.8.8' });
  t.eq(other.status, 200, '其他 IP 不受影响');
}

// --- 读也要求登录 ---
{
  const { env } = await envFor({ REQUIRE_LOGIN_FOR_READ: '1' });
  const page = await call(env, '/');
  t.eq(page.status, 302, '读锁定：页面跳登录');
  t.ok((page.headers.get('Location') || '').startsWith('/login?next='), '带上 next');
  t.eq((await call(env, '/api/list')).status, 401, '读锁定：API 401');
  const me = await (await call(env, '/api/me')).json();
  t.eq(me.readLocked, true, '/api/me 报告读锁定');

  const ok = await login(env);
  const authed = await call(env, '/api/list', { headers: { Cookie: ok.token } });
  t.eq(authed.status, 200, '登录后可读');
  const authedPage = await call(env, '/', { headers: { Cookie: ok.token } });
  t.eq(authedPage.status, 200, '登录后可看页面');
}

// --- webhook 不受登录影响（自带密钥校验） ---
{
  const { env } = await envFor();
  const res = await worker.fetch(
    new Request('http://local/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 1, message: { chat: { id: -100 }, text: 'hi' } }),
    }),
    env,
  );
  t.ok(res.status === 200, 'webhook 无需会话');
}

t.done();
