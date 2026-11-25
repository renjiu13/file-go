// 上传接口：init 的权威命名、part 的流式中继与幂等、complete 的完整性检查。
import { createHash } from 'node:crypto';
import worker from '../src/index.js';
import { fakeEnv } from './helpers/fake-d1.mjs';
import * as kv from './helpers/db.mjs';
import { installTelegram } from './helpers/telegram-stub.mjs';
import { createAssert } from './helpers/assert.mjs';
import { __resetPathCache } from '../src/path-cache.js';

const t = createAssert();
const tg = installTelegram();

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function envFor(extra = {}) {
  __resetPathCache();
  const { env, db } = fakeEnv(Object.assign({ BOT_TOKEN: 'tok', CHAT_ID: '-100' }, extra));
  await kv.initSchema(env);
  return { env, db };
}

function call(env, path, opts = {}) {
  return worker.fetch(new Request('http://local' + path, opts), env);
}

function post(env, path, body) {
  return call(env, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function put(env, path, body, headers = {}) {
  return call(env, path, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, headers),
    body,
  });
}

const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7) % 251);

// ---- init 的校验与目录冲突 ----
{
  const { env } = await envFor();
  const mk = await post(env, '/api/mkdir', { name: 'Docs' });
  t.eq(mk.status, 200, 'mkdir via api');
  const docsId = (await mk.json()).id;

  t.eq((await post(env, '/api/upload/init', { parentId: docsId, name: 'a.bin', size: 0 })).status, 400, 'reject zero size');
  t.eq((await post(env, '/api/upload/init', { parentId: 'missing', name: 'a.bin', size: 1 })).status, 404, 'reject missing parent');
  const empty = await post(env, '/api/upload/init', { parentId: docsId, name: '', size: 1 });
  const emptyJob = await empty.json();
  t.eq([empty.status, emptyJob.name], [200, 'file'], 'empty name falls back to file');

  await kv.createDir(env, null, 'pic');
  const dirClash = await post(env, '/api/upload/init', { parentId: null, name: 'pic', size: 10 });
  t.eq(dirClash.status, 409, 'dir name clash');
  t.eq((await dirClash.json()).clashKind, 'dir', 'clash kind dir');
  const noReplace = await post(env, '/api/upload/init', { parentId: null, name: 'pic', size: 10, onConflict: 'replace' });
  t.eq(noReplace.status, 400, 'cannot replace a dir');
}

