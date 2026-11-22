import * as kv from './helpers/db.mjs';
import { sanitizeName, nameError } from '../src/utils.js';
import { fakeEnv } from './helpers/fake-d1.mjs';
import { createAssert } from './helpers/assert.mjs';

const { env } = fakeEnv();
const { ok, eq, done } = createAssert();

await kv.initSchema(env);

// ============================================================
// 命名规则测试
// ============================================================
console.log('--- 命名规则 ---');
eq(sanitizeName('hello.txt'), 'hello.txt', '正常文件名');
eq(sanitizeName('my file:name.txt'), 'my file_name.txt', '非法字符替换为下划线');
eq(sanitizeName('  bad name.  '), 'bad name', '首尾空格和点去除');
eq(sanitizeName('CON'), '_CON', '保留名加前缀');
eq(sanitizeName('nul.txt'), '_nul.txt', '保留名加扩展名');
ok(sanitizeName('a'.repeat(200)).length <= 100, '超长截断');

ok(nameError('') !== '', '空名报错');
ok(nameError('bad/name') !== '', '含斜杠报错');
ok(nameError('test.') !== '', '结尾点报错');
ok(nameError(' test') !== '', '开头空格报错');
ok(nameError('CON') !== '', '保留名报错');
ok(nameError('hello.txt') === '', '合法名通过');

// ============================================================
// 重命名 + 冲突
// ============================================================
console.log('--- 重命名 ---');
await kv.addDir(env, 'docs');
await kv.saveFile(env, { id: 'f_rename_01', fileId: 'fx', name: 'a.txt', size: 1, path: 'docs' });
await kv.saveFile(env, { id: 'f_rename_02', fileId: 'fy', name: 'b.txt', size: 2, path: 'docs' });

let r = await kv.renameItem(env, 'file', 'f_rename_01', 'b.txt');
ok(r.conflict && r.clashName === 'b.txt', '重命名同名冲突返回 conflict');

// 用 rename 策略（保留两者）
r = await kv.renameItem(env, 'file', 'f_rename_01', 'b.txt', { onConflict: 'rename' });
ok(r.ok && r.name === 'b (1).txt', '重命名保留两者自动编号');

// ============================================================
// 放入回收站 + 恢复 + 冲突
// ============================================================
console.log('--- 回收站 & 恢复 ---');
await kv.addDir(env, 'trash_test');
await kv.saveFile(env, { id: 'f_trash_01', fileId: 'f1', name: 'keep.txt', size: 10, path: 'trash_test' });
await kv.saveFile(env, { id: 'f_trash_02', fileId: 'f2', name: 'gone.txt', size: 20, path: 'trash_test' });

// 删除 gone.txt
r = await kv.softDeleteFile(env, 'f_trash_02', '20261122');
ok(r.ok, '软删除文件成功');

// 恢复
r = await kv.restoreItem(env, 'file', 'f_trash_02');
ok(r.ok, '恢复文件成功');
const meta = await kv.getFileMeta(env, 'f_trash_02');
ok(!meta.isDeleted, '恢复后 is_deleted 为 0');

// 再删一次，然后在原目录上传同名文件，再恢复时应冲突
await kv.softDeleteFile(env, 'f_trash_02', '20261123');
await kv.saveFile(env, { id: 'f_new_01', fileId: 'fn', name: 'gone.txt', size: 30, path: 'trash_test' });

r = await kv.restoreItem(env, 'file', 'f_trash_02');
ok(r.conflict && r.clashKind === 'file', '恢复同名冲突返回 conflict');

// 跳过策略
r = await kv.restoreItem(env, 'file', 'f_trash_02', { onConflict: 'skip' });
ok(r.ok && r.skipped, '冲突时跳过策略');

// 替换策略（把现有文件移进回收站）
r = await kv.restoreItem(env, 'file', 'f_trash_02', { onConflict: 'overwrite', trashDate: '20261124' });
ok(r.ok, '冲突时替换策略成功');
const old = await kv.getFileMeta(env, 'f_new_01');
ok(old && old.isDeleted, '被替换的文件移入回收站');

// 保留两者策略：先把恢复的文件再删掉，再放一个同名文件占坑，然后用 rename 策略恢复
await kv.softDeleteFile(env, 'f_trash_02', '20261125');
await kv.saveFile(env, { id: 'f_new_02', fileId: 'fn2', name: 'gone.txt', size: 99, path: 'trash_test' });
r = await kv.restoreItem(env, 'file', 'f_trash_02', { onConflict: 'rename' });
ok(r.ok && r.name === 'gone (1).txt', '保留两者自动重命名');

// ============================================================
// 目录删除 + 回收站列表（子项可见）
// ============================================================
console.log('--- 目录删除 & 回收站可见性 ---');
await kv.addDir(env, 'top');
await kv.addDir(env, 'top/sub');
await kv.saveFile(env, { id: 'f_dir_01', fileId: 'fd1', name: 'in-top.txt', size: 5, path: 'top' });
await kv.saveFile(env, { id: 'f_dir_02', fileId: 'fd2', name: 'in-sub.txt', size: 6, path: 'top/sub' });

await kv.softDeleteDir(env, 'top', '20261126');

const trash = await kv.getTrashList(env);
const items26 = trash['20261126'] || [];
ok(items26.some(i => i.type === 'dir' && i.path === 'top'), '被删目录在回收站可见');
ok(items26.some(i => i.type === 'dir' && i.path === 'top/sub'), '被删子目录在回收站可见');
ok(items26.some(i => i.type === 'file' && i.id === 'f_dir_01'), '目录内文件在回收站可见');
ok(items26.some(i => i.type === 'file' && i.id === 'f_dir_02'), '子目录内文件在回收站可见');

