// 临时端到端夹具：node:sqlite 顶住 D1、假 Telegram 顶住 Bot API，把 Worker 跑在本地 http 上
import http from 'node:http';
import * as kv from '../test/helpers/db.mjs';
import worker from '../src/index.js';
import { fakeEnv } from '../test/helpers/fake-d1.mjs';

const env = fakeEnv({ BOT_TOKEN: 'faketoken', CHAT_ID: '-1001234567890' }).env;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.telegram.org/botfaketoken/sendDocument')) {
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1, document: { file_id: 'fid_x' } } }),
      { headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, init);
};

await kv.initSchema(env);
for (const d of ['docs', 'photos', 'old-stuff', 'docs/sub']) await kv.ensureDir(env, d);

const F = (id, name, path, size) =>
  kv.saveFile(env, { id, fileId: 'f_' + id, messageId: 1, name, size, mime: 'text/plain', path, createdAt: Date.now() + size });

await F('idroot000001', 'alpha.txt', '', 100);
await F('idroot000002', 'Beta.png', '', 5000);
await F('idroot000003', 'zeta.md', '', 25);
await F('idroot000004', 'delta.log', '', 300);
await F('idroot000005', 'config.json', '', 60);
await F('idsub0000001', 'deep.txt', 'docs/sub', 10);
await F('idold00000001', 'tmp.log', '', 900);
await F('idgone000001', 'inside.txt', 'old-stuff', 70);
await kv.softDeleteFile(env, 'idold00000001', '20261120');
await kv.softDeleteDir(env, 'old-stuff', '20261118');

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request('http://127.0.0.1:8791' + req.url, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  try {
    const response = await worker.fetch(request, env, {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500); res.end(String(err && err.stack));
  }
});

server.listen(8791, '127.0.0.1', () => console.log('dev harness on http://127.0.0.1:8791'));