// ---- 单片上传全流程 ----
{
  const { env } = await envFor();
  const init = await post(env, '/api/upload/init', { parentId: null, name: 'a<b>.txt', size: 1000, mime: 'text/plain' });
  t.eq(init.status, 200, 'init ok');
  const job = await init.json();
  t.eq(job.name, 'a_b_.txt', 'init sanitizes name');
  t.eq([job.chunkSize, job.chunkCount], [1000, 1], 'small file is a single part');

  const data = bytes(1000);
  const partPath = `/api/upload/${job.id}/part/0`;

  const noSha = await put(env, partPath, data, { 'Content-Length': String(data.length) });
  t.eq(noSha.status, 400, 'part requires sha header');

  const wrongLen = await put(env, partPath, bytes(999), { 'X-Part-SHA256': sha256(bytes(999)), 'Content-Length': '999' });
  t.eq(wrongLen.status, 400, 'part size must match');

  const ok = await put(env, partPath, data, { 'X-Part-SHA256': sha256(data), 'Content-Length': String(data.length) });
  t.eq(ok.status, 200, 'part ok');
  t.eq(tg.state.calls.sendDocument, 1, 'one sendDocument');
  t.eq(tg.state.contentLengthMismatch, false, 'multipart content-length consistent');

  const dup = await put(env, partPath, data, { 'X-Part-SHA256': sha256(data), 'Content-Length': String(data.length) });
  t.eq(dup.status, 200, 'duplicate part accepted');
  t.eq((await dup.json()).existing, true, 'duplicate flagged existing');
  t.eq(tg.state.calls.sendDocument, 1, 'duplicate does not re-upload');

  const bad = await put(env, partPath, data, { 'X-Part-SHA256': 'f'.repeat(64), 'Content-Length': String(data.length) });
  t.eq(bad.status, 409, 'different sha rejected');

  const st = await call(env, `/api/upload/${job.id}`);
  const status = await st.json();
  t.eq(status.node.status, 'uploading', 'status uploading');
  t.eq(status.parts.map((p) => p.sha256), [sha256(data)], 'status lists part hash');

  const done = await post(env, `/api/upload/${job.id}/complete`, {});
  t.eq(done.status, 200, 'complete ok');
  const again = await post(env, `/api/upload/${job.id}/complete`, {});
  t.eq((await again.json()).already, true, 'complete idempotent');

  const manifest = await (await call(env, `/api/files/${job.id}/manifest`)).json();
  t.eq([manifest.size, manifest.chunkSize, manifest.chunkCount], [1000, 1000, 1], 'manifest meta');
  t.eq(manifest.parts, [{ idx: 0, size: 1000, sha256: sha256(data) }], 'manifest parts');

  const part = await call(env, `/file/${job.id}?part=0`);
  t.eq(part.status, 200, 'download part ok');
  t.eq(Buffer.from(await part.arrayBuffer()).equals(Buffer.from(data)), true, 'part bytes round trip');

  const ranged = await call(env, `/file/${job.id}`, { headers: { Range: 'bytes=100-199' } });
  t.eq(ranged.status, 206, 'range status');
  t.eq(ranged.headers.get('Content-Range'), 'bytes 100-199/1000', 'content-range');
  t.eq(Buffer.from(await ranged.arrayBuffer()).equals(Buffer.from(data.slice(100, 200))), true, 'range bytes');

  const unsat = await call(env, `/file/${job.id}`, { headers: { Range: 'bytes=1000-' } });
  t.eq(unsat.status, 416, 'unsatisfiable range');
  t.eq(unsat.headers.get('Content-Range'), 'bytes */1000', 'unsatisfiable content-range');
}

// ---- 多片组装与完整性检查 ----
{
  const { env } = await envFor();
  const { id } = await kv.insertFileNode(env, {
    parentId: null, name: 'm.bin', size: 7, mime: 'application/octet-stream',
    status: 'uploading', chunkSize: 4, chunkCount: 2, expiresAt: Date.now() + 60000,
  });
  const p0 = bytes(4);
  const p1 = bytes(3);
  const upload = (idx, buf, extra = {}) => put(env, `/api/upload/${id}/part/${idx}`, buf,
    Object.assign({ 'X-Part-SHA256': sha256(buf), 'Content-Length': String(buf.length) }, extra));

  t.eq((await post(env, `/api/upload/${id}/complete`, {})).status, 409, 'complete with missing part rejected');
  await upload(0, p0);
  t.eq((await upload(1, bytes(4))).status, 400, 'last part must be short');
  t.eq((await upload(1, p1)).status, 200, 'last part ok');
  t.eq((await post(env, `/api/upload/${id}/complete`, {})).status, 200, 'multi complete ok');

  const whole = await call(env, `/file/${id}`);
  t.eq(Buffer.from(await whole.arrayBuffer()).equals(Buffer.concat([Buffer.from(p0), Buffer.from(p1)])), true, 'parts concatenated');
  const cross = await call(env, `/file/${id}`, { headers: { Range: 'bytes=3-5' } });
  t.eq(Buffer.from(await cross.arrayBuffer()).equals(Buffer.from([p0[3], p1[0], p1[1]])), true, 'range across parts');
}

// ---- 429 退避 ----
{
  const { env } = await envFor();
  const job = await (await post(env, '/api/upload/init', { parentId: null, name: 'rate.bin', size: 100 })).json();
  const data = bytes(100);
  tg.failNext('sendDocument', 429, { retryAfter: 7 });
  const limited = await put(env, `/api/upload/${job.id}/part/0`, data, { 'X-Part-SHA256': sha256(data), 'Content-Length': '100' });
  t.eq(limited.status, 429, 'telegram 429 surfaces');
  t.eq(limited.headers.get('Retry-After'), '7', 'retry-after forwarded');
  const retry = await put(env, `/api/upload/${job.id}/part/0`, data, { 'X-Part-SHA256': sha256(data), 'Content-Length': '100' });
  t.eq(retry.status, 200, 'retry after 429 ok');
}

