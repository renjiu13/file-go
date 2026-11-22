// 上传幂等：重试不能重复落到 Telegram，也不能让已成功的上传显示成失败
import { handleUpload } from '../src/routes/upload.js';
import * as kv from './helpers/db.mjs';
import { fakeEnv } from './helpers/fake-d1.mjs';
import { createAssert } from './helpers/assert.mjs';

const { env, db } = fakeEnv({ BOT_TOKEN: 'mock', CHAT_ID: 'mock' });
const { eq, done } = createAssert();

let tgCalls = 0;
globalThis.fetch = async () => {
  tgCalls++;
  return new Response(JSON.stringify({
    ok: true, result: { message_id: tgCalls, document: { file_id: 'fid' + tgCalls } },
  }), { headers: { 'Content-Type': 'application/json' } });
};

await kv.initSchema(env);
await kv.ensureDir(env, 'docs');

const req = (name, path, key) => {
  const form = new FormData();
  form.append('file', new File(['payload'], name, { type: 'text/plain' }));
  form.append('path', path);
  if (key) form.append('uploadKey', key);
  return new Request('http://w.test/api/upload', { method: 'POST', body: form });
};

// ---- 同一个 uploadKey 重放首次结果 ----
const first = await handleUpload(req('a.txt', 'docs', 'k1'), env);
const firstJson = await first.json();
eq([first.status, firstJson.name, tgCalls], [200, 'a.txt', 1], '首次上传走 Telegram');

// 模拟“服务端成功、响应没回到浏览器”之后的重试
const retry = await handleUpload(req('a.txt', 'docs', 'k1'), env);
const retryJson = await retry.json();
eq(retry.status, 200, '重试仍返回成功');
eq(retryJson.replayed, true, '重试标记为重放');
eq(retryJson.id, firstJson.id, '重放返回同一个文件 id');
eq(tgCalls, 1, '重试没有第二次调用 Telegram');
eq(db.prepare('SELECT COUNT(*) c FROM files WHERE is_deleted = 0').get().c, 1, '库中仍只有一个文件');

// ---- 不同 key 是不同文件，仍要正常上传并避让同名 ----
const other = await handleUpload(req('a.txt', 'docs', 'k2'), env);
const otherJson = await other.json();
eq([tgCalls, otherJson.name, otherJson.replayed], [2, 'a (1).txt', undefined], '不同 key 正常上传并改名避让');

// ---- 不带 key 的老客户端：照常上传，不落账 ----
const legacy = await handleUpload(req('b.txt', 'docs'), env);
const legacyJson = await legacy.json();
eq([legacy.status, legacyJson.name], [200, 'b.txt'], '无幂等键也能上传');
eq(db.prepare('SELECT COUNT(*) c FROM upload_ledger').get().c, 2, '无键时不写幂等表');

// ---- 幂等记录不影响目录校验 ----
const badDir = await handleUpload(req('c.txt', 'nope', 'k3'), env);
eq(badDir.status, 400, '目录不存在仍是 400');
eq(tgCalls, 3, '目录校验先于上传');

// ---- 键被截断到 64 字符，超长输入不能撑爆主键 ----
const longKey = 'x'.repeat(200);
const capped = await handleUpload(req('d.txt', 'docs', longKey), env);
eq(capped.status, 200, '超长幂等键仍可用');
eq(db.prepare('SELECT LENGTH(upload_key) n FROM upload_ledger WHERE upload_key = ?').get(longKey.slice(0, 64)).n, 64, '键按 64 字符存储');

done();
