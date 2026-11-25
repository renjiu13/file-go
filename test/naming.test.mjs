// 命名规则必须两端一致：服务端 src/utils.js 与浏览器 src/page/naming.js 共用同一批向量。
import { readFileSync } from 'node:fs';
import * as u from '../src/utils.js';
import { buildCandidate as serverCandidate } from '../src/db/naming.js';
import { namingModule } from '../src/page/naming.js';
import { createAssert } from './helpers/assert.mjs';

const t = createAssert();
const fixture = JSON.parse(readFileSync(new URL('./fixtures/naming.json', import.meta.url), 'utf8'));
const FG = {};
namingModule(FG);
const b = FG.naming;

for (const v of fixture.names) {
  t.eq(u.isValidName(v.name), v.valid, `server valid ${JSON.stringify(v.name)}`);
  t.eq(b.isValidName(v.name), v.valid, `browser valid ${JSON.stringify(v.name)}`);
  t.eq(u.nameError(v.name), v.error, `server error ${JSON.stringify(v.name)}`);
  t.eq(b.nameError(v.name), v.error, `browser error ${JSON.stringify(v.name)}`);
  t.eq(u.sanitizeName(v.name), v.sanitized, `server sanitize ${JSON.stringify(v.name)}`);
  t.eq(b.sanitizeName(v.name), v.sanitized, `browser sanitize ${JSON.stringify(v.name)}`);
}

for (const c of fixture.candidates) {
  t.eq(serverCandidate(c.name, c.n), c.out, `server candidate ${c.name}`);
  t.eq(b.buildCandidate(c.name, c.n), c.out, `browser candidate ${c.name}`);
}

for (const c of fixture.unique) {
  t.eq(b.uniqueLocal(c.name, c.names), c.out, `browser unique ${c.name}`);
}

// 长度边界：101 个字符被拒绝且清理后正好 100；截断保留扩展名。
const long = 'a'.repeat(101);
t.eq(u.isValidName(long), false, 'server rejects 101');
t.eq(b.isValidName(long), false, 'browser rejects 101');
t.eq(u.sanitizeName(long).length, 100, 'server truncates to 100');
t.eq(b.sanitizeName(long).length, 100, 'browser truncates to 100');
const longExt = 'a'.repeat(120) + '.txt';
t.eq(u.sanitizeName(longExt).length, 100, 'server truncates keeping length');
t.ok(u.sanitizeName(longExt).endsWith('.txt'), 'server keeps extension');
t.eq(b.sanitizeName(longExt), u.sanitizeName(longExt), 'browser matches truncation');

// 两个实现的清理结果对所有向量一致（即使未来加规则也不会悄悄漂移）。
for (const v of fixture.names) t.eq(b.sanitizeName(v.name), u.sanitizeName(v.name), `parity ${JSON.stringify(v.name)}`);

t.done();
