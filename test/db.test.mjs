// nodes/file_parts 数据层的核心行为：命名、移动/复制、回收站、上传会话、旧库迁移。
// 每个用例块用全新的内存库；initSchema 的缓存由 fakeEnv 重置。
import { fakeEnv } from './helpers/fake-d1.mjs';
import * as kv from './helpers/db.mjs';
import { createAssert } from './helpers/assert.mjs';

const t = createAssert();

async function fresh() {
  const { env, db } = fakeEnv();
  await kv.initSchema(env);
  return { env, db };
}

const file = (env, name, extra = {}) => kv.insertFileNode(env, Object.assign({
  parentId: null, name, size: 8, mime: 'text/plain', chunkSize: 4, chunkCount: 2,
}, extra));

// ---- 建表 ----
{
  const { env, db } = await fresh();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const name of ['file_parts', 'idem', 'meta', 'nodes', 'pending_deletes']) {
    t.ok(tables.includes(name), `table ${name}`);
  }
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
  t.ok(idx.includes('nodes_live_name'), 'index nodes_live_name');
  t.ok(idx.includes('nodes_live_root_name'), 'index nodes_live_root_name');
  t.eq(tables.includes('files'), false, 'no legacy files table on fresh db');
}

// ---- 目录与路径 ----
{
  const { env } = await fresh();
  const docs = await kv.createDir(env, null, 'Docs');
  t.ok(docs.ok, 'mkdir docs');
  const clash = await kv.createDir(env, null, 'docs');
  t.ok(clash.conflict && clash.clashId === docs.id, 'root clash is case insensitive');
  const sub = await kv.createDir(env, docs.id, 'Sub');
  t.ok(sub.ok, 'mkdir sub');

  const rootFile = await file(env, 'notes.txt');
  const rootClash = await kv.createDir(env, null, 'Notes.TXT');
  t.ok(rootClash.conflict && rootClash.clashId === rootFile.id, 'file and dir share namespace');

  const resolved = await kv.resolvePath(env, 'DOCS/Sub');
  t.ok(resolved && resolved.id === sub.id, 'resolve path case insensitive');
  t.eq(resolved.crumbs.map((c) => c.path), ['Docs', 'Docs/Sub'], 'crumbs paths');
  t.eq(await kv.resolvePath(env, 'docs/missing'), null, 'missing segment resolves null');

  const list = await kv.listChildren(env, docs.id);
  t.eq(list.dirs.map((d) => d.name), ['Sub'], 'list dirs');
  t.eq(list.files.length, 0, 'list files empty');

  const tree = await kv.getTree(env);
  t.eq(tree.map((n) => n.path), ['Docs', 'Docs/Sub'], 'tree paths');
}

// ---- 重命名冲突策略 ----
{
  const { env } = await fresh();
  const a = await file(env, 'a.txt');
  const b = await file(env, 'b.txt');
  t.ok((await kv.renameNode(env, a.id, 'a2.txt')).ok, 'rename simple');

  const conflict = await kv.renameNode(env, b.id, 'a2.txt');
  t.ok(conflict.conflict && conflict.clashId === a.id, 'rename conflict reports clash');
  const skipped = await kv.renameNode(env, b.id, 'a2.txt', 'skip');
  t.ok(skipped.ok && skipped.skipped && skipped.name === 'b.txt', 'rename skip keeps name');

  const overwritten = await kv.renameNode(env, b.id, 'a2.txt', 'overwrite');
  t.ok(overwritten.ok, 'rename overwrite ok');
  t.ok((await kv.getNode(env, a.id)).deletedAt > 0, 'overwrite moves clash to trash');

  // 把 a 从回收站恢复，名字已被占用 → 自动「保留两者」
  const restored = await kv.restoreNode(env, a.id);
  t.ok(restored.ok, 'restore after overwrite');
  t.eq(restored.name, 'a2 (1).txt', 'restore renames on clash');
  t.eq(await kv.isUniqueError(new Error('UNIQUE constraint failed: nodes.name')), true, 'unique error detection');
}

