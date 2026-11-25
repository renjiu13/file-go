// 下载路由：Range 映射、?part、file_path 缓存与失效重试、42 子请求预算截断。
import worker from '../src/index.js';
import { fakeEnv } from './helpers/fake-d1.mjs';
import * as kv from './helpers/db.mjs';
import { installTelegram } from './helpers/telegram-stub.mjs';
import { createAssert } from './helpers/assert.mjs';
import { __resetPathCache } from '../src/path-cache.js';
import { MAX_SUBREQUESTS_PER_RESPONSE } from '../src/range.js';

const t = createAssert();
const tg = installTelegram();

async function envFor() {
  __resetPathCache();
  const { env, db } = fakeEnv({ BOT_TOKEN: 'tok', CHAT_ID: '-100' });
  await kv.initSchema(env);
  return { env, db };
}

function call(env, path, opts = {}) {
  return worker.fetch(new Request('http://local' + path, opts), env);
}

const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * seed + 17) % 251);

async function seed(env, name, chunkSize, sizes, stubbed = true) {
  const size = sizes.reduce((a, b) => a + b, 0);
  const { id } = await kv.insertFileNode(env, {
    parentId: null, name, size, mime: 'text/plain', chunkSize, chunkCount: sizes.length,
  });
  const chunks = [];
  for (let i = 0; i < sizes.length; i++) {
    const buf = bytes(sizes[i], i + 1);
    chunks.push(buf);
    const fileId = `tg_${id}_${i}`;
    await kv.addPart(env, id, i, fileId, 100 + i, sizes[i], null);
    if (stubbed) tg.addFile(fileId, buf);
  }
  return { id, chunks, size };
}

// ---- 基本响应 ----
{
  const { env } = await envFor();
  const { id, chunks } = await seed(env, 'a.txt', 4, [4, 4, 2]);

  const head = await call(env, `/file/${id}`, { method: 'HEAD' });
  t.eq(head.status, 200, 'HEAD ok');
  t.eq(head.headers.get('Content-Length'), '10', 'HEAD length');
  t.eq(head.headers.get('Accept-Ranges'), 'bytes', 'HEAD accept-ranges');

  const full = await call(env, `/file/${id}`);
  t.eq(full.status, 200, 'full status');
  const fullBytes = Buffer.from(await full.arrayBuffer());
  t.eq(fullBytes.equals(Buffer.concat(chunks.map((c) => Buffer.from(c)))), true, 'full body');
  t.ok((full.headers.get('Content-Disposition') || '').startsWith('inline'), 'text is inline by default');

  const attach = await call(env, `/file/${id}?download`);
  t.ok((attach.headers.get('Content-Disposition') || '').startsWith('attachment'), '?download forces attachment');

  const part = await call(env, `/file/${id}?part=1`);
  t.eq(part.status, 200, 'part status');
  t.eq(part.headers.get('Content-Range'), null, 'part has no content-range');
  t.eq(Buffer.from(await part.arrayBuffer()).equals(Buffer.from(chunks[1])), true, 'part bytes');

  const range = await call(env, `/file/${id}`, { headers: { Range: 'bytes=3-5' } });
  t.eq(range.status, 206, 'range status');
  t.eq(range.headers.get('Content-Range'), 'bytes 3-5/10', 'range header');
  t.eq(Buffer.from(await range.arrayBuffer()).equals(Buffer.from([chunks[0][3], chunks[1][0], chunks[1][1]])), true, 'range crosses parts');

  const suffix = await call(env, `/file/${id}`, { headers: { Range: 'bytes=-2' } });
  t.eq(Buffer.from(await suffix.arrayBuffer()).equals(Buffer.from(chunks[2])), true, 'suffix range');
  t.eq(suffix.headers.get('Content-Range'), 'bytes 8-9/10', 'suffix content-range');
}

// ---- file_path 缓存命中 ----
{
  const { env } = await envFor();
  const { id } = await seed(env, 'cache.bin', 4, [4, 4]);
  const getFileBefore = tg.state.calls.getFile || 0;

  await (await call(env, `/file/${id}`)).arrayBuffer();
  const first = (tg.state.calls.getFile || 0) - getFileBefore;
  t.eq(first, 2, 'first download resolves both paths');

  await (await call(env, `/file/${id}`, { headers: { Range: 'bytes=0-1' } })).arrayBuffer();
  t.eq((tg.state.calls.getFile || 0) - getFileBefore, 2, 'cached paths need no getFile');
}

