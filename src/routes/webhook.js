// Telegram Bot 入口：文档已经在 Telegram 上，直接建节点，不下载也不重传。
// 受 getFile 20MB 下载限制，Bot 入口单文件上限按 20MB 处理。

import { MAX_SIZE, guessMime, json, normalizePath, sanitizeName } from '../utils.js';
import {
  ensureDirPath,
  insertFileNode,
} from '../db/nodes.js';
import { findClash, uniqueName } from '../db/naming.js';
import { addPart } from '../db/parts.js';
import { sendText } from '../telegram.js';
import { checkIdempotent } from '../db/idem.js';
import { NO_STORE, originOf } from './common.js';

function pickMedia(msg) {
  const direct = ['document', 'video', 'audio', 'voice', 'animation'];
  for (const key of direct) {
    const m = msg[key];
    if (m && m.file_id) {
      const fallback = `${key}-${m.file_unique_id || String(m.file_id).slice(-8)}`;
      return {
        fileId: m.file_id,
        name: m.file_name || fallback,
        mime: m.mime_type || '',
        size: Number(m.file_size) || 0,
        kind: key,
      };
    }
  }
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const p = msg.photo[msg.photo.length - 1];
    return {
      fileId: p.file_id,
      name: `photo-${p.file_unique_id || String(p.file_id).slice(-8)}.jpg`,
      mime: 'image/jpeg',
      size: Number(p.file_size) || 0,
      kind: 'photo',
    };
  }
  return null;
}

const EXT_FALLBACK = {
  photo: '.jpg',
  video: '.mp4',
  animation: '.mp4',
  voice: '.ogg',
  audio: '.mp3',
  document: '',
};

function withExtension(name, kind) {
  if (/\.[A-Za-z0-9]{1,8}$/.test(name)) return name;
  return name + (EXT_FALLBACK[kind] || '');
}

export async function handleWebhook(env, request) {
  const update = await request.json().catch(() => null);
  if (!update) return json({ ok: true }, 200, NO_STORE);

  if (update.update_id !== undefined) {
    const fresh = await checkIdempotent(env, update.update_id);
    if (!fresh) return json({ ok: true, duplicate: true }, 200, NO_STORE);
  }

  const msg = update.message || update.channel_post || update.edited_message;
  if (!msg) return json({ ok: true, ignored: true }, 200, NO_STORE);

  const media = pickMedia(msg);
  if (!media) return json({ ok: true, ignored: 'no media' }, 200, NO_STORE);

  if (media.size > MAX_SIZE) {
    await sendText(
      env,
      `文件超过 20MB（Bot 入口上限），无法直接入库：${media.name}\n` +
      '请打开网页端，在浏览器里分片上传大文件。'
    );
    return json({ ok: true, rejected: 'too large' }, 200, NO_STORE);
  }

  const name = sanitizeName(withExtension(media.name, media.kind));
  const captionPath = normalizePath(msg.caption || '');

  const parentId = captionPath ? await ensureDirPath(env, captionPath) : null;
  const finalName = (await findClash(env, parentId, name))
    ? await uniqueName(env, parentId, name)
    : name;

  const { id } = await insertFileNode(env, {
    parentId,
    name: finalName,
    size: media.size,
    mime: media.mime || guessMime(finalName),
    status: 'ready',
    chunkSize: Math.max(media.size, 1),
    chunkCount: 1,
  });
  await addPart(env, id, 0, media.fileId, null, media.size, null);

  const link = `${originOf(request)}/file/${id}`;
  const where = captionPath ? `目录 /${captionPath}` : '根目录';
  await sendText(env, `已入库：${finalName}\n位置：${where}\n${link}`);

  return json({ ok: true, id, name: finalName, path: captionPath, url: link }, 200, NO_STORE);
}
