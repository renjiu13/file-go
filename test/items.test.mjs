// 元数据操作路由：mkdir/list/tree/rename/move/copy/delete/restore/batch。
import worker from '../src/index.js';
import { fakeEnv } from './helpers/fake-d1.mjs';
import * as kv from './helpers/db.mjs';
import { createAssert } from './helpers/assert.mjs';

const t = createAssert();

async function envFor() {
  const { env, db } = fakeEnv({ BOT_TOKEN: 'tok', CHAT_ID: '-100' });
  await kv.initSchema(env);
  return { env, db };
}

function call(env, path, opts = {}) {
  return worker.fetch(new Request('http://local' + path, opts), env);
}
async function post(env, path, body) {
  return call(env, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const jsonOf = async (res) => res.json();

async function seedFile(env, name, parentId = null, sizes = [4]) {
  const size = sizes.reduce((a, b) => a + b, 0);
  const { id } = await kv.insertFileNode(env, {
    parentId, name, size, mime: 'application/octet-stream',
    chunkSize: 4, chunkCount: sizes.length,
  });
  for (let i = 0; i < sizes.length; i++) {
    await kv.addPart(env, id, i, `tg_${id}_${i}`, 300 + i, sizes[i], null);
  }
  return { id, size };
}

// ---- mkdir / list / tree ----
{
  const { env } = await envFor();
  const docs = await jsonOf(await post(env, '/api/mkdir', { name: 'docs', parentId: null }));
  t.eq(docs.ok, true, 'mkdir docs');
  const y = await jsonOf(await post(env, '/api/mkdir', { name: '2026', parentId: docs.id }));
  t.eq(y.ok, true, 'mkdir nested');

  const dup = await post(env, '/api/mkdir', { name: 'docs', parentId: null });
  t.eq(dup.status, 409, 'mkdir clash 409');
  t.eq((await jsonOf(dup)).clashKind, 'dir', 'mkdir clash kind');
  t.eq((await post(env, '/api/mkdir', { name: '' })).status, 400, 'empty dir name 400');
  t.eq((await post(env, '/api/mkdir', { name: 'x', parentId: 'nope' })).status, 404, 'missing parent 404');

  const list = await jsonOf(await call(env, '/api/list?path=docs%2F2026'));
  t.eq(list.path, 'docs/2026', 'list path normalized');
  t.eq(list.dirId, y.id, 'list dir id');
  t.eq(list.crumbs.length, 2, 'crumbs length');
  t.eq(list.crumbs.map((c) => c.path).join('|'), 'docs|docs/2026', 'crumb paths');

  const root = await jsonOf(await call(env, '/api/list'));
  t.eq(root.dirs.map((d) => d.name).join(','), 'docs', 'root dirs');

  const tree = await jsonOf(await call(env, '/api/tree'));
  t.eq(tree.tree.map((d) => d.path).join('|'), 'docs|docs/2026', 'tree paths');
}

// ---- rename ----
{
  const { env } = await envFor();
  const dirs = await jsonOf(await post(env, '/api/mkdir', { name: 'docs' }));
  const { id } = await seedFile(env, 'a.txt');
  const ok = await post(env, '/api/rename', { id, name: 'b.txt' });
  t.eq(ok.status, 200, 'rename ok');
  t.eq((await kv.getNode(env, id)).name, 'b.txt', 'renamed');

  const clash = await post(env, '/api/rename', { id, name: 'docs' });
  t.eq(clash.status, 409, 'rename clash 409');
  t.eq((await jsonOf(clash)).clashId, dirs.id, 'rename clash id');
  const kept = await post(env, '/api/rename', { id, name: 'docs', onConflict: 'rename' });
  t.eq(kept.status, 200, 'rename keep-both');
  t.eq((await kv.getNode(env, id)).name, 'docs (1)', 'keep-both name');

  const other = await seedFile(env, 'other.txt');
  const skip = await post(env, '/api/rename', { id, name: 'other.txt', onConflict: 'skip' });
  const skipBody = await jsonOf(skip);
  t.eq(skipBody.skipped, true, 'rename skip');
  t.eq((await kv.getNode(env, id)).name, 'docs (1)', 'skip keeps name');
  t.eq((await kv.getNode(env, other.id)).name, 'other.txt', 'clash untouched');

  const longName = 'x'.repeat(120) + '.txt';
  const shortRes = await post(env, '/api/rename', { id, name: longName });
  t.eq(shortRes.status, 400, 'overlong name rejected');
}

// ---- move ----
{
  const { env } = await envFor();
  const A = await jsonOf(await post(env, '/api/mkdir', { name: 'A' }));
  const B = await jsonOf(await post(env, '/api/mkdir', { name: 'B' }));
  const child = await jsonOf(await post(env, '/api/mkdir', { name: 'sub', parentId: A.id }));
  const { id: fid } = await seedFile(env, 'f.bin', A.id);

  t.eq((await post(env, '/api/move', { id: fid, targetId: B.id })).status, 200, 'move ok');
  t.eq((await kv.getNode(env, fid)).parentId, B.id, 'moved parent');
  t.eq((await post(env, '/api/move', { id: fid, targetId: B.id })).status, 400, 'same dir rejected');
  t.eq((await post(env, '/api/move', { id: A.id, targetId: child.id })).status, 400, 'cycle rejected');

  // 重名覆盖：把文件移回 A，再在 B 里放一个同名文件
  await post(env, '/api/move', { id: fid, targetId: A.id });
  await seedFile(env, 'f.bin', B.id);
  const overwrite = await post(env, '/api/move', { id: fid, targetId: B.id, onConflict: 'overwrite' });
  t.eq(overwrite.status, 200, 'move overwrite name clash');
  const clashRows = await env.DB.prepare(
    "SELECT id FROM nodes WHERE parent_id = ? AND name = ? AND deleted_at IS NOT NULL"
  ).bind(B.id, 'f.bin').all();
  t.eq(clashRows.results.length, 1, 'clash trashed');
}

// ---- copy ----
{
  const { env } = await envFor();
  const docs = await jsonOf(await post(env, '/api/mkdir', { name: 'docs' }));
  const { id: srcId } = await seedFile(env, 'g.bin', null, [4, 4]);
  const cp = await jsonOf(await post(env, '/api/copy', { id: srcId, targetId: docs.id }));
  t.eq(cp.ok, true, 'copy ok');
  const copy = await kv.getNode(env, cp.id);
  t.eq(copy.size, 8, 'copy size');
  const parts = await kv.getParts(env, cp.id);
  t.eq(parts.length, 2, 'copy parts');
  t.eq(parts[0].fileId, `tg_${srcId}_0`, 'copy shares telegram file');
  t.eq(parts[0].messageId, null, 'copy clears message id');

  const A = await jsonOf(await post(env, '/api/mkdir', { name: 'A' }));
  await post(env, '/api/mkdir', { name: 'inner', parentId: A.id });
  const sub = await jsonOf(await post(env, '/api/mkdir', { name: 'sub', parentId: A.id }));
  const dcp = await jsonOf(await post(env, '/api/copy', { id: A.id, targetId: docs.id }));
  t.eq(dcp.kind, 'dir', 'copy dir');
  const path = await kv.resolvePath(env, 'docs/A/inner');
  t.ok(path, 'copy dir subtree');
  t.eq((await post(env, '/api/copy', { id: A.id, targetId: sub.id })).status, 400, 'copy into self rejected');
}

// ---- delete / trash / restore ----
{
  const { env } = await envFor();
  const A = await jsonOf(await post(env, '/api/mkdir', { name: 'A' }));
  const f = await seedFile(env, 'keep.bin', A.id);
  await post(env, '/api/mkdir', { name: 'inner', parentId: A.id });

  const del = await jsonOf(await post(env, '/api/delete', { id: A.id }));
  t.eq(del.ok, true, 'delete dir');
  t.eq(del.count, 3, 'delete whole subtree');
  const root = await jsonOf(await call(env, '/api/list'));
  t.eq(root.dirs.length, 0, 'deleted dir hidden');

  const trash = await jsonOf(await call(env, '/api/trash'));
  t.eq(trash.groups.length, 1, 'trash group');
  t.eq(trash.groups[0].items.length, 1, 'trash shows only top');
  t.eq(trash.groups[0].items[0].id, A.id, 'top item id');
  t.eq(trash.groups[0].items[0].originalPath, 'A', 'original path');

  const childRestore = await post(env, '/api/restore', { id: f.id });
  t.eq(childRestore.status, 400, 'restore child rejected');
  t.eq((await jsonOf(childRestore)).error, '请恢复回收站中的顶层项', 'restore child message');

  const restore = await post(env, '/api/restore', { id: A.id });
  t.eq(restore.status, 200, 'restore top');
  t.eq((await kv.getNode(env, f.id)).deletedAt, null, 'descendant restored too');
  const back = await jsonOf(await call(env, '/api/list?path=A'));
  t.eq(back.files.length, 1, 'restored file visible');
}

// ---- batch ----
{
  const { env } = await envFor();
  const docs = await jsonOf(await post(env, '/api/mkdir', { name: 'docs' }));
  const a = await seedFile(env, 'a1.bin');
  const b = await seedFile(env, 'b1.bin');
  const c = await seedFile(env, 'c1.bin');

  const tr = await jsonOf(await post(env, '/api/batch', { action: 'trash', items: [{ id: a.id }, { id: b.id }] }));
  t.eq(tr.success, 2, 'batch trash');
  t.eq((await kv.getNode(env, a.id)).deletedAt !== null, true, 'batch trashed a');

  const rs = await jsonOf(await post(env, '/api/batch', { action: 'restore', items: [{ id: a.id }, { id: b.id }] }));
  t.eq(rs.success, 2, 'batch restore');

  const mv = await jsonOf(await post(env, '/api/batch', {
    action: 'move', items: [{ id: a.id }, { id: b.id }], targetId: docs.id,
  }));
  t.eq(mv.success, 2, 'batch move');

  // 同名冲突：默认没有策略 -> 逐项失败但请求本身 200
  const cp = await jsonOf(await post(env, '/api/batch', {
    action: 'copy', items: [{ id: a.id }, { id: b.id }], targetId: docs.id,
  }));
  t.eq(cp.failed, 2, 'batch copy reports conflicts');
  t.eq(cp.results[0].conflict, true, 'batch result conflict flag');

  const tooMany = await post(env, '/api/batch', {
    action: 'trash', items: Array.from({ length: 9 }, (_, i) => ({ id: 'x' + i })),
  });
  t.eq(tooMany.status, 400, 'batch cap');
  t.eq((await jsonOf(tooMany)).max, 8, 'batch cap reported');
  t.eq((await post(env, '/api/batch', { action: 'nope', items: [{ id: c.id }] })).status, 400, 'unknown action');
  t.eq((await post(env, '/api/batch', { action: 'trash', items: [{}] })).status, 400, 'missing id');
}

t.done();
