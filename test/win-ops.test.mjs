import * as kv from './helpers/db.mjs';
import { isValidName, nameError, sanitizeName } from '../src/utils.js';
import { fakeEnv } from './helpers/fake-d1.mjs';
import { createAssert } from './helpers/assert.mjs';

const { ok, eq, done } = createAssert();

const TRASH = '20261121';
const { env } = fakeEnv();
await kv.initSchema(env);

// 目录：docs/docs/sub dst1 d2 d3/d2 p1/p1/x g1/g1/sub ren1 t1 t2
for (const d of ['docs/sub', 'dst1', 'd2', 'd3/d2', 'p1/x', 'g1/sub', 'ren1', 't1', 't2']) {
  await kv.ensureDir(env, d);
}

const F = (id, fileId, name, path) =>
  kv.saveFile(env, { id, fileId, name, size: 1, mime: 'text/plain', path, createdAt: Date.now() });

await F('id_n1', 'f_n1', 'note.txt', '');
await F('id_k1', 'f_k1', 'keepfile.txt', '');
await F('id_m1', 'f_m1', 'm1.txt', '');
await F('id_o1', 'f_o1', 'ovr.png', '');
await F('id_a1', 'f_a1', 'a.pdf', 'docs');
await F('id_c1', 'f_c1', 'conflict.txt', 'docs');
await F('id_d1', 'f_d1', 'deep.txt', 'docs/sub');
await F('id_M1', 'f_M1', 'M1.TXT', 'dst1');
await F('id_cp', 'f_cp', 'copy.txt', 'dst1');
await F('id_o2', 'f_o2', 'ovr.png', 'dst1');
await F('id_p1', 'f_p1', 'shot.jpg', 'p1');
await F('id_g1', 'f_g1', 'inside.txt', 'g1');
await F('id_g2', 'f_g2', 'under.txt', 'g1/sub');
await F('id_r1', 'f_r1', 'keep.txt', 'ren1');

// ===== 命名规则 =====
for (const good of ['report.pdf', '我的 笔记 2024.docx', '.hidden', 'a-b_c(1).txt', 'CONTEXT', 'con1a']) {
  ok(isValidName(good), `合法名通过：${good}`);
}
for (const bad of ['', '.', '..', 'a:b.txt', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\\b',
  'a/', 'a.', 'CON', 'con.txt', 'nul', 'COM1', 'lpt9.zip', 'AUx', 'x'.repeat(101)]) {
  ok(!isValidName(bad), `非法名拒绝：${JSON.stringify(bad)}`);
  ok(nameError(bad) !== '', `非法名有可读原因：${JSON.stringify(bad)}`);
}
ok(nameError('a\\b').includes('不能包含'), '非法字符提示文案');
eq(nameError('CON'), '名称是 Windows 保留名，请换一个', '保留名提示文案');
eq(nameError('a.'), '名称不能以点或空格结尾', '结尾点提示文案');
eq(nameError('x'.repeat(101)), '名称不能超过 100 个字符', '超长提示文案');

eq(sanitizeName('a:b*c?.txt'), 'a_b_c_.txt', '上传名非法字符替换为下划线');
eq(sanitizeName('report.'), 'report', '去掉结尾的点');
eq(sanitizeName('CON'), '_CON', '保留名加前缀避免占用');
eq(sanitizeName(''), 'file', '空名兜底');
const longName = sanitizeName('x'.repeat(150) + '.txt');
ok(longName.length <= 100 && longName.endsWith('.txt'), '超长名截断且保留扩展名');
for (const raw of ['a:b*c?.txt', 'CON', 'report.', 'x'.repeat(150) + '.txt', '中文 名称.pdf']) {
  ok(isValidName(sanitizeName(raw)), `sanitize 结果一定合法：${raw.slice(0, 12)}`);
}

// ===== 冲突检测：不区分大小写、文件与文件夹共用命名空间 =====
eq(await kv.findNameClash(env, '', 'note.txt'), { kind: 'file', id: 'id_n1', name: 'note.txt' }, '同名文件检测');
eq(await kv.findNameClash(env, '', 'NOTE.TXT'), { kind: 'file', id: 'id_n1', name: 'note.txt' }, '大小写不敏感检测');
eq(await kv.findNameClash(env, '', 'note.txt', { id: 'id_n1' }), null, '排除自身后无冲突');
eq((await kv.findNameClash(env, '', 'docs')).kind, 'dir', '与同级文件夹同名也算冲突');
eq((await kv.findNameClash(env, 'docs', 'A.PDF')).kind, 'file', '子目录内检测');
eq(await kv.findNameClash(env, '', 'nothing'), null, '无冲突返回 null');