// ---- path 失效后清缓存重试一次 ----
{
  const { env } = await envFor();
  const { id, chunks } = await seed(env, 'retry.bin', 4, [4, 4]);
  const downloadsBefore = tg.state.downloads;
  tg.failNext('download', 404);
  const res = await call(env, `/file/${id}`, { headers: { Range: 'bytes=0-3' } });
  t.eq(res.status, 206, 'retry after stale path succeeds');
  t.eq(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(chunks[0])), true, 'retry body');
  t.eq(tg.state.downloads - downloadsBefore, 2, 'one failed attempt + one retry');
}

// ---- 上游忽略 Range 时按 offset 丢弃前缀 ----
{
  const { env } = await envFor();
  const { id, chunks } = await seed(env, 'norange.bin', 4, [4, 2]);
  tg.state.ignoreRange = true;
  const res = await call(env, `/file/${id}`, { headers: { Range: 'bytes=2-3' } });
  t.eq(res.status, 206, 'ignore-range status');
  t.eq(Buffer.from(await res.arrayBuffer()).equals(Buffer.from([chunks[0][2], chunks[0][3]])), true, 'offset skip when upstream returns 200');
  tg.state.ignoreRange = false;
}

// ---- 50 子请求预算：截断成 206，浏览器再接着要 ----
{
  const { env } = await envFor();
  const sizes = Array.from({ length: 50 }, () => 1);
  const { id, chunks } = await seed(env, 'big.bin', 1, sizes);

  const before = tg.state.downloads;
  const first = await call(env, `/file/${id}`, { headers: { Range: 'bytes=0-49' } });
  t.eq(first.status, 206, 'truncated is 206');
  t.eq(first.headers.get('Content-Range'), 'bytes 0-20/50', 'first slice stops at budget');
  t.eq(first.headers.get('Content-Length'), '21', 'first slice length');
  t.eq(Buffer.from(await first.arrayBuffer()).equals(Buffer.concat(chunks.slice(0, 21).map((c) => Buffer.from(c)))), true, 'first slice bytes');
  t.ok(tg.state.downloads - before <= MAX_SUBREQUESTS_PER_RESPONSE, 'within subrequest budget');

  const second = await call(env, `/file/${id}`, { headers: { Range: 'bytes=21-49' } });
  t.eq(second.headers.get('Content-Range'), 'bytes 21-41/50', 'second slice continues to budget');
  t.eq(Buffer.from(await second.arrayBuffer()).equals(Buffer.concat(chunks.slice(21, 42).map((c) => Buffer.from(c)))), true, 'second slice bytes');

  const third = await call(env, `/file/${id}`, { headers: { Range: 'bytes=42-49' } });
  t.eq(third.headers.get('Content-Range'), 'bytes 42-49/50', 'third slice completes');
  const rest = Buffer.from(await third.arrayBuffer());
  t.eq(rest.length, 8, 'third slice length');
  t.eq(rest.equals(Buffer.concat(chunks.slice(42).map((c) => Buffer.from(c)))), true, 'third slice bytes');

  // 不带 Range 的直链：同样被截断（设计里明确接受的行为）
  __resetPathCache();
  const direct = await call(env, `/file/${id}`);
  t.eq(direct.status, 206, 'direct link also truncates');
  t.eq(direct.headers.get('Content-Range'), 'bytes 0-20/50', 'direct link range');
}

// ---- 分片缺失时提前截断 ----
{
  const { env } = await envFor();
  const { id } = await seed(env, 'gap.bin', 4, [4, 4]);
  await env.DB.prepare('DELETE FROM file_parts WHERE node_id = ? AND idx = 1').bind(id).run();
  const gap = await call(env, `/file/${id}`);
  t.eq(gap.status, 206, 'gap truncates');
  t.eq(gap.headers.get('Content-Range'), 'bytes 0-3/8', 'gap stops at missing part');
}

t.done();
