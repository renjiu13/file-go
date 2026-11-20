import { MAX_SIZE, guessMime, json } from './utils.js';
import { uploadFileToChannel } from './telegram.js';
import { newShortId, saveFile } from './kv.js';

// 处理网页上传
export async function handleUpload(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return json({ error: '无效的表单数据' }, 400);
  }

  const file = form.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return json({ error: '未收到有效文件' }, 400);
  }

  if (file.size > MAX_SIZE) {
    return json({ error: '文件不能超过 20MB' }, 413);
  }

  let channelFileId;
  try {
    channelFileId = await uploadFileToChannel(env, file);
  } catch (err) {
    console.error('上传到 Telegram 失败:', err);
    return json({ error: '上传到 Telegram 失败' }, 502);
  }

  const id = await newShortId(env);
  const meta = {
    id,
    fileId: channelFileId,
    name: file.name,
    size: file.size,
    mime: file.type || guessMime(file.name),
    createdAt: Date.now(),
  };

  await saveFile(env, meta);

  const origin = new URL(request.url).origin;
  return json({
    url: `${origin}/file/${id}`,
    id,
    name: file.name,
    size: file.size,
  });
}