// ============================================================
// 批量放入回收站
// ============================================================
console.log('--- 批量操作 ---');
await kv.addDir(env, 'batch_src');
await kv.saveFile(env, { id: 'f_b1', fileId: 'fb1', name: 'one.txt', size: 1, path: 'batch_src' });
await kv.saveFile(env, { id: 'f_b2', fileId: 'fb2', name: 'two.txt', size: 2, path: 'batch_src' });
await kv.saveFile(env, { id: 'f_b3', fileId: 'fb3', name: 'three.txt', size: 3, path: 'batch_src' });

const batchResult = await kv.batchTrash(env, [
  { type: 'file', id: 'f_b1' },
  { type: 'file', id: 'f_b2' },
  { type: 'file', id: 'nonexistent' },
], '20261127');

eq(batchResult.success, 2, '批量删除成功数');
eq(batchResult.failed, 1, '批量删除失败数');
eq(batchResult.skipped, 0, '批量删除跳过数');

// ============================================================
// 批量移动（含冲突处理）
// ============================================================
await kv.addDir(env, 'move_dest');
await kv.saveFile(env, { id: 'f_mv_dest', fileId: 'fmd', name: 'a.txt', size: 100, path: 'move_dest' });

await kv.addDir(env, 'move_src');
await kv.saveFile(env, { id: 'f_mv_src1', fileId: 'fms1', name: 'a.txt', size: 1, path: 'move_src' });
await kv.saveFile(env, { id: 'f_mv_src2', fileId: 'fms2', name: 'b.txt', size: 2, path: 'move_src' });

// 缺省策略：遇冲突直接返回 conflict
const mv1 = await kv.batchMove(env, [
  { type: 'file', id: 'f_mv_src1' },
  { type: 'file', id: 'f_mv_src2' },
], 'move_dest');
ok(mv1.results.some(r => r.conflict), '批量移动缺省时返回冲突项');
ok(mv1.results.some(r => r.ok && !r.conflict && r.name === 'b.txt'), '无冲突项移动成功');

// 跳过策略
const mv2 = await kv.batchMove(env, [
  { type: 'file', id: 'f_mv_src1' },
], 'move_dest', { onConflict: 'skip' });
ok(mv2.success === 0 && mv2.skipped === 1, '跳过策略计数正确');

// 替换策略
const mv3 = await kv.batchMove(env, [
  { type: 'file', id: 'f_mv_src1' },
], 'move_dest', { onConflict: 'overwrite', trashDate: '20261128' });
eq(mv3.success, 1, '替换策略移动成功');
const destList = (await kv.listDir(env, 'move_dest')).files;
eq(destList.find(f => f.name === 'a.txt').size, 1, '替换后目标文件是源文件大小');

// ============================================================
// 同目录移动被拒绝
// ============================================================
await kv.addDir(env, 'same_dir');
await kv.saveFile(env, { id: 'f_same', fileId: 'fs', name: 'same.txt', size: 9, path: 'same_dir' });
const same = await kv.moveItem(env, 'file', 'f_same', 'same_dir');
ok(!same.ok && same.error && same.error.indexOf('无需') >= 0, '同目录移动被拒绝');

const sameDir = await kv.moveItem(env, 'dir', 'same_dir', '');
ok(!sameDir.ok, '目录移动到原位置被拒绝');

// ============================================================
// 目录循环防护
// ============================================================
await kv.addDir(env, 'parent');
await kv.addDir(env, 'parent/child');
const loop1 = await kv.moveItem(env, 'dir', 'parent', 'parent/child');
ok(!loop1.ok, '不能移入子目录');
const loop2 = await kv.copyItem(env, 'dir', 'parent', 'parent/child');
ok(!loop2.ok, '不能复制到子目录');

// ============================================================
// 复制不影响原文件
// ============================================================
await kv.addDir(env, 'copy_src');
await kv.addDir(env, 'copy_dest');
await kv.saveFile(env, { id: 'f_copy_orig', fileId: 'fco', name: 'orig.txt', size: 42, path: 'copy_src' });

const cp = await kv.copyItem(env, 'file', 'f_copy_orig', 'copy_dest');
ok(cp.ok && cp.newId, '复制成功并返回新ID');
ok(cp.newId !== 'f_copy_orig', '新ID不等于原ID');
const orig = await kv.getFileMeta(env, 'f_copy_orig');
ok(!orig.isDeleted && orig.path === 'copy_src', '原文件不受影响');

// ============================================================
// 目录复制保持结构
// ============================================================
await kv.addDir(env, 'tree_src');
await kv.addDir(env, 'tree_src/deep');
await kv.saveFile(env, { id: 'f_tree_1', fileId: 'ft1', name: 'root.txt', size: 1, path: 'tree_src' });
await kv.saveFile(env, { id: 'f_tree_2', fileId: 'ft2', name: 'deep.txt', size: 2, path: 'tree_src/deep' });

const treeCp = await kv.copyItem(env, 'dir', 'tree_src', 'copy_dest');
ok(treeCp.ok, '目录复制成功');

const deepDir = await kv.dirExists(env, 'copy_dest/tree_src/deep');
ok(deepDir, '复制后子目录存在');

const deepFiles = (await kv.listDir(env, 'copy_dest/tree_src/deep')).files;
eq(deepFiles.length, 1, '子目录文件数正确');
ok(deepFiles[0].name === 'deep.txt', '子目录文件名正确');

const rootFiles = (await kv.listDir(env, 'copy_dest/tree_src')).files;
eq(rootFiles.length, 1, '根目录文件数正确');

// 源目录不受影响
const srcFiles = (await kv.listDir(env, 'tree_src')).files;
eq(srcFiles.length, 1, '源目录文件数不变');

done();
