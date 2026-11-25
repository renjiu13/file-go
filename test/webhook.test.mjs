// Bot 入口：已有 file_id 直接入库，校验命名/目录/上限/幂等/防盗链。
import worker from '../src/index.js';
import { fakeEnv } from './helpers/fake-d1.mjs';
import * as kv from './helpers/db.mjs';
import { installTelegram } from './helpers/telegram-stub.mjs';
import { createAssert } from './helpers/assert.mjs';

const t = createAssert();
const tg = installTelegram();

async function envFor(extra = {}) {
  const { env, db } = fakeEnv({ BOT_TOKEN: 'tok', CHAT_ID: '-100', ...extra });
  await kv.initSchema(env);
  return { env, db };
}

let updateId = 100;
function post(env, update, headers = {}) {
  return worker.fetch(new Request('http://local/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(update),
  }), env);
}

function docMsg(fields = {}) {
  return {
    update_id: updateId++,
    message: {
      message_id: 7,
      caption: fields.caption || '',
      document: {
        file_id: fields.fileId || 'file_doc_1',
        file_name: fields.name || 'doc.pdf',
        mime_type: fields.mime || 'application/pdf',
        file_size: fields.size ?? 1234,
      },
    },
  };
}

// ---- 文档直接入库 ----
{
  const { env } = await envFor();
  const res = await post(env, docMsg({ caption: 'docs/2026', name: '报表.pdf', size: 1234 }));
  const body = await res.json();
  t.eq(res.status, 200, 'webhook 200');
  t.eq(body.ok, true, 'webhook ok');
  t.eq(body.name, '报表.pdf', 'keeps name');
  t.eq(body.path, 'docs/2026', 'caption path');
  const node = await kv.getNode(env, body.id);
  t.eq(node.kind, 'file', 'node is file');
  t.eq(node.status, 'ready', 'node ready');
  t.eq(node.size, 1234, 'node size');
  t.eq(node.chunkCount, 1, 'single chunk');
  t.eq(node.chunkSize, 1234, 'chunk size = size');
  t.eq(node.mime, 'application/pdf', 'mime');
  const dirs = await kv.resolvePath(env, 'docs/2026');
  t.ok(dirs && dirs.crumbs.length === 2, 'nested dirs created');
  t.eq(node.parentId, dirs.id, 'node parent is caption dir');
  const parts = await kv.getParts(env, body.id);
  t.eq(parts.length, 1, 'one part');
  t.eq(parts[0].fileId, 'file_doc_1', 'part file id');
  t.eq(parts[0].messageId, null, 'part message id null (bot file)');
  t.eq(parts[0].sha256, null, 'part sha null');
  const reply = tg.state.messages[tg.state.messages.length - 1];
  t.ok(reply.includes('已入库') && reply.includes(body.id), 'reply has link');
  t.ok(reply.includes('docs/2026'), 'reply has location');
}

// ---- update_id 幂等 ----
{
  const { env } = await envFor();
  const update = docMsg({ fileId: 'file_once' });
  const first = await (await post(env, update)).json();
  const again = await (await post(env, update)).json();
  t.eq(again.duplicate, true, 'duplicate update ignored');
  const rows = (await env.DB.prepare("SELECT id FROM nodes WHERE kind='file'").all()).results;
  t.eq(rows.length, 1, 'single node after duplicate');
  t.ok(first.id, 'first id');
}

// ---- photo / video 兜底命名 ----
{
  const { env } = await envFor();
  const p = await (await post(env, {
    update_id: updateId++,
    message: { photo: [{ file_id: 'small' }, { file_id: 'big', file_unique_id: 'uf1', file_size: 300 }] },
  })).json();
  t.eq(p.name, 'photo-uf1.jpg', 'photo fallback name');
  const pn = await kv.getNode(env, p.id);
  t.eq(pn.mime, 'image/jpeg', 'photo mime');
  t.eq(pn.size, 300, 'photo largest size');

  const v = await (await post(env, {
    update_id: updateId++,
    message: { video: { file_id: 'vid', file_unique_id: 'uv1', file_size: 900, mime_type: 'video/mp4' } },
  })).json();
  t.eq(v.name, 'video-uv1.mp4', 'video fallback name');
}

// ---- 无媒体 / 超大 / 重名 ----
{
  const { env } = await envFor();
  const none = await (await post(env, { update_id: updateId++, message: { text: 'hi' } })).json();
  t.eq(none.ignored, 'no media', 'text ignored');

  const big = await (await post(env, docMsg({ fileId: 'bigfile', name: 'big.bin', size: 21 * 1024 * 1024 }))).json();
  t.eq(big.rejected, 'too large', 'oversize rejected');
  const msg = tg.state.messages[tg.state.messages.length - 1];
  t.ok(msg.includes('20MB') && msg.includes('网页端'), 'oversize guidance');
  const count = (await env.DB.prepare("SELECT id FROM nodes WHERE name = 'big.bin'").all()).results;
  t.eq(count.length, 0, 'oversize not stored');

  const a = await (await post(env, docMsg({ fileId: 'dup1', name: 'same.txt', size: 10 }))).json();
  const b = await (await post(env, docMsg({ fileId: 'dup2', name: 'same.txt', size: 20 }))).json();
  t.eq(a.name, 'same.txt', 'first keeps name');
  t.eq(b.name, 'same (1).txt', 'clash keeps both');
}

// ---- WEBHOOK_SECRET 校验 ----
{
  const { env } = await envFor({ WEBHOOK_SECRET: 's3cret' });
  const denied = await post(env, docMsg({ fileId: 'sec1' }));
  t.eq(denied.status, 403, 'missing secret 403');
  const wrong = await post(env, docMsg({ fileId: 'sec2' }), { 'X-Telegram-Bot-Api-Secret-Token': 'nope' });
  t.eq(wrong.status, 403, 'wrong secret 403');
  const ok = await post(env, docMsg({ fileId: 'sec3' }), { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' });
  t.eq(ok.status, 200, 'correct secret 200');
}

t.done();
