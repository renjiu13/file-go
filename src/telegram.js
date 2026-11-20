// Telegram Bot API 基础地址
const TG_API = 'https://api.telegram.org';

// 调用 Bot API（JSON 方式）
export async function tgCall(env, method, body) {
  const res = await fetch(`${TG_API}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method} 失败: ${data.description}`);
  }
  return data.result;
}

// 发送文本消息
export function sendText(env, chatId, text) {
  return tgCall(env, 'sendMessage', { chat_id: chatId, text });
}

// 通过 file_id 转发文件到私有频道
// fileType: document | video | audio | voice | animation | photo
export async function copyFileIdToChannel(env, fileId, fileType) {
  const methodMap = {
    document: 'sendDocument',
    video: 'sendVideo',
    audio: 'sendAudio',
    voice: 'sendVoice',
    animation: 'sendAnimation',
    photo: 'sendPhoto',
  };
  const method = methodMap[fileType] || 'sendDocument';
  const body = { chat_id: env.CHAT_ID };
  body[fileType] = fileId;
  const msg = await tgCall(env, method, body);
  return extractFileId(msg, fileType);
}

// 从消息对象中提取 file_id
function extractFileId(msg, fileType) {
  if (fileType === 'photo') {
    if (msg.photo && msg.photo.length) {
      return msg.photo[msg.photo.length - 1].file_id;
    }
  }
  if (msg[fileType] && msg[fileType].file_id) {
    return msg[fileType].file_id;
  }
  // 兜底：按常见字段查找
  if (msg.document) return msg.document.file_id;
  if (msg.video) return msg.video.file_id;
  if (msg.audio) return msg.audio.file_id;
  if (msg.voice) return msg.voice.file_id;
  if (msg.animation) return msg.animation.file_id;
  if (msg.sticker) return msg.sticker.file_id;
  return null;
}

// 上传文件到私有频道（multipart 方式，用于网页上传）
export async function uploadFileToChannel(env, file) {
  const form = new FormData();
  form.append('chat_id', env.CHAT_ID);
  form.append('document', file, file.name);

  const res = await fetch(`${TG_API}/bot${env.BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram sendDocument 失败: ${data.description}`);
  }
  return data.result.document.file_id;
}

// 获取文件在 Telegram 服务器上的路径（有效期约 1 小时）
export async function getFilePath(env, fileId) {
  const result = await tgCall(env, 'getFile', { file_id: fileId });
  return result.file_path;
}

// 构造文件下载 URL
export function fileDownloadUrl(env, filePath) {
  return `${TG_API}/file/bot${env.BOT_TOKEN}/${filePath}`;
}
