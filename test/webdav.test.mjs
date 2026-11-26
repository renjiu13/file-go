// WebDAV：Basic 认证、PROPFIND、PUT/GET、MKCOL、MOVE/COPY、DELETE、LOCK。
import worker from '../src/index.js';
import { fakeEnv } from './helpers/fake-d1.mjs';
import * as kv from './helpers/db.mjs';
import { installTelegram } from './helpers/telegram-stub.mjs';
import { createAssert } from './helpers/assert.mjs';
import { __resetPathCache } from '../src/path-cache.js';
import { DAV_MAX_PUT } from '../src/webdav.js';

const t = createAssert();
const tg = installTelegram();

async function envFor(extra) {
  __resetPathCache();
  const { env, db } = fakeEnv({ BOT_TOKEN: 'tok', CHAT_ID: '-100', ...(extra || {}) });
  await kv.initSchema(env);
  return { env, db };
}

const AUTH = 'Basic ' + Buffer.from('filego:filego').toString('base64');

function dav(env, path, opts = {}) {
  const headers = { ...(opts.auth === null ? {} : { Authorization: AUTH }), ...(opts.headers || {}) };
  return worker.fetch(new Request('http://local' + path, { ...opts, headers }), env);
}

const putBody = (bytes) => Uint8Array.from(bytes);

// ---- 认证 ----
{
  const { env } = await envFor();

  const anon = await dav(env, '/dav/', { method: 'PROPFIND', auth: null });
  t.eq(anon.status, 401, 'no auth 401');
  t.ok(String(anon.headers.get('WWW-Authenticate') || '').startsWith('Basic'), 'challenge is Basic');

  const wrong = await dav(env, '/dav/', {
    method: 'PROPFIND',
    auth: null,
    headers: { Authorization: 'Basic ' + Buffer.from('filego:nope').toString('base64') },
  });
  t.eq(wrong.status, 401, 'wrong password 401');

  const wrongUser = await dav(env, '/dav/', {
    method: 'PROPFIND',
    auth: null,
    headers: { Authorization: 'Basic ' + Buffer.from('admin:filego').toString('base64') },
  });
  t.eq(wrongUser.status, 401, 'wrong user 401');

  const broken = await dav(env, '/dav/', { method: 'PROPFIND', auth: null, headers: { Authorization: 'Basic !!!' } });
  t.eq(broken.status, 401, 'malformed basic 401');

  const opt = await dav(env, '/dav/', { method: 'OPTIONS' });
  t.eq(opt.status, 200, 'OPTIONS 200');
  t.eq(opt.headers.get('DAV'), '1, 2', 'DAV header');
  t.ok(String(opt.headers.get('Allow')).includes('PROPFIND'), 'Allow lists PROPFIND');
  t.ok(String(opt.headers.get('Allow')).includes('PUT'), 'Allow lists PUT');

  // 环境变量覆盖
  const custom = await envFor({ WEBDAV_USER: 'alice', WEBDAV_PASS: 's3cret' });
  t.eq((await dav(custom.env, '/dav/', { method: 'PROPFIND', auth: null })).status, 401, 'default creds rejected when overridden');
  const okCustom = await dav(custom.env, '/dav/', {
    method: 'PROPFIND',
    auth: null,
    headers: { Authorization: 'Basic ' + Buffer.from('alice:s3cret').toString('base64') },
  });
  t.eq(okCustom.status, 207, 'custom creds accepted');

  // /dav 之外不受影响
  t.eq((await worker.fetch(new Request('http://local/api/list?path='), env)).status, 200, 'other routes unaffected');
}

// ---- MKCOL + PROPFIND ----
{
  const { env } = await envFor();

  const mk = await dav(env, '/dav/docs', { method: 'MKCOL' });
  t.eq(mk.status, 201, 'MKCOL 201');
  t.eq((await dav(env, '/dav/docs', { method: 'MKCOL' })).status, 405, 'MKCOL existing 405');
  t.eq((await dav(env, '/dav/nope/deep', { method: 'MKCOL' })).status, 409, 'MKCOL missing parent 409');
  t.eq((await dav(env, '/dav/bad:name', { method: 'MKCOL' })).status, 400, 'MKCOL illegal name 400');

  const root0 = await dav(env, '/dav/', { method: 'PROPFIND', headers: { Depth: '0' } });
  t.eq(root0.status, 207, 'PROPFIND root 207');
  const rootXml = await root0.text();
  t.ok(rootXml.includes('<D:multistatus'), 'root multistatus');
  t.ok(rootXml.includes('<D:collection/>'), 'root is collection');
  t.eq(rootXml.includes('docs'), false, 'Depth 0 has no children');

  const root1 = await dav(env, '/dav/', { method: 'PROPFIND', headers: { Depth: '1' } });
  const oneXml = await root1.text();
  t.ok(oneXml.includes('/dav/docs/'), 'Depth 1 lists child dir');

  const dir0 = await dav(env, '/dav/docs', { method: 'PROPFIND', headers: { Depth: '0' } });
  t.eq(dir0.status, 207, 'PROPFIND dir 207');
  t.ok((await dir0.text()).includes('<D:displayname>docs</D:displayname>'), 'dir displayname');

  t.eq((await dav(env, '/dav/missing', { method: 'PROPFIND' })).status, 404, 'PROPFIND missing 404');
}