// ===== buildCandidate / uniqueName =====
eq(kv.buildCandidate('note.txt', 1), 'note (1).txt', '主名后加序号');
eq(kv.buildCandidate('archive', 1), 'archive (1)', '无扩展名');
eq(kv.buildCandidate('.hidden', 1), '.hidden (1)', '点开头视为无扩展名');
eq(await kv.uniqueName(env, '', 'note.txt'), 'note (1).txt', '自动改名避让');
eq(await kv.uniqueName(env, '', 'NOTE.TXT'), 'NOTE (1).TXT', '避让时保留请求的大小写');
eq(await kv.uniqueName(env, '', 'fresh'), 'fresh', '无冲突保持原名');
eq(await kv.uniqueName(env, '', 'docs'), 'docs (1)', '避让同名文件夹');
eq(await kv.uniqueName(env, '', 'note.txt', { id: 'id_n1' }), 'note.txt', '排除自身无需改名');

// ===== 移动文件：冲突与三种策略 =====
let r = await kv.moveItem(env, 'file', 'id_m1', 'dst1');
eq([r.ok, r.conflict], [false, true], '移动到同名处返回冲突');
eq([r.name, r.clashKind, r.clashId], ['m1.txt', 'file', 'id_M1'], '冲突详情完整');
ok(r.error.includes('M1.TXT'), '冲突提示带对方原名');

r = await kv.moveItem(env, 'file', 'id_m1', 'dst1', { onConflict: 'skip', trashDate: TRASH });
eq([r.ok, r.skipped], [true, true], '跳过策略成功且不改动');
eq((await kv.getFileMeta(env, 'id_m1')).path, '', '跳过后源文件仍在原位');

r = await kv.moveItem(env, 'file', 'id_m1', 'dst1', { onConflict: 'rename', trashDate: TRASH });
eq([r.ok, r.name], [true, 'm1 (1).txt'], '保留两者自动改名');
const moved1 = await kv.getFileMeta(env, 'id_m1');
eq([moved1.path, moved1.name], ['dst1', 'm1 (1).txt'], '改名结果已落库');

r = await kv.moveItem(env, 'file', 'id_o1', 'dst1', { onConflict: 'overwrite', trashDate: TRASH });
ok(r.ok, '覆盖策略成功');
eq((await kv.getFileMeta(env, 'id_o2')).isDeleted, true, '被覆盖项已进回收站');
eq((await kv.getFileMeta(env, 'id_o1')).name, 'ovr.png', '覆盖保留源文件名');

r = await kv.moveItem(env, 'file', 'id_n1', '');
ok(!r.ok && !r.conflict, '移动到当前目录被拒绝');
r = await kv.moveItem(env, 'file', 'id_missing', 'dst1');
ok(!r.ok, '移动不存在的文件被拒绝');

// ===== 移动目录：不支持替换 =====
r = await kv.moveItem(env, 'dir', 'd2', 'd3');
eq([r.conflict, r.clashKind], [true, 'dir'], '目录同名冲突可检测');
r = await kv.moveItem(env, 'dir', 'd2', 'd3', { onConflict: 'overwrite', trashDate: TRASH });
ok(!r.ok && !r.conflict, '目录冲突拒绝替换');
r = await kv.moveItem(env, 'dir', 'd2', 'd3', { onConflict: 'rename', trashDate: TRASH });
eq([r.ok, r.path], [true, 'd3/d2 (1)'], '目录保留两者落位');
eq((await kv.listDir(env, 'd3')).dirs.map(d => d.name), ['d2', 'd2 (1)'], '两个同名目录并存');
eq(await kv.getAllDirs(env).then(a => a.filter(p => p.startsWith('d3'))),
  ['d3', 'd3/d2', 'd3/d2 (1)'], '子目录随迁且旧位置清空');
r = await kv.moveItem(env, 'dir', 'd3', 'd3/d2');
ok(!r.ok, '目录不能移入自身子目录');
r = await kv.moveItem(env, 'dir', 'ghost', '');
ok(!r.ok && r.error.includes('不存在'), '移动不存在的目录不再静默成功');

