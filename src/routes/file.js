// 文件下载：Range → 分片映射，按子请求预算截断，流式转发。
//
// 免费版单次调用只有 50 个子请求。这里在写出响应头之前先把要用的 file_path 全部
// 解析好（命中缓存不计子请求），算出这次最多能覆盖多少个分片；超出部分用 206
// 的 Content-Range 表明只返回了一部分，浏览器会自动接着请求下一段。

import { guessMime, isInlineMime, json } from '../utils.js';
import { getNode } from '../db/nodes.js';
import { getParts } from '../db/parts.js';
import {
  getCachedFilePath,
  invalidateCachedFilePath,
  resolveFilePath,
} from '../path-cache.js';
import { MAX_SUBREQUESTS_PER_RESPONSE, parseRange, sliceParts } from '../range.js';
import { downloadRange } from '../telegram.js';
import { NO_STORE } from './common.js';

function contentDisposition(name, inline) {
  return `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function baseHeaders(node, inline, cacheControl) {
  const type = node.mime || guessMime(node.name);
  return {
    'Content-Type': type,
    'Content-Disposition': contentDisposition(node.name, inline && isInlineMime(type)),
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl || 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  };
}

export async function handleManifest(env, id) {
  const node = await getNode(env, id);
  if (!node || node.kind !== 'file' || node.status !== 'ready' || node.deletedAt) {
    return json({ error: '文件不存在' }, 404, NO_STORE);
  }
  const parts = await getParts(env, id);
  if (parts.length !== node.chunkCount) {
    return json({ error: '分片元数据不完整', parts: parts.length, expected: node.chunkCount }, 500, NO_STORE);
  }
  return json({
    id: node.id,
    name: node.name,
    size: node.size,
    mime: node.mime || guessMime(node.name),
    chunkSize: node.chunkSize,
    chunkCount: node.chunkCount,
    parts: parts.map((p) => ({ idx: p.idx, size: p.size, sha256: p.sha256 })),
  }, 200, NO_STORE);
}

// 按预算挑选本次要转发的分片。cost 里算上 getFile 未命中（2 次子请求）。
async function planSlices(env, slices, parts) {
  const plans = [];
  let cost = 0;
  for (const slice of slices) {
    const part = parts[slice.idx];
    if (!part) break;
    if (cost + 1 > MAX_SUBREQUESTS_PER_RESPONSE) break;
    const resolved = await resolveFilePath(env, part.fileId);
    const add = 1 + (resolved.cached ? 0 : 1);
    if (cost + add > MAX_SUBREQUESTS_PER_RESPONSE && plans.length > 0) break;
    cost += add;
    plans.push({ slice, part, path: resolved.path });
  }
  return plans;
}

async function fetchWithRetry(env, plan) {
  // plan.slice.start/end 是文件内的绝对偏移；Telegram 分片是独立文件，
  // 请求时必须换算成片内偏移。
  const from = plan.slice.offset;
  const to = from + plan.slice.length - 1;
  let res = await downloadRange(env, plan.path, from, to);
  if (res.status === 404 || res.status === 400 || res.status === 410 || res.status === 403) {
    await invalidateCachedFilePath(env, plan.part.fileId);
    const path = await getCachedFilePath(env, plan.part.fileId);
    plan.path = path;
    res = await downloadRange(env, path, from, to);
  }
  if (res.status !== 200 && res.status !== 206) {
    const err = new Error(`Telegram 下载失败: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

// 顺序转发：一个 pull 最多入队一个 chunk，天然背压，整片不会堆进内存。
function buildBody(env, plans) {
  let planIndex = 0;
  let reader = null;
  let remaining = 0;
  let skip = 0;
  let current = null;

  return new ReadableStream({
    async pull(controller) {
      try {
        if (!reader) {
          if (planIndex >= plans.length) {
            controller.close();
            return;
          }
          current = plans[planIndex++];
          const res = await fetchWithRetry(env, current);
          if (!res.body) {
            controller.error(new Error('Telegram 返回空响应'));
            return;
          }
          reader = res.body.getReader();
          remaining = current.slice.length;
          // Telegram 若不支持 Range 会回 200 整片，此时需要丢掉片内前缀
          skip = res.status === 200 ? current.slice.offset : 0;
        }

        const { done, value: chunk } = await reader.read();
        if (done) {
          reader.releaseLock();
          reader = null;
          if (remaining > 0) {
            controller.error(new Error('分片提前结束'));
            return;
          }
          return;
        }

        let value = chunk;
        if (skip > 0) {
          if (value.length <= skip) {
            skip -= value.length;
            return; // 丢弃整块，下一次 pull 继续
          }
          value = value.subarray(skip);
          skip = 0;
        }
        const usable = value.length > remaining ? value.subarray(0, remaining) : value;
        if (usable.length) {
          remaining -= usable.length;
          controller.enqueue(usable);
        }
        if (remaining === 0) {
          const r = reader;
          reader = null;
          r.cancel().catch(() => {});
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      if (reader) {
        try { reader.cancel(reason).catch(() => {}); } catch { /* ignore */ }
        reader = null;
      }
    },
  });
}

export async function handleFile(env, id, request, url) {
  const node = await getNode(env, id);
  if (!node || node.kind !== 'file' || node.status !== 'ready' || node.deletedAt) {
    return json({ error: '文件不存在' }, 404, NO_STORE);
  }
  return serveNode(env, node, request, url, {});
}

// 已经拿到节点的下载实现，/file/:id 与 /i/:share 共用（Range、预算、缓存一套逻辑）
export async function serveNode(env, node, request, url, opts) {
  const options = opts || {};
  const parts = await getParts(env, node.id);
  if (!parts.length) return json({ error: '文件没有分片' }, 404, NO_STORE);

  const size = node.size;
  const chunkSize = node.chunkSize || Math.max(1, size);
  const inline = !url.searchParams.has('download');
  const headers = baseHeaders(node, inline, options.cacheControl);

  if (request.method === 'HEAD') {
    headers['Content-Length'] = String(size);
    return new Response(null, { status: 200, headers });
  }
  if (!size) {
    headers['Content-Length'] = '0';
    return new Response(null, { status: 200, headers });
  }

  const partParam = url.searchParams.get('part');
  let start;
  let end;
  const isPart = partParam !== null;

  if (isPart) {
    const idx = Number(partParam);
    const part = parts.find((p) => p.idx === idx);
    if (!part) return json({ error: '分片不存在' }, 404, NO_STORE);
    start = idx * chunkSize;
    end = start + part.size - 1;
  } else {
    const range = parseRange(request.headers.get('Range'), size);
    if (range && range.unsatisfiable) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    start = range ? range.start : 0;
    end = range ? range.end : size - 1;
  }

  const slices = sliceParts(start, end, chunkSize);
  let plans;
  try {
    plans = await planSlices(env, slices, parts);
  } catch (err) {
    return json({ error: '无法获取文件下载地址', detail: err.message }, 502, NO_STORE);
  }
  if (!plans.length) return json({ error: '不支持的分片布局' }, 416, NO_STORE);

  const truncatedEnd = plans[plans.length - 1].slice.end;
  const partial = truncatedEnd < end;
  const hasRange = request.headers.has('Range');
  const status = isPart ? 200 : (hasRange || partial ? 206 : 200);
  const length = truncatedEnd - start + 1;

  headers['Content-Length'] = String(length);
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${truncatedEnd}/${size}`;

  return new Response(buildBody(env, plans), { status, headers });
}