// ---- PUT / GET / 覆盖 ----
{
  const { env } = await envFor();
  await dav(env, '/dav/docs', { method: 'MKCOL' });
  const payload = putBody([1, 2, 3, 4, 5, 6, 7, 8]);

  const put = await dav(env, '/dav/docs/a.txt', { method: 'PUT', body: payload });
  t.eq(put.status, 201, 'PUT 201');
  t.eq(tg.state.calls.sendDocument || 0, 1, 'PUT went through Telegram once');

  const get = await dav(env, '/dav/docs/a.txt');
  t.eq(get.status, 200, 'GET 200');
  t.eq(Buffer.from(await get.arrayBuffer()).equals(Buffer.from(payload)), true, 'GET body roundtrip');
  t.eq(get.headers.get('Content-Length'), '8', 'GET length');

  const head = await dav(env, '/dav/docs/a.txt', { method: 'HEAD' });
  t.eq(head.headers.get('Content-Length'), '8', 'HEAD length');

  const prop = await dav(env, '/dav/docs/a.txt', { method: 'PROPFIND', headers: { Depth: '0' } });
  const propXml = await prop.text();
  t.ok(propXml.includes('<D:getcontentlength>8</D:getcontentlength>'), 'prop content length');
  t.ok(propXml.includes('<D:getcontenttype>text/plain'), 'prop content type');
  t.ok(propXml.includes('/dav/docs/a.txt'), 'prop href');

  const list = await (await worker.fetch(new Request('http://local/api/list?path=docs'), env)).json();
  t.eq(list.files.length, 1, 'web list sees dav file');
  t.eq(list.files[0].name, 'a.txt', 'dav file name');

  // 覆盖：204，旧节点进回收站，列表仍只有一个
  const put2 = await dav(env, '/dav/docs/a.txt', { method: 'PUT', body: putBody([9, 9, 9]) });
  t.eq(put2.status, 204, 'PUT overwrite 204');
  const get2 = await dav(env, '/dav/docs/a.txt');
  t.eq(Buffer.from(await get2.arrayBuffer()).equals(Buffer.from([9, 9, 9])), true, 'overwritten body');
  const list2 = await (await worker.fetch(new Request('http://local/api/list?path=docs'), env)).json();
  t.eq(list2.files.length, 1, 'still single live file');
  const trash = await (await worker.fetch(new Request('http://local/api/trash'), env)).json();
  t.eq(trash.groups.length, 1, 'old version went to trash');

  t.eq((await dav(env, '/dav/docs', { method: 'GET' })).status, 405, 'GET dir 405');
  t.eq((await dav(env, '/dav/docs/missing.txt')).status, 404, 'GET missing 404');
  t.eq((await dav(env, '/dav/docs/a.txt', { method: 'PUT' })).status, 400, 'PUT without body 400');

  // 上限：声明长度超过 16 MiB 直接 413，不读请求体
  const big = await dav(env, '/dav/docs/big.bin', {
    method: 'PUT',
    headers: { 'Content-Length': String(DAV_MAX_PUT + 1) },
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1)); c.close(); } }),
    duplex: 'half',
  });
  t.eq(big.status, 413, 'oversize PUT 413');
  t.ok(String(await big.text()).includes('网页端'), '413 tells user to use web');

  // 空文件拒绝
  const empty = await dav(env, '/dav/docs/empty.txt', { method: 'PUT', body: new Uint8Array(0) });
  t.eq(empty.status, 400, 'empty PUT 400');
}

