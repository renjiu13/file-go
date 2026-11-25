// Telegram Bot API 的最小封装：只保留本项目需要的四个动作。
// Bot Token 只在这个文件里拼进请求，永远不会出现在响应或重定向中。

const TG_API = 'https://api.telegram.org';

async function tgCall(env, method, body) {
  const res = await fetch(`${TG_API}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(`Telegram ${method} 失败: ${data.description || res.status}`);
    err.telegramStatus = data.error_code || res.status;
    if (data.parameters && data.parameters.retry_after) err.retryAfter = data.parameters.retry_after;
    throw err;
  }
  return data.result;
}

export async function sendText(env, text, extra) {
  return tgCall(env, 'sendMessage', Object.assign({ chat_id: env.CHAT_ID, text }, extra || {}));
}

export async function deleteChannelMessage(env, messageId) {
  try {
    await tgCall(env, 'deleteMessage', { chat_id: env.CHAT_ID, message_id: messageId });
    return true;
  } catch {
    return false;
  }
}

export async function getFilePath(env, fileId) {
  const result = await tgCall(env, 'getFile', { file_id: fileId });
  if (!result || !result.file_path) throw new Error('Telegram getFile 未返回 file_path');
  return result.file_path;
}

export function fileDownloadUrl(env, filePath) {
  return `${TG_API}/file/bot${env.BOT_TOKEN}/${filePath}`;
}

function multipartChunks(env, filename, boundary) {
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
    `${env.CHAT_ID}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="document"; filename="${escapeFilename(filename)}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const enc = new TextEncoder();
  return { headBytes: enc.encode(head), tailBytes: enc.encode(tail) };
}

// 把请求体流式拼进 multipart，直接交给 Telegram。
// 关键点：不 arrayBuffer()，分片 16 MiB 不占 Worker 内存；Content-Length 由调用方算好。
export async function uploadPartToChannel(env, stream, size, filename, boundary) {
  const { headBytes, tailBytes } = multipartChunks(env, filename, boundary);
  const reader = stream.getReader();

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(headBytes);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(tailBytes);
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const init = {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(size),
    },
    body,
  };
  // Node 的 fetch（测试环境）要求流式请求体声明 duplex，Workers 会忽略这个字段。
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    init.duplex = 'half';
  }

  const res = await fetch(`${TG_API}/bot${env.BOT_TOKEN}/sendDocument`, init);
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) {
    const err = new Error(`Telegram sendDocument 失败: ${data ? data.description : res.status}`);
    err.telegramStatus = (data && data.error_code) || res.status;
    if (data && data.parameters && data.parameters.retry_after) err.retryAfter = data.parameters.retry_after;
    throw err;
  }
  const doc = data.result.document || data.result.video || data.result.audio || {};
  return { fileId: doc.file_id, messageId: data.result.message_id };
}

export function escapeFilename(name) {
  return String(name || 'part.bin').replace(/["\\\r\n]/g, '_').slice(0, 200);
}

// 计算流式 multipart 的 Content-Length：
// 头部和尾部是固定字节数，加上原始字节数即可。
export function multipartLength(env, size, filename, boundary) {
  const { headBytes, tailBytes } = multipartChunks(env, filename, boundary);
  return headBytes.length + size + tailBytes.length;
}

// 下载分片的一段。失效时清缓存重试一次由调用方负责。
export async function downloadRange(env, filePath, start, end) {
  return fetch(fileDownloadUrl(env, filePath), {
    headers: { Range: `bytes=${start}-${end}` },
  });
}
