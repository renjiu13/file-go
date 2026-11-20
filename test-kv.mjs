import { DatabaseSync } from 'node:sqlite';
import * as kv from './src/kv.js';

// 用 node:sqlite 模拟 D1 的 prepare/bind/run/first/all/batch 接口
const db = new DatabaseSync(':memory:');
const env = {
  DB: {
    prepare(sql) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async _auto() {
          return /^\s*SELECT/i.test(sql) ? this.all() : this.run();
        },
      };
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s._auto());
      return out;
    },
  },
};

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', label); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.error(`FAIL: ${label}\n  actual   ${a}\n  expected ${e}`); }
}

await kv.initSchema(env);

// 构建目录 a, a/b, m, m/mom, c
await kv.ensureDir(env, 'a/b');
await kv.ensureDir(env, 'm/mom');
await kv.addDir(env, 'c');

await kv.saveFile(env, { id: 'idx000000001', fileId: 'fx', name: 'x.jpg', size: 10, mime: 'image/jpeg', path: 'a' });
await kv.saveFile(env, { id: 'idy000000002', fileId: 'fy', name: 'y.jpg', size: 20, mime: 'image/jpeg', path: 'a/b' });
await kv.saveFile(env, { id: 'idm000000003', fileId: 'fm', name: 'mum.txt', size: 5, mime: 'text/plain', path: 'm' });

// ---- 无效移动拦截 ----
let r = await kv.moveItem(env, 'file', 'idx000000001', 'a');
ok(!r.ok, '文件移动到同目录被拒绝');

r = await kv.moveItem(env, 'dir', 'a', '');
ok(!r.ok, '目录移动到原位置被拒绝');

r = await kv.moveItem(env, 'dir', 'a', 'a/b');
ok(!r.ok, '目录移入自身子目录被拒绝');

// ---- 正常移动：前缀替换不污染 + parent_path 同步 ----
r = await kv.moveItem(env, 'dir', 'm', 'c');
ok(r.ok, '移动 m 到 c 成功');

eq(await kv.getAllDirs(env), ['a', 'a/b', 'c', 'c/m', 'c/m/mom'], '移动后目录路径正确');

const cList = await kv.listDir(env, 'c');
eq(cList.dirs.map(d => d.name), ['m'], 'parent_path 已同步，m 出现在 c 下');

const cmList = await kv.listDir(env, 'c/m');
eq(cmList.dirs.map(d => d.name), ['mom'], '子目录名未被 replace 污染');
eq(cmList.files.map(f => f.name), ['mum.txt'], '文件名未被 replace 污染');

// ---- 回收站：先单独删文件，再整目录删除 ----
await kv.softDeleteFile(env, 'idx000000001', '20261120');
await kv.softDeleteDir(env, 'a', '20261121');

const trash = await kv.getTrashList(env);
ok(trash['20261120'] && trash['20261120'].some(i => i.type === 'file' && i.id === 'idx000000001'),
  '单独删除的文件保留在自己的删除日期分组');

const g21 = trash['20261121'] || [];
ok(g21.some(i => i.type === 'dir' && i.path === 'a'), '被删目录本身可见');
ok(g21.some(i => i.type === 'dir' && i.path === 'a/b'), '被删目录的子目录可见');
ok(g21.some(i => i.type === 'file' && i.id === 'idy000000002'), '被删目录里的文件可见');
ok(!g21.some(i => i.id === 'idx000000001'), '之前单独删除的文件未被并入目录删除日期分组');

// ---- 恢复顺序检查 ----
r = await kv.restoreItem(env, 'file', 'idy000000002');
ok(!r.ok, '父目录未恢复时单独恢复文件被拒绝');

r = await kv.restoreItem(env, 'dir', 'a/b');
ok(!r.ok, '上级目录未恢复时单独恢复子目录被拒绝');

r = await kv.restoreItem(env, 'dir', 'a');
ok(r.ok, '恢复目录 a 成功');
ok(await kv.dirExists(env, 'a'), '目录 a 已恢复');
ok(await kv.dirExists(env, 'a/b'), '子目录 a/b 已恢复');

const la = await kv.listDir(env, 'a');
ok(la.files.length === 1, '目录 a 下文件已恢复');
const lab = await kv.listDir(env, 'a/b');
ok(lab.files.length === 1 && lab.files[0].name === 'y.jpg', '子目录文件 y.jpg 已恢复');

const trashAfter = await kv.getTrashList(env);
eq(Object.keys(trashAfter), [], '恢复后回收站为空');

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
