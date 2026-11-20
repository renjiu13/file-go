import { getFileMeta } from './kv.js';
import { getFilePath, fileDownloadUrl } from './telegram.js';
import { isInlineMime } from './utils.js';

// 处理文件下载 / 预览
export async function handleFile(request, env, id) {
  // 从 KV 读取文件元信息
  const meta = await getFileMeta(env, id);
  if (!meta) {
    return new Response('文件不存在', { status: 404 });
  }

  // 从 Telegram 获取文件路径（有效期约 1 小时，每次请求都重新获取）
  let filePath;
  try {
    filePath = await getFilePath(env, meta.fileId);
  } catch (err) {
    console.error('获取文件路径失败:', err);
    return new Response('文件暂时不可用', { status: 502 });
  }

  // 构造上游请求头，透传 Range
  const upstreamHeaders = new Headers();
  const range = request.headers.get('Range');
  if (range) {
    upstreamHeaders.set('Range', range);
  }
  // 透传 If-Range，用于条件 Range 请求
  const ifRange = request.headers.get('If-Range');
  if (ifRange) {
    upstreamHeaders.set('If-Range', ifRange);
  }

  // 请求 Telegram 文件服务器
  const upstream = await fetch(fileDownloadUrl(env, filePath), {
    method: request.method,
    headers: upstreamHeaders,
  });

  // 构造响应头
  const headers = new Headers();

  // 透传关键响应头（保留上游的 Content-Length / Content-Range / Accept-Ranges 等）
  const passHeaders = [
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
    'ETag',
    'Last-Modified',
  ];
  for (const h of passHeaders) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  // 判断是否内联预览
  const url = new URL(request.url);
  const forceDownload = url.searchParams.has('download');
  const inline = !forceDownload && isInlineMime(meta.mime);

  // 设置 Content-Type（使用 KV 中保存的 MIME，更准确）
  headers.set('Content-Type', meta.mime);

  // 设置 Content-Disposition
  // 中文文件名使用 RFC 5987 编码：filename*=UTF-8''encoded_name
  const encodedName = encodeURIComponent(meta.name);
  headers.set(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`
  );

  // 缓存控制
  headers.set('Cache-Control', 'public, max-age=86400');

  // 保留上游状态码（含 206 Partial Content）
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