// ---- 过期会话 ----
{
  const { env, db } = await envFor();
  const job = await (await post(env, '/api/upload/init', { parentId: null, name: 'late.bin', size: 200 })).json();
  db.prepare('UPDATE nodes SET expires_at = ? WHERE id = ?').run(Date.now() - 1, job.id);
  const data = bytes(200);
  const res = await put(env, `/api/upload/${job.id}/part/0`, data, { 'X-Part-SHA256': sha256(data), 'Content-Length': '200' });
  t.eq(res.status, 410, 'expired upload rejected');
  t.eq(await kv.getNode(env, job.id), null, 'expired node cleaned');
}

// ---- 中止上传 ----
{
  const { env } = await envFor();
  const job = await (await post(env, '/api/upload/init', { parentId: null, name: 'stop.bin', size: 300 })).json();
  const data = bytes(300);
  await put(env, `/api/upload/${job.id}/part/0`, data, { 'X-Part-SHA256': sha256(data), 'Content-Length': '300' });
  const aborted = await (await post(env, `/api/upload/${job.id}/abort`, {})).json();
  t.eq(aborted.parts, 1, 'abort reports parts');
  t.eq((await call(env, `/api/upload/${job.id}`)).status, 404, 'aborted upload gone');
  t.eq(await kv.getParts(env, job.id), [], 'aborted parts gone');
}

// ---- 覆盖上传：完成时把旧文件送进回收站 ----
{
  const { env } = await envFor();
  const old = await kv.insertFileNode(env, {
    parentId: null, name: 'same.bin', size: 10, mime: 'application/octet-stream',
    chunkSize: 10, chunkCount: 1,
  });
  await kv.addPart(env, old.id, 0, 'oldfile', 77, 10, null);

  const clash = await post(env, '/api/upload/init', { parentId: null, name: 'same.bin', size: 20 });
  t.eq(clash.status, 409, 'upload init reports clash');
  const init = await post(env, '/api/upload/init', { parentId: null, name: 'same.bin', size: 20, onConflict: 'replace' });
  const job = await init.json();
  t.eq(job.name, 'same.bin', 'replace keeps name');
  t.eq(job.replaced, 'same.bin', 'replace reports target');

  const data = bytes(20);
  await put(env, `/api/upload/${job.id}/part/0`, data, { 'X-Part-SHA256': sha256(data), 'Content-Length': '20' });
  t.eq((await post(env, `/api/upload/${job.id}/complete`, {})).status, 200, 'replace complete');
  t.ok((await kv.getNode(env, old.id)).deletedAt > 0, 'old node trashed');
  t.eq((await kv.getNode(env, job.id)).status, 'ready', 'new node ready');

  const keep = await (await post(env, '/api/upload/init', { parentId: null, name: 'same.bin', size: 5, onConflict: 'keep-both' })).json();
  t.eq(keep.name, 'same (1).bin', 'keep-both picks suffix');
}

// ---- 没有 Content-Length 的流式请求体（HTTP/2 浏览器可能不发送） ----
{
  const { env } = await envFor();
  const job = await (await post(env, '/api/upload/init', { name: 'stream.bin', size: 8 })).json();
  const data = bytes(8);
  const stream = new ReadableStream({
    start(c) { c.enqueue(data); c.close(); },
  });
  const res = await worker.fetch(new Request(`http://local/api/upload/${job.id}/part/0`, {
    method: 'PUT',
    headers: { 'X-Part-SHA256': sha256(data), 'Content-Type': 'application/octet-stream' },
    body: stream,
    duplex: 'half',
  }), env);
  t.eq(res.status, 200, 'streamed part without content-length accepted');
  t.eq((await post(env, `/api/upload/${job.id}/complete`, {})).status, 200, 'streamed part completes');
  t.eq((await kv.getParts(env, job.id))[0].size, 8, 'streamed part size');
}

t.done();
