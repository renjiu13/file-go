// 本地端到端夹具：node:sqlite 当 D1，假 Telegram 当 Bot API，Worker 跑在 127.0.0.1:8791。
// 假 Telegram 支持分片下载与 Range，可直接演示断点、截断和视频拖动。
import http from 'node:http';
import * as kv from '../test/helpers/db.mjs';
import worker from '../src/index.js';
import { fakeEnv } from '../test/helpers/fake-d1.mjs';
import { installTelegram } from '../test/helpers/telegram-stub.mjs';
import { hashPassword } from '../src/auth.js';

const tg = installTelegram();
// 带 DEV_PASSWORD 启动即启用登录，用来在浏览器里对比访客与登录用户的界面差异
const AUTH = process.env.DEV_PASSWORD
  ? { PASSWORD_HASH: await hashPassword(process.env.DEV_PASSWORD), SESSION_SECRET: 'dev-harness-secret' }
  : {};
const env = fakeEnv({ BOT_TOKEN: 'faketoken', CHAT_ID: '-1001234567890', ...AUTH }).env;
await kv.initSchema(env);

const text = (s) => new TextEncoder().encode(s);

async function seed(parentId, name, chunks, chunkSize) {
  const size = chunks.reduce((a, b) => a + b.length, 0);
  const { id } = await kv.insertFileNode(env, {
    parentId, name, size, mime: name.endsWith('.png') ? 'image/png' : 'text/plain',
    chunkSize: chunkSize || size, chunkCount: chunks.length,
  });
  for (let i = 0; i < chunks.length; i++) {
    const fileId = `f_${id}_${i}`;
    tg.addFile(fileId, chunks[i]);
    await kv.addPart(env, id, i, fileId, 5000 + i, chunks[i].length, null);
  }
  return id;
}

const docs = await kv.ensureDirPath(env, 'docs');
const sub = await kv.ensureDirPath(env, 'docs/sub');
await kv.ensureDirPath(env, 'photos');
const old = await kv.ensureDirPath(env, 'old-stuff');

await seed(null, 'alpha.txt', [text('hello from alpha\n')]);
await seed(null, 'Beta.png', [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])]);
await seed(docs, 'deep.txt', [text('docs/sub 里的文件\n')]);
await seed(sub, 'nested.txt', [text('nested!\n')]);
// 多分片：16 字节、每片 4 字节，用来演示 Range 跨片
await seed(null, 'multi.txt', [
  text('AAAA'), text('BBBB'), text('CCCC'), text('DDDD'),
], 4);
const gone = await seed(old, 'inside.txt', [text('inside old-stuff\n')]);
await kv.softDelete(env, gone);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request('http://127.0.0.1:8791' + req.url, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  try {
    const response = await worker.fetch(request, env, { waitUntil() {} });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end(String(err && err.stack));
  }
});

server.listen(8791, '127.0.0.1', () =>
  console.log(
    'dev harness on http://127.0.0.1:8791' +
      (process.env.DEV_PASSWORD ? '（已启用登录，口令取 DEV_PASSWORD）' : '（公开模式）'),
  ),
);
