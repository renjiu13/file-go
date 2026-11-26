// 公开分享：创建/取消/查询令牌，/i/<token> 公开下载，删除失效、恢复复活。
import worker from '../src/index.js';
import { fakeEnv } from './helpers/fake-d1.mjs';
import * as kv from './helpers/db.mjs';
import { installTelegram } from './helpers/telegram-stub.mjs';
import { createAssert } from './helpers/assert.mjs';
import { __resetPathCache } from '../src/path-cache.js';
import { hashPassword } from '../src/auth.js';

const t = createAssert();
const tg = installTelegram();

async function envFor(extra) {
  __resetPathCache();
  const { env, db } = fakeEnv({ BOT_TOKEN: 'tok', CHAT_ID: '-100', ...(extra || {}) });
  await kv.initSchema(env);
  return { env, db };
}

function call(env, path, opts = {}) {
  return worker.fetch(new Request('http://local' + path, opts), env);
}

function post(env, path, body, headers) {
  return call(env, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  });
}

const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * seed + 3) % 251);

async function seed(env, name, sizes, chunkSize) {
  const size = sizes.reduce((a, b) => a + b, 0);
  const cs = chunkSize || sizes[0];
  const { id } = await kv.insertFileNode(env, {
    parentId: null, name, size, mime: 'application/octet-stream', chunkSize: cs, chunkCount: sizes.length,
  });
  const chunks = [];
  for (let i = 0; i < sizes.length; i++) {
    const buf = bytes(sizes[i], i + 1);
    chunks.push(buf);
    const fileId = `tg_${id}_${i}`;
    await kv.addPart(env, id, i, fileId, 200 + i, sizes[i], null);
    tg.addFile(fileId, buf);
  }
  return { id, chunks, size };
}

const concat = (chunks) => Buffer.concat(chunks.map((c) => Buffer.from(c)));

// ---- 创建 / 幂等 / 列表可见 ----
{
  const { env } = await envFor();
  const { id } = await seed(env, 'share.bin', [4, 4, 2]);

  const created = await post(env, '/api/share', { id });
  t.eq(created.status, 200, 'create 200');
  const body = await created.json();
  t.eq(body.ok, true, 'create ok');
  t.eq(String(body.shareToken).length, 16, 'token length 16');
  t.eq(body.url, '/i/' + body.shareToken, 'url shape');
  t.eq(/^[A-Za-z0-9]+$/.test(body.shareToken), true, 'token is base62');

  const again = await (await post(env, '/api/share', { id })).json();
  t.eq(again.shareToken, body.shareToken, 'create is idempotent');

  const status = await (await call(env, '/api/share?id=' + encodeURIComponent(id))).json();
  t.eq(status.shareToken, body.shareToken, 'status reflects token');
  t.eq(status.name, 'share.bin', 'status carries name');

  const list = await (await call(env, '/api/list?path=')).json();
  const listed = list.files.find((f) => f.id === id);
  t.eq(listed.shareToken, body.shareToken, 'list exposes shareToken');

  // 别的文件没有 token
  const other = await seed(env, 'plain.bin', [2]);
  const list2 = await (await call(env, '/api/list?path=')).json();
  t.eq(list2.files.find((f) => f.id === other.id).shareToken, null, 'unshared file has null token');

  // 参数校验
  t.eq((await post(env, '/api/share', {})).status, 400, 'missing id 400');
  t.eq((await post(env, '/api/share', { id: 'nope' })).status, 404, 'unknown id 404');
  const dir = await kv.createDir(env, null, 'folder');
  t.eq((await post(env, '/api/share', { id: dir.id })).status, 404, 'dir cannot be shared');
  const bad = await call(env, '/api/share', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops',
  });
  t.eq(bad.status, 400, 'invalid json 400');

  // 未完成的节点不能分享
  const uploading = await kv.insertFileNode(env, {
    parentId: null, name: 'half.bin', size: 10, mime: 'application/octet-stream',
    chunkSize: 10, chunkCount: 1, status: 'uploading',
  });
  t.eq((await post(env, '/api/share', { id: uploading.id })).status, 409, 'uploading node 409');
}