// ---- MOVE / COPY ----
{
  const { env } = await envFor();
  await dav(env, '/dav/a', { method: 'MKCOL' });
  await dav(env, '/dav/b', { method: 'MKCOL' });
  await dav(env, '/dav/a/one.txt', { method: 'PUT', body: putBody([1, 1, 1, 1]) });

  const rename = await dav(env, '/dav/a/one.txt', {
    method: 'MOVE', headers: { Destination: 'http://local/dav/a/two.txt' },
  });
  t.eq(rename.status, 204, 'MOVE rename 204');
  t.eq((await dav(env, '/dav/a/one.txt')).status, 404, 'old name gone');
  t.eq((await dav(env, '/dav/a/two.txt')).status, 200, 'new name works');

  const cross = await dav(env, '/dav/a/two.txt', {
    method: 'MOVE', headers: { Destination: 'http://local/dav/b/two.txt' },
  });
  t.eq(cross.status, 204, 'MOVE across dirs 204');
  t.eq((await dav(env, '/dav/b/two.txt')).status, 200, 'moved into b');
  t.eq((await dav(env, '/dav/a/two.txt')).status, 404, 'gone from a');

  const copy = await dav(env, '/dav/b/two.txt', {
    method: 'COPY', headers: { Destination: 'http://local/dav/a/copy.txt' },
  });
  t.eq(copy.status, 201, 'COPY 201');
  const srcBytes = Buffer.from(await (await dav(env, '/dav/b/two.txt')).arrayBuffer());
  const copyBytes = Buffer.from(await (await dav(env, '/dav/a/copy.txt')).arrayBuffer());
  t.eq(copyBytes.equals(srcBytes), true, 'copy body matches');

  const parts = await kv.getParts(env, (await kv.getChild(env, (await kv.resolvePath(env, 'a')).id, 'copy.txt')).id);
  const srcNode = await kv.getChild(env, (await kv.resolvePath(env, 'b')).id, 'two.txt');
  const srcParts = await kv.getParts(env, srcNode.id);
  t.eq(parts[0].fileId, srcParts[0].fileId, 'copy shares tg file id');
  t.eq(parts[0].messageId, null, 'copy drops message id');

  const noOverwrite = await dav(env, '/dav/a/copy.txt', {
    method: 'COPY',
    headers: { Destination: 'http://local/dav/b/two.txt', Overwrite: 'F' },
  });
  t.eq(noOverwrite.status, 412, 'COPY Overwrite:F 412');

  const overwriteOk = await dav(env, '/dav/a/copy.txt', {
    method: 'COPY', headers: { Destination: 'http://local/dav/b/two.txt' },
  });
  t.eq(overwriteOk.status, 204, 'COPY overwrite 204');

  t.eq((await dav(env, '/dav/a/copy.txt', { method: 'MOVE' })).status, 400, 'MOVE without Destination 400');
  t.eq((await dav(env, '/dav/a/copy.txt', {
    method: 'MOVE', headers: { Destination: 'http://local/other/x' },
  })).status, 502, 'MOVE outside /dav 502');
  t.eq((await dav(env, '/dav/a/copy.txt', {
    method: 'MOVE', headers: { Destination: 'http://local/dav/zzz/x.txt' },
  })).status, 409, 'MOVE to missing parent 409');

  // 目录整体 COPY 递归带分片
  const dirCopy = await dav(env, '/dav/a', {
    method: 'COPY', headers: { Destination: 'http://local/dav/a-copy' },
  });
  t.eq(dirCopy.status, 201, 'dir COPY 201');
  const copiedA = await kv.getChild(env, null, 'a-copy');
  const copiedParts = await kv.getParts(env, (await kv.getChild(env, copiedA.id, 'copy.txt')).id);
  t.eq(copiedParts.length, 1, 'dir copy carried parts');
  t.eq(copiedParts[0].messageId, null, 'dir copy drops message id');
}

// ---- DELETE / LOCK / PROPPATCH ----
{
  const { env } = await envFor();
  await dav(env, '/dav/x.txt', { method: 'PUT', body: putBody([7, 7]) });

  const del = await dav(env, '/dav/x.txt', { method: 'DELETE' });
  t.eq(del.status, 204, 'DELETE 204');
  t.eq((await dav(env, '/dav/x.txt')).status, 404, 'deleted is gone');
  t.eq((await dav(env, '/dav/', { method: 'DELETE' })).status, 405, 'DELETE root 405');
  t.eq((await dav(env, '/dav/ghost.txt', { method: 'DELETE' })).status, 404, 'DELETE missing 404');

  const lock = await dav(env, '/dav/lock.txt', { method: 'LOCK', body: '<D:lockinfo xmlns:D="DAV:"/>' });
  t.eq(lock.status, 200, 'LOCK 200');
  t.ok(String(lock.headers.get('Lock-Token') || '').startsWith('<opaquelocktoken:'), 'lock token header');
  t.ok((await lock.text()).includes('<D:activelock>'), 'lock xml');
  t.eq((await dav(env, '/dav/lock.txt', { method: 'UNLOCK' })).status, 204, 'UNLOCK 204');

  const pp = await dav(env, '/dav/x.txt', {
    method: 'PROPPATCH',
    body: '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><Z:Win32LastModifiedTime xmlns:Z="urn:schemas-microsoft-com:">x</Z:Win32LastModifiedTime></D:prop></D:set></D:propertyupdate>',
  });
  t.eq(pp.status, 207, 'PROPPATCH 207');
  t.ok((await pp.text()).includes('Win32LastModifiedTime'), 'PROPPATCH echoes prop');

  t.eq((await dav(env, '/dav/x.txt', { method: 'PATCH' })).status, 405, 'PATCH 405');
}

// ---- 与网页登录互不干扰 ----
{
  const { hashPassword } = await import('../src/auth.js');
  const { env } = await envFor({
    PASSWORD_HASH: await hashPassword('pw', 1000),
    SESSION_SECRET: 'sec',
  });
  // 网页登录启用后，WebDAV 仍用自己的 Basic 口令，不需要 Cookie
  const r = await dav(env, '/dav/sec.txt', { method: 'PUT', body: putBody([1, 2]) });
  t.eq(r.status, 201, 'dav works while web login enabled');
  const read = await worker.fetch(new Request('http://local/file/' + (await kv.getChild(env, null, 'sec.txt')).id), env);
  t.eq(read.status, 200, 'web download of dav file is public');
}

t.done();