// ===== 复制文件：粘贴回原目录同样是冲突 =====
r = await kv.copyItem(env, 'file', 'id_cp', 'dst1');
eq([r.conflict, r.clashId], [true, 'id_cp'], '复制到自身所在目录检测为冲突');
r = await kv.copyItem(env, 'file', 'id_cp', 'dst1', { onConflict: 'rename', trashDate: TRASH });
eq([r.ok, r.name], [true, 'copy (1).txt'], '复制保留两者自动改名');
r = await kv.copyItem(env, 'file', 'id_cp', 'dst1', { onConflict: 'overwrite', trashDate: TRASH });
eq([r.ok, r.skipped], [true, true], '覆盖自己按跳过处理');
r = await kv.copyItem(env, 'file', 'id_cp', 'dst1', { onConflict: 'skip', trashDate: TRASH });
eq([r.ok, r.skipped], [true, true], '跳过自己不复制');

// ===== 复制目录 =====
r = await kv.copyItem(env, 'dir', 'p1', '');
eq([r.conflict, r.clashKind], [true, 'dir'], '复制目录到同名处返回冲突');
r = await kv.copyItem(env, 'dir', 'p1', '', { onConflict: 'overwrite', trashDate: TRASH });
ok(!r.ok && !r.conflict, '复制目录不支持替换');
r = await kv.copyItem(env, 'dir', 'p1', '', { onConflict: 'rename', trashDate: TRASH });
eq([r.ok, r.path], [true, 'p1 (1)'], '复制目录保留两者');
eq((await kv.listDir(env, 'p1 (1)')).files.map(f => f.name), ['shot.jpg'], '目录复制带内容');
eq((await kv.listDir(env, 'p1 (1)')).dirs.map(d => d.name), ['x'], '子目录一并复制');
const dup = (await kv.listDir(env, 'p1 (1)')).files[0];
eq((await kv.getFileMeta(env, dup.id)).fileId, 'f_p1', '复制项复用同一 Telegram file_id');
r = await kv.copyItem(env, 'dir', 'p1', 'p1/x');
ok(!r.ok, '目录不能复制到自身子目录');

// ===== 重命名文件 =====
r = await kv.renameItem(env, 'file', 'id_a1', 'b.pdf');
eq([r.ok, r.name], [true, 'b.pdf'], '重命名文件成功');
eq((await kv.getFileMeta(env, 'id_a1')).fileId, 'f_a1', '重命名不改 fileId');
r = await kv.renameItem(env, 'file', 'id_a1', 'b.pdf');
eq([r.ok, r.error], [false, '名称未改变'], '同名重命名被拒');
r = await kv.renameItem(env, 'file', 'id_a1', 'B.PDF');
ok(r.ok, '仅改大小写允许');
r = await kv.renameItem(env, 'file', 'id_a1', 'CONFLICT.TXT');
eq([r.conflict, r.clashId], [true, 'id_c1'], '重命名到同名冲突');
r = await kv.renameItem(env, 'file', 'id_ghost', 'x.txt');
ok(!r.ok, '重命名不存在的文件被拒');

// ===== 重命名目录：整棵子树跟着走 =====
r = await kv.renameItem(env, 'dir', 'g1', '归档');
eq([r.ok, r.path], [true, '归档'], '目录重命名成功');
eq(await kv.getAllDirs(env).then(a => a.filter(p => p.indexOf('归档') === 0)), ['归档', '归档/sub'], '子目录路径同步');
ok(!(await kv.getAllDirs(env)).includes('g1'), '旧路径不再存在');
eq((await kv.listDir(env, '归档')).files.map(f => f.name), ['inside.txt'], '直属文件跟随新路径');
eq((await kv.getFileMeta(env, 'id_g2')).path, '归档/sub', '孙目录内文件路径更新');
r = await kv.renameItem(env, 'dir', 'ren1', 'ren1');
eq([r.ok, r.error], [false, '名称未改变'], '目录同名重命名被拒');
r = await kv.renameItem(env, 'dir', 'ren1', 'keepfile.txt');
eq([r.conflict, r.clashKind], [true, 'file'], '目录不能重名成同级文件');
r = await kv.renameItem(env, 'dir', 'ghost', 'x');
ok(!r.ok && r.error.includes('不存在'), '重命名不存在的目录不再静默成功');
r = await kv.renameItem(env, 'dir', '', 'x');
ok(!r.ok, '根目录不可重命名');

// ===== 回收站中的名字仍被占用 =====
await kv.softDeleteDir(env, 't1', TRASH);
r = await kv.renameItem(env, 'dir', 't2', 't1');
eq([r.conflict, r.clashKind], [true, 'dir'], '与回收站中的同名目录冲突被拦下');
r = await kv.renameItem(env, 'dir', 't2', 't1x');
ok(r.ok, '换成不冲突的名字可以重命名');

done();