// ---- 公开下载：整文件 / HEAD / Range / 缓存头 ----
{
  const { env } = await envFor();
  const { id, chunks } = await seed(env, 'pic.png', [4, 4, 2]);
  const token = (await (await post(env, '/api/share', { id })).json()).shareToken;

  const full = await call(env, '/i/' + token);
  t.eq(full.status, 200, 'share GET 200');
  t.eq(Buffer.from(await full.arrayBuffer()).equals(concat(chunks)), true, 'share body matches');
  t.eq(full.headers.get('Accept-Ranges'), 'bytes', 'share accept-ranges');
  t.eq(full.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', 'share is immutable');
  t.eq(full.headers.get('X-Content-Type-Options'), 'nosniff', 'share nosniff');

  const head = await call(env, '/i/' + token, { method: 'HEAD' });
  t.eq(head.status, 200, 'share HEAD 200');
  t.eq(head.headers.get('Content-Length'), '10', 'share HEAD length');

  const ranged = await call(env, '/i/' + token, { headers: { Range: 'bytes=3-5' } });
  t.eq(ranged.status, 206, 'share range 206');
  t.eq(ranged.headers.get('Content-Range'), 'bytes 3-5/10', 'share range content-range');
  t.eq(Buffer.from(await ranged.arrayBuffer()).equals(concat(chunks).subarray(3, 6)), true, 'share range body');

  const part = await call(env, '/i/' + token + '?part=1');
  t.eq(Buffer.from(await part.arrayBuffer()).equals(Buffer.from(chunks[1])), true, 'share ?part works');

  t.eq((await call(env, '/i/doesnotexist1234')).status, 404, 'unknown token 404');
  const gone = await call(env, '/i/' + token, { method: 'DELETE' });
  t.eq(gone.status, 404, 'share only serves GET/HEAD');
}

// ---- 删除失效、恢复复活、取消分享 ----
{
  const { env } = await envFor();
  const { id } = await seed(env, 'revive.bin', [5]);
  const token = (await (await post(env, '/api/share', { id })).json()).shareToken;
  t.eq((await call(env, '/i/' + token)).status, 200, 'alive before delete');

  await kv.softDelete(env, id);
  t.eq((await call(env, '/i/' + token)).status, 404, '404 while in trash');
  t.eq((await (await call(env, '/api/share?id=' + id)).json()).error !== undefined, true, 'status 404-ish for trashed');

  await kv.restoreNode(env, id);
  const revived = await call(env, '/i/' + token);
  t.eq(revived.status, 200, 'link revives after restore');
  t.eq(revived.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', 'still immutable');

  const off = await call(env, '/api/share', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
  });
  t.eq(off.status, 200, 'delete share 200');
  const offBody = await off.json();
  t.eq(offBody.shareToken, null, 'token cleared');
  t.eq((await call(env, '/i/' + token)).status, 404, 'link dead after unshare');

  const afterStatus = await (await call(env, '/api/share?id=' + id)).json();
  t.eq(afterStatus.shareToken, null, 'status null after unshare');
  t.eq((await call(env, '/api/share', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400, 'delete without id 400');

  // 再次分享生成新 token
  const next = await (await post(env, '/api/share', { id })).json();
  t.ok(next.shareToken && next.shareToken !== token, 'new token after re-share');
}

// ---- 启用登录后：分享是写操作，需会话 + CSRF；公开链接仍免登录 ----
{
  const passwordHash = await hashPassword('hunter2', 1000);
  const { env } = await envFor({ PASSWORD_HASH: passwordHash, SESSION_SECRET: 'secret-xyz' });
  const { id } = await seed(env, 'guarded.bin', [3]);

  t.eq((await post(env, '/api/share', { id })).status, 401, 'share create needs login');
  t.eq((await (await call(env, '/api/list?path=')).json()).files.length, 1, 'reads stay public');

  const login = await post(env, '/api/login', { password: 'hunter2' }, { Origin: 'http://local' });
  t.eq(login.status, 200, 'login ok');
  const cookie = String(login.headers.get('Set-Cookie')).split(';')[0];

  const noCsrf = await call(env, '/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ id }),
  });
  t.eq(noCsrf.status, 403, 'share create needs csrf');

  const okRes = await call(env, '/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-File-Go-Csrf': '1' },
    body: JSON.stringify({ id }),
  });
  t.eq(okRes.status, 200, 'share create with session+csrf');
  const token = (await okRes.json()).shareToken;

  t.eq((await call(env, '/i/' + token)).status, 200, 'public link works without session');
  const anonHead = await call(env, '/i/' + token, { method: 'HEAD' });
  t.eq(anonHead.status, 200, 'public HEAD works without session');
}

t.done();
