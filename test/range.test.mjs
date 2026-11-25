// Range → 分片映射的纯函数边界用例。
import {
  MAX_SUBREQUESTS_PER_RESPONSE,
  parseRange,
  sliceParts,
  partBounds,
  missingParts,
} from '../src/range.js';
import { createAssert } from './helpers/assert.mjs';

const t = createAssert();
const SIZE = 10; // 4 + 4 + 2，最后一片不完整
const CS = 4;

t.eq(MAX_SUBREQUESTS_PER_RESPONSE, 42, 'budget constant');

const R = (header, size = SIZE) => parseRange(header, size);
t.eq(R('bytes=0-0'), { start: 0, end: 0 }, 'single byte');
t.eq(R('bytes=0-3'), { start: 0, end: 3 }, 'first part');
t.eq(R('bytes=3-3'), { start: 3, end: 3 }, 'chunk_size - 1');
t.eq(R('bytes=3-'), { start: 3, end: 9 }, 'open ended');
t.eq(R('bytes=-2'), { start: 8, end: 9 }, 'last n bytes');
t.eq(R('bytes=-20'), { start: 0, end: 9 }, 'suffix larger than file clamps');
t.eq(R('bytes=9-9'), { start: 9, end: 9 }, 'last byte');
t.eq(R('bytes=9-'), { start: 9, end: 9 }, 'last byte open');
t.eq(R('bytes=0-100'), { start: 0, end: 9 }, 'end clamped');
t.eq(R('bytes=10-'), { unsatisfiable: true }, 'start == size');
t.eq(R('bytes=10-20'), { unsatisfiable: true }, 'start beyond size');
t.eq(R('bytes=-0'), { unsatisfiable: true }, 'zero suffix');
t.eq(R('bytes=abc'), null, 'malformed range ignored');
t.eq(R('bytes=5-3'), { unsatisfiable: true }, 'reversed');
t.eq(R('bytes=4-4'), { start: 4, end: 4 }, 'exact chunk boundary');
t.eq(R('bytes=0-1, 4-5'), { start: 0, end: 1 }, 'multi range takes first');
t.eq(R(' bs=0-1'), null, 'non bytes unit ignored');
t.eq(R(''), null, 'empty header');
t.eq(R('bytes=0-', 0), { unsatisfiable: true }, 'empty file is unsatisfiable');
t.eq(R(' bytes = 2 - 3 '), { start: 2, end: 3 }, 'tolerates whitespace');

t.eq(sliceParts(0, 9, CS), [
  { idx: 0, start: 0, end: 3, offset: 0, length: 4 },
  { idx: 1, start: 4, end: 7, offset: 0, length: 4 },
  { idx: 2, start: 8, end: 9, offset: 0, length: 2 },
], 'full file slices');
t.eq(sliceParts(0, 0, CS), [{ idx: 0, start: 0, end: 0, offset: 0, length: 1 }], 'first byte');
t.eq(sliceParts(3, 4, CS), [
  { idx: 0, start: 3, end: 3, offset: 3, length: 1 },
  { idx: 1, start: 4, end: 4, offset: 0, length: 1 },
], 'crosses one boundary');
t.eq(sliceParts(4, 7, CS), [{ idx: 1, start: 4, end: 7, offset: 0, length: 4 }], 'exact middle part');
t.eq(sliceParts(8, 9, CS), [{ idx: 2, start: 8, end: 9, offset: 0, length: 2 }], 'incomplete last part');
t.eq(sliceParts(0, 9, 16), [{ idx: 0, start: 0, end: 9, offset: 0, length: 10 }], 'single part file');
t.eq(sliceParts(0, 2, 1), [
  { idx: 0, start: 0, end: 0, offset: 0, length: 1 },
  { idx: 1, start: 1, end: 1, offset: 0, length: 1 },
  { idx: 2, start: 2, end: 2, offset: 0, length: 1 },
], 'one byte per part');

t.eq(partBounds({ idx: 2, size: 2 }, CS), { start: 8, end: 9, size: 2 }, 'last part bounds');
t.eq(partBounds({ idx: 1, size: 4 }, CS), { start: 4, end: 7, size: 4 }, 'middle part bounds');
t.eq(missingParts([{ idx: 0 }, { idx: 2 }], 3), [1], 'detect hole');
t.eq(missingParts([], 2), [0, 1], 'all missing');
t.eq(missingParts([{ idx: 0 }, { idx: 1 }], 2), [], 'complete');

t.done();