// ---- 移动 ----
{
  const { env } = await fresh();
  const dir = await kv.createDir(env, null, 'Move');
  const f = await file(env, 'm.txt');
  const g = await file(env, 'g.txt');
  const same = await kv.moveNode(env, f.id, null);
  t.eq(same.error, '文件已在该目录中', 'move to same parent rejected');

  const moved = await kv.moveNode(env, g.id, dir.id);
  t.ok(moved.ok && moved.parentId === dir.id, 'move into dir');
  t.eq((await kv.listChildren(env, dir.id)).files.map((x) => x.name), ['g.txt'], 'move visible in target');

  // 目录成环
  const a = await kv.createDir(env, null, 'A');
  const b = await kv.createDir(env, a.id, 'B');
  const cycle = await kv.moveNode(env, a.id, b.id);
  t.eq(cycle.error, '不能移动到自身或子文件夹中', 'move into own subtree rejected');

  // 目标里已有同名文件 → overwrite 把目标送进回收站
  const dup = await file(env, 'm.txt', { parentId: dir.id });
  t.ok((await kv.getNode(env, dup.id)).deletedAt == null, 'dup alive before move');
  const conflict = await kv.moveNode(env, f.id, dir.id, null);
  t.ok(conflict.conflict, 'move reports conflict');
  const ov = await kv.moveNode(env, f.id, dir.id, 'overwrite');
  t.ok(ov.ok && ov.name === 'm.txt', 'move overwrite ok');
  t.ok((await kv.getNode(env, dup.id)).deletedAt > 0, 'move overwrite trashes clash');
}

// ---- 复制：分片引用 ----
{
  const { env } = await fresh();
  const dir = await kv.createDir(env, null, 'Target');
  const src = await file(env, 'src.bin', { size: 8, chunkSize: 4, chunkCount: 2 });
  await kv.addPart(env, src.id, 0, 'tg_a', 11, 4, 'a'.repeat(64));
  await kv.addPart(env, src.id, 1, 'tg_b', 12, 4, 'b'.repeat(64));

  const copy = await kv.copyNode(env, src.id, dir.id);
  t.ok(copy.ok && copy.id !== src.id, 'copy has new id');
  const parts = await kv.getParts(env, copy.id);
  t.eq(parts.map((p) => [p.idx, p.fileId, p.messageId, p.size]), [[0, 'tg_a', null, 4], [1, 'tg_b', null, 4]], 'copy reuses tg ids, drops message ids');
  t.eq((await kv.getParts(env, src.id)).map((p) => p.messageId), [11, 12], 'source parts untouched');
  t.eq((await kv.getNode(env, copy.id)).chunkSize, 4, 'copy keeps chunk size');

  const conflict = await kv.copyNode(env, src.id, dir.id);
  t.ok(conflict.conflict, 'copy conflict reported');
  const renamed = await kv.copyNode(env, src.id, dir.id, 'keep-both');
  t.eq(renamed.name, 'src (1).bin', 'copy keep-both name');
}

// ---- 目录复制整棵子树 ----
{
  const { env } = await fresh();
  const top = await kv.createDir(env, null, 'Project');
  const inner = await kv.createDir(env, top.id, 'inner');
  const f = await file(env, 'f.txt', { parentId: inner.id, size: 4, chunkSize: 4, chunkCount: 1 });
  await kv.addPart(env, f.id, 0, 'tg_f', 21, 4, 'c'.repeat(64));
  const dest = await kv.createDir(env, null, 'Dest');

  const copied = await kv.copyNode(env, top.id, dest.id);
  t.ok(copied.ok && copied.kind === 'dir', 'dir copy ok');
  const newTop = await kv.getNode(env, copied.id);
  t.eq((await kv.listChildren(env, dest.id)).dirs.map((d) => d.name), ['Project'], 'dir copy at target');
  const newInner = (await kv.listChildren(env, copied.id)).dirs[0];
  t.ok(newInner && newInner.id !== inner.id, 'inner dir got new id');
  const newFiles = await kv.listChildren(env, newInner.id);
  t.eq(newFiles.files.map((x) => x.name), ['f.txt'], 'nested file copied');
  const newParts = await kv.getParts(env, newFiles.files[0].id);
  t.eq(newParts.map((p) => [p.fileId, p.messageId]), [['tg_f', null]], 'nested parts referenced');
}

// ---- 回收站 ----
{
  const { env } = await fresh();
  const d = await kv.createDir(env, null, 'Old');
  const child = await kv.createDir(env, d.id, 'child');
  const f = await file(env, 'x.txt', { parentId: child.id, size: 2, chunkSize: 2, chunkCount: 1 });
  const del = await kv.softDelete(env, d.id);
  t.ok(del.ok && del.count === 3, 'recursive delete count');

  const groups = await kv.getTrashList(env);
  t.eq(groups.length, 1, 'one trash group');
  t.eq(groups[0].items.map((x) => x.id), [d.id], 'only top item listed');
  t.eq(groups[0].items[0].originalPath, 'Old', 'original path');
  t.eq((await kv.restoreNode(env, child.id)).error, '请恢复回收站中的顶层项', 'child cannot restore alone');

  t.ok((await kv.restoreNode(env, d.id)).ok, 'restore top');
  t.eq((await kv.getNode(env, f.id)).deletedAt, null, 'descendants restored');
  t.eq((await kv.getTrashList(env)).length, 0, 'trash empty after restore');

  // 删除后同名新对象占位 → 恢复时自动改名
  await kv.softDelete(env, d.id);
  await kv.createDir(env, null, 'Old');
  const r2 = await kv.restoreNode(env, d.id);
  t.ok(r2.ok, 'restore with clash');
  t.eq(r2.name, 'Old (1)', 'restore keep-both name');
}

