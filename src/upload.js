import { MAX_SIZE, guessMime, json, normalizePath, sanitizeName } from './utils.js';
import { uploadFileToChannel } from './telegram.js';
import { newShortId, saveFile, dirExists, findNameClash, uniqueName } from './kv.js';

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

  // 目标目录（可选，默认为根目录）
  const rawPath = (form.get('path') || '').toString();
  const path = normalizePath(rawPath);
  if (!(await dirExists(env, path))) {
    return json({ error: '目录不存在' }, 400);
  }

  let uploadResult;
  try {
    uploadResult = await uploadFileToChannel(env, file);
  } catch (err) {
    console.error('上传到 Telegram 失败:', err);
    const limited = err.telegramStatus === 429;
    return json(
      { error: limited ? 'Telegram 请求过于频繁，稍后自动重试' : '上传到 Telegram 失败' },
      limited ? 429 : 502
    );
  }

  const id = await newShortId(env);
  // 文件名来自用户本地磁盘：先洗成 Windows 合法名，再按「保留两者」避让同名项
  const name = await uniqueName(env, path, sanitizeName(file.name));
  const meta = {
    id,
    fileId: uploadResult.fileId,
    messageId: uploadResult.messageId,
    name,
    size: file.size,
    mime: file.type || guessMime(name),
    path,
    createdAt: Date.now(),
  };

  await saveFile(env, meta);

  const origin = new URL(request.url).origin;
  return json({
    url: `${origin}/file/${id}`,
    id,
    name,
    size: file.size,
    path,
  });
}
