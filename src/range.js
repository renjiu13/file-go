// Range → 分片映射。纯函数，方便直接跑边界用例。
//
// 分片大小由文件记录（nodes.chunk_size）决定，只有最后一片可能更小。

// 免费版每次调用 50 个子请求，留 8 个余量给 getFile/重试等。
export const MAX_SUBREQUESTS_PER_RESPONSE = 42;

// 解析 Range 头。返回 {start, end}、{unsatisfiable:true} 或 null（忽略，按整段处理）。
// 只支持单段；多段 Range 取第一段（播放器和浏览器都只用单段）。
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(.+)$/i.exec(String(header));
  if (!m) return null;
  const first = m[1].split(',')[0].trim();
  if (!first) return null;

  let start;
  let end;
  const dash = first.indexOf('-');
  if (dash < 0) return null;
  const left = first.slice(0, dash).trim();
  const right = first.slice(dash + 1).trim();

  if (left === '') {
    // bytes=-n：最后 n 个字节
    const n = Number(right);
    if (!Number.isFinite(n) || n <= 0) return { unsatisfiable: true };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(left);
    if (!Number.isFinite(start) || start < 0) return { unsatisfiable: true };
    if (right === '') {
      end = size - 1;
    } else {
      end = Number(right);
      if (!Number.isFinite(end) || end < start) return { unsatisfiable: true };
      end = Math.min(end, size - 1);
    }
    if (start >= size) return { unsatisfiable: true };
  }
  return { start, end };
}

// 把 [start, end]（闭区间，绝对字节）切成需要拉取的分片区间。
// 返回 [{ idx, start, end, offset, length }]，offset 是分片内部的起始偏移。
export function sliceParts(start, end, chunkSize) {
  if (!chunkSize || chunkSize <= 0 || end < start) return [];
  const out = [];
  const firstIdx = Math.floor(start / chunkSize);
  const lastIdx = Math.floor(end / chunkSize);
  for (let idx = firstIdx; idx <= lastIdx; idx++) {
    const partStart = idx * chunkSize;
    const s = Math.max(start, partStart);
    const e = Math.min(end, partStart + chunkSize - 1);
    out.push({ idx, start: s, end: e, offset: s - partStart, length: e - s + 1 });
  }
  return out;
}

// 分片的绝对区间（最后一片用实际大小截断）
export function partBounds(part, chunkSize) {
  const start = part.idx * chunkSize;
  return { start, end: start + part.size - 1, size: part.size };
}

// 缺失分片导致的空洞检测：用来在转发前确认元数据完整。
export function missingParts(parts, chunkCount) {
  const seen = new Set(parts.map((p) => p.idx));
  const missing = [];
  for (let i = 0; i < chunkCount; i++) if (!seen.has(i)) missing.push(i);
  return missing;
}
