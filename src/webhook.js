import { MAX_SIZE, guessMime, normalizePath } from './utils.js';
import { sendText, copyFileIdToChannel } from './telegram.js';
import { newShortId, saveFile, checkIdempotent, ensureDir } from './kv.js';

// 从消息中提取媒体信息，统一结构
function pickMedia(msg) {
  if (msg.document) {
    return {
      type: 'document',
      file_id: msg.document.file_id,
      file_size: msg.document.file_size,
      file_name: msg.document.file_name,
      mime_type: msg.document.mime_type,
    };
  }
  if (msg.video) {
    return {
      type: 'video',
      file_id: msg.video.file_id,
      file_size: msg.video.file_size,
      file_name: msg.video.file_name || `video-${Date.now()}.mp4`,
      mime_type: msg.video.mime_type,
    };
  }
  if (msg.audio) {
    return {
      type: 'audio',
      file_id: msg.audio.file_id,
      file_size: msg.audio.file_size,
      file_name: msg.audio.file_name || `audio-${Date.now()}.mp3`,
      mime_type: msg.audio.mime_type,
    };
  }
  if (msg.voice) {
    return {
      type: 'voice',
      file_id: msg.voice.file_id,
      file_size: msg.voice.file_size,
      file_name: `voice-${Date.now()}.ogg`,
      mime_type: msg.voice.mime_type || 'audio/ogg',
    };
  }
  if (msg.animation) {
    return {
      type: 'animation',
      file_id: msg.animation.file_id,
      file_size: msg.animation.file_size,
      file_name: msg.animation.file_name || `animation-${Date.now()}.mp4`,
      mime_type: msg.animation.mime_type,
    };
  }
  if (msg.photo && msg.photo.length) {
    // 取数组最后一项（最大尺寸）
    const largest = msg.photo[msg.photo.length - 1];
    return {
      type: 'photo',
      file_id: largest.file_id,
      file_size: largest.file_size,
      file_name: `photo-${Date.now()}.jpg`,
      mime_type: 'image/jpeg',
    };
  }
  return null;
}

// 处理 Telegram Webhook
export async function handleWebhook(request, env) {
  // 校验 Webhook 密钥（可选，建议配置）
  if (env.WEBHOOK_SECRET) {
    const token = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (token !== env.WEBHOOK_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // 解析请求体
  let update;
  try {
    update = await request.json();
  } catch (err) {
    return new Response('Bad Request', { status: 400 });
  }

  // 幂等性检查：同一 update_id 只处理一次
  if (update.update_id) {
    const isNew = await checkIdempotent(env, update.update_id);
    if (!isNew) {
      return new Response('ok');
    }
  }

  // 获取消息对象（支持普通消息和频道消息）
  const msg = update.message || update.channel_post;
  if (!msg) {
    return new Response('ok');
  }

  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';

  // 提取媒体
  const media = pickMedia(msg);

  // 非媒体消息
  if (!media) {
    // 私聊时回复提示
    if (isPrivate && msg.text) {
      await sendText(env, chatId, '请直接发送文件（文档、图片、视频、音频等）。');
    }
    return new Response('ok');
  }

  // 大小校验
  if (media.file_size && media.file_size > MAX_SIZE) {
    if (isPrivate) {
      await sendText(env, chatId, '文件超过 20MB，无法通过 Bot API 生成下载链接。');
    }
    return new Response('ok');
  }

  // 目标目录：caption 可指定目录路径（如 "images" 或 "images/2024"）
  const caption = (msg.caption || '').trim();
  const path = normalizePath(caption);

  try {
    // 转发到私有频道（使用 file_id 复制，不重新上传）
    const result = await copyFileIdToChannel(env, media.file_id, media.type);

    // 确保目标目录及其父目录存在
    await ensureDir(env, path);

    // 生成短 ID 并保存元信息
    const id = await newShortId(env);
    const name = media.file_name || `file-${id}`;

    await saveFile(env, {
      id,
      fileId: result.fileId,
      messageId: result.messageId,
      name,
      size: media.file_size || 0,
      mime: media.mime_type || guessMime(name),
      path,
      createdAt: Date.now(),
    });

    // 私聊回复下载链接
    if (isPrivate) {
      const origin = new URL(request.url).origin;
      const dirText = path ? `\n目录：${path}` : '';
      await sendText(env, chatId, `上传成功：${origin}/file/${id}${dirText}`);
    }
  } catch (err) {
    console.error('Webhook 处理失败:', err);
    if (isPrivate) {
      await sendText(env, chatId, '保存失败，请稍后重试。');
    }
  }

  return new Response('ok');
}
