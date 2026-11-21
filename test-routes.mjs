import { DatabaseSync } from 'node:sqlite';
import worker from './src/index.js';
import * as kv from './src/kv.js';

// 用 node:sqlite 模拟 D1，通过 worker.fetch 覆盖路由层：
// kv.js 的单元测试看不到 index.js 是否把 onConflict / targetDir 透传下去，这里补上。
function makeEnv() {
  const db = new DatabaseSync(':memory:');
  return {
    DB: {
      prepare(sql) {
        let args = [];
        return {
          bind(...a) { args = a; return this; },
          async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
          async first() { return db.prepare(sql).get(...args) ?? null; },
          async all() { return { results: db.prepare(sql).all(...args) }; },
          async _auto() { return /^\s*SELECT/i.test(sql) ? this.all() : this.run(); },
        };
      },
      async batch(stmts) {
        const out = [];
        for (const s of stmts) out.push(await s._auto());
        return out;
      },
    },
    BOT_TOKEN: 'test-token',
    CHAT_ID: '-100test',
  };
}

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.error(`FAIL: ${label}\n  actual   ${a}\n  expected ${e}`); }
}

const env = makeEnv();
await kv.initSchema(env);

async function api(path, body) {
  const res = await worker.fetch(new Request('http://local' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env, {});
  return { status: res.status, json: await res.json() };
}

const row = (sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const seed = (id, name, path) =>
  kv.saveFile(env, { id, fileId: 'tg_' + id, name, size: 10, mime: 'text/plain', path, createdAt: Date.now() });

// 播种：根目录与 docs 各放一组同名文件，用于制造冲突
await api('/api/mkdir', { name: 'docs', parent: '' });
await seed('id_a', 'keep.txt', '');
await seed('id_b', 'other.txt', '');
await seed('id_m', 'data.csv', '');
await seed('id_md', 'data.csv', 'docs');
await seed('id_n', 'notes.txt', '');
await seed('id_nd', 'notes.txt', 'docs');
await seed('id_s', 'snap', '');
await api('/api/mkdir', { name: 'snapshots', parent: '' });

// ===== 重命名：冲突检测与三种策略（策略曾被路由丢弃，只剩冲突可用）=====
let r = await api('/api/rename', { type: 'file', source: 'id_a', newName: 'other.txt' });
eq([r.status, r.json.conflict, r.json.clashId], [409, true, 'id_b'], '重命名同名返回 409 冲突');

r = await api('/api/rename', { type: 'file', source: 'id_a', newName: 'other.txt', onConflict: 'rename' });
eq([r.status, r.json.ok, r.json.name], [200, true, 'other (1).txt'], '重命名保留两者由路由转发生效');

r = await api('/api/rename', { type: 'file', source: 'id_a', newName: 'other.txt', onConflict: 'skip' });
eq([r.status, r.json.ok, r.json.skipped], [200, true, true], '重命名跳过生效');

r = await api('/api/rename', { type: 'file', source: 'id_a', newName: 'other.txt', onConflict: 'overwrite' });
eq([r.status, r.json.ok, r.json.name], [200, true, 'other.txt'], '重命名替换生效');
eq((await row('SELECT is_deleted FROM files WHERE id = ?', 'id_b')).is_deleted, 1, '被替换项进入回收站');

// ===== 文件与目录共用命名空间 =====
r = await api('/api/rename', { type: 'dir', source: 'snapshots', newName: 'snap' });
eq([r.status, r.json.conflict, r.json.clashKind], [409, true, 'file'], '目录重命名撞上同级同名文件');

r = await api('/api/rename', { type: 'dir', source: 'docs', newName: 'docs' });
eq([r.status, r.json.error], [400, '名称未改变'], '目录同名重命名被拒');

r = await api('/api/mkdir', { name: 'docs', parent: '' });
eq([r.status, r.json.conflict], [409, true], '新建同名目录返回冲突');

// ===== 移动 / 复制：策略同样要透传 =====
r = await api('/api/move', { type: 'file', source: 'id_m', targetDir: 'docs' });
eq([r.status, r.json.conflict, r.json.clashId], [409, true, 'id_md'], '移动到同名文件返回冲突');

r = await api('/api/move', { type: 'file', source: 'id_m', targetDir: 'docs', onConflict: 'rename' });
eq([r.status, r.json.ok, r.json.name], [200, true, 'data (1).csv'], '移动保留两者生效');

r = await api('/api/copy', { type: 'file', source: 'id_n', targetDir: 'docs', onConflict: 'rename' });
eq([r.status, r.json.ok, r.json.name], [200, true, 'notes (1).txt'], '复制保留两者生效');
eq((await row('SELECT path FROM files WHERE id = ?', 'id_n')).path, '', '复制后原文件仍在原位');

// ===== 路由层的非法名拦截 =====
r = await api('/api/rename', { type: 'file', source: 'id_a', newName: 'a:b' });
eq([r.status, !!r.json.error], [400, true], '非法名重命名返回 400');
r = await api('/api/mkdir', { name: 'CON', parent: '' });
eq([r.status, !!r.json.error], [400, true], '保留名目录返回 400');

// ===== 恢复：路由要转发 onConflict =====
r = await api('/api/delete', { type: 'file', id: 'id_nd' });
eq([r.status, r.json.ok], [200, true], '删除接口可用');
await seed('id_nd2', 'notes.txt', 'docs');
r = await api('/api/restore', { type: 'file', id: 'id_nd', onConflict: 'rename' });
eq([r.status, r.json.ok, r.json.name], [200, true, 'notes (2).txt'], '恢复时保留两者避让新占名');

// ===== 批量接口 =====
r = await api('/api/batch-trash', { items: [{ type: 'file', id: 'id_m' }, { type: 'file', id: 'ghost' }] });
eq([r.json.success, r.json.failed], [1, 1], '批量回收站统计成功与失败');

r = await api('/api/batch-restore', { items: [{ type: 'file', id: 'id_m' }], onConflict: 'rename' });
eq([r.status, r.json.success], [200, 1], '批量恢复生效');

r = await api('/api/batch-move', { items: [{ type: 'file', id: 'id_s' }], targetDir: 'docs', onConflict: 'rename' });
eq([r.status, r.json.success], [200, 1], '批量移动保留两者生效');

r = await api('/api/batch-copy', { items: [{ type: 'dir', path: 'snapshots' }, { type: 'file', id: 'ghost' }], targetDir: 'docs' });
eq([r.status, r.json.success, r.json.failed], [200, 1, 1], '批量复制汇报成功与失败');

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