// ---- 上传会话、中断、过期 ----
{
  const { env, db } = await fresh();
  const up = await file(env, 'up.bin', { status: 'uploading', expiresAt: Date.now() + 60000, size: 8, chunkSize: 4, chunkCount: 2 });
  await kv.addPart(env, up.id, 0, 'tg_0', 501, 4, null);
  await kv.addPart(env, up.id, 1, 'tg_1', 502, 4, null);
  const aborted = await kv.abortUpload(env, up.id);
  t.eq(aborted, 2, 'abort returns part count');
  t.eq(await kv.getNode(env, up.id), null, 'aborted node deleted');
  t.eq(await kv.getParts(env, up.id), [], 'aborted parts deleted');
  t.eq(db.prepare('SELECT message_id FROM pending_deletes ORDER BY message_id').all().map((r) => r.message_id), [501, 502], 'abort queues messages');

  const old = await file(env, 'old.bin', { status: 'uploading', expiresAt: Date.now() - 1000, size: 4, chunkSize: 4, chunkCount: 1 });
  await kv.addPart(env, old.id, 0, 'tg_old', 601, 4, null);
  await kv.queuePendingDeletes(env, [601, 601]);
  const cleaned = await kv.expireUploads(env, Date.now());
  t.eq(cleaned, 1, 'expired upload cleaned');
  t.eq(await kv.getNode(env, old.id), null, 'expired node gone');
}

// ---- 旧库迁移 ----
{
  const { env, db } = fakeEnv();
  db.exec(`CREATE TABLE files (id TEXT PRIMARY KEY, file_id TEXT, message_id INTEGER, name TEXT, size INTEGER,
            mime TEXT, path TEXT, created_at INTEGER, is_deleted INTEGER, trash_date TEXT, original_path TEXT)`);
  db.exec(`CREATE TABLE dirs (path TEXT PRIMARY KEY, parent_path TEXT, created_at INTEGER,
            is_deleted INTEGER, trash_date TEXT, original_path TEXT)`);
  db.prepare("INSERT INTO dirs (path, parent_path, created_at) VALUES ('docs','',1), ('docs/sub','docs',2)").run();
  db.prepare(`INSERT INTO files (id,file_id,name,size,mime,path,created_at,is_deleted) VALUES
    ('legacy00001','fid1','deep.txt',10,'text/plain','docs/sub',10,0),
    ('legacy00002','fid2','root.txt',20,'text/plain','',20,0),
    ('legacy00003','fid3','gone.txt',30,'text/plain','',30,1)`).run();

  await kv.initSchema(env);
  const rows = await kv.listChildren(env, null);
  t.eq(rows.dirs.map((d) => d.name), ['docs'], 'migrated dirs at root');
  t.eq(rows.files.map((f) => f.name), ['root.txt'], 'migrated live root file');
  const docsId = (await kv.resolvePath(env, 'docs/sub')).id;
  const sub = await kv.listChildren(env, docsId);
  t.eq(sub.files.map((f) => f.name), ['deep.txt'], 'migrated nested file');
  const node = await kv.getNode(env, 'legacy00001');
  t.ok(node, 'legacy id preserved');
  const parts = await kv.getParts(env, 'legacy00001');
  t.eq(parts.map((p) => [p.idx, p.fileId, p.messageId, p.size, p.sha256]), [[0, 'fid1', null, 10, null]], 'legacy part single chunk');
  t.eq(node.chunkSize, 10, 'legacy chunk_size = size');
  t.eq(node.chunkCount, 1, 'legacy chunk_count 1');

  // 标记已写，再跑一次不会重复插入
  await kv.initSchema(env);
  t.eq(db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n, 4, 'migration idempotent');

  // 旧回收站里的文件不迁移
  t.eq(db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE name = 'gone.txt'").get().n, 0, 'deleted legacy file skipped');
}

t.done();
