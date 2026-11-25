// Cron 清理：待删消息队列（每次 ≤40）+ 过期上传会话（每次 ≤20）。
import { fakeEnv } from './helpers/fake-d1.mjs';
import * as kv from './helpers/db.mjs';
import { runCleanup } from '../src/cron.js';
import { installTelegram } from './helpers/telegram-stub.mjs';
import { createAssert } from './helpers/assert.mjs';

const t = createAssert();
const tg = installTelegram();

async function envFor() {
  const { env } = fakeEnv({ BOT_TOKEN: 'tok', CHAT_ID: '-100' });
  await kv.initSchema(env);
  return env;
}

const pendingCount = async (env) =>
  (await env.DB.prepare('SELECT message_id FROM pending_deletes').all()).results.length;

// ---- 40 条上限 + 清空 ----
{
  const env = await envFor();
  const ids = Array.from({ length: 45 }, (_, i) => 1000 + i);
  await kv.queuePendingDeletes(env, ids);
  t.eq(await pendingCount(env), 45, 'queued 45');

  const before = tg.state.calls.deleteMessage || 0;
  const first = await runCleanup(env, Date.now());
  t.eq(first.queued, 40, 'first run takes 40');
  t.eq(first.deleted, 40, 'first run deletes 40');
  t.eq((tg.state.calls.deleteMessage || 0) - before, 40, '40 telegram deletes');
  t.eq(await pendingCount(env), 5, '5 left');

  const second = await runCleanup(env, Date.now());
  t.eq(second.queued, 5, 'second run takes rest');
  t.eq(await pendingCount(env), 0, 'queue empty');
}

// ---- 删除失败也出队（Bot API 限制被接受） ----
{
  const env = await envFor();
  await kv.queuePendingDeletes(env, [2001, 2002]);
  tg.failNext('deleteMessage', 400, { times: 1 });
  const r = await runCleanup(env, Date.now());
  t.eq(r.queued, 2, 'two queued');
  t.eq(r.deleted, 1, 'one failure tolerated');
  t.eq(await pendingCount(env), 0, 'failed one still dropped');
}

// ---- 过期上传会话 ----
{
  const env = await envFor();
  const now = Date.now();
  const { id } = await kv.insertFileNode(env, {
    parentId: null, name: 'stale.bin', size: 7, mime: 'application/octet-stream',
    status: 'uploading', chunkSize: 4, chunkCount: 2, expiresAt: now - 5000,
  });
  await kv.addPart(env, id, 0, 'tg_stale_0', 501, 4, null);
  await kv.addPart(env, id, 1, 'tg_stale_1', 502, 3, null);

  const fresh = await kv.insertFileNode(env, {
    parentId: null, name: 'fresh.bin', size: 4, mime: 'application/octet-stream',
    status: 'uploading', chunkSize: 4, chunkCount: 1, expiresAt: now + 60000,
  });

  const r = await runCleanup(env, now);
  t.eq(r.expired, 1, 'one expired upload cleaned');
  t.eq(await kv.getNode(env, id), null, 'stale node gone');
  t.eq((await kv.getParts(env, id)).length, 0, 'stale parts gone');
  t.eq(await pendingCount(env), 2, 'stale part messages queued');
  t.ok(await kv.getNode(env, fresh.id), 'fresh upload kept');

  const next = await runCleanup(env, now);
  t.eq(next.queued, 2, 'queued messages consumed next run');
  t.eq(await pendingCount(env), 0, 'nothing pending');
}

// ---- 每次最多 20 个会话 ----
{
  const env = await envFor();
  const now = Date.now();
  for (let i = 0; i < 25; i++) {
    await kv.insertFileNode(env, {
      parentId: null, name: `s${i}.bin`, size: 1, mime: 'application/octet-stream',
      status: 'uploading', chunkSize: 1, chunkCount: 1, expiresAt: now - 1000,
    });
  }
  const first = await runCleanup(env, now);
  t.eq(first.expired, 20, 'cleans 20 per run');
  const second = await runCleanup(env, now);
  t.eq(second.expired, 5, 'cleans remaining 5');
  const left = await env.DB.prepare("SELECT id FROM nodes WHERE status = 'uploading'").all();
  t.eq(left.results.length, 0, 'all expired removed');
}

t.done();
