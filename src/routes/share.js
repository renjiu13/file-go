// 公开分享：把文件挂一个随机 token，/i/<token> 直接可访问（任意类型）。
//
// 语义（按需求确认）：
//   - token 挂在节点上，删除进回收站期间查不到 → 404；
//   - 恢复后 token 仍在，同一链接自动复活；
//   - 取消分享只清 token，文件本身不动。
import { genShortId, json } from '../utils.js';
import { getNode, getNodeByShareToken, clearShareToken, setShareToken, isUniqueError } from '../db/nodes.js';
import { serveNode } from './file.js';
import { NO_STORE } from './common.js';

export const SHARE_CACHE = 'public, max-age=31536000, immutable';

function shareOf(node) {
  return {
    id: node.id,
    name: node.name,
    shareToken: node.shareToken || null,
    url: node.shareToken ? '/i/' + node.shareToken : null,
  };
}

async function liveFile(env, id) {
  const node = await getNode(env, id);
  if (!node || node.kind !== 'file' || node.deletedAt) return null;
  return node;
}

// POST /api/share { id }：没有 token 就生成一个，已有就原样返回（幂等）
export async function handleShareCreate(env, request) {
  let body = null;
  try {
    body = await request.json();
  } catch (_err) {
    return json({ error: '请求格式错误' }, 400, NO_STORE);
  }
  const id = body && body.id;
  if (!id) return json({ error: '缺少文件 id' }, 400, NO_STORE);
  const node = await liveFile(env, id);
  if (!node) return json({ error: '文件不存在' }, 404, NO_STORE);
  if (node.status !== 'ready') return json({ error: '文件尚未上传完成' }, 409, NO_STORE);
  if (node.shareToken) return json({ ok: true, ...shareOf(node) }, 200, NO_STORE);

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = genShortId(16);
    try {
      await setShareToken(env, node.id, token);
    } catch (err) {
      if (isUniqueError(err)) continue;
      throw err;
    }
    return json({ ok: true, id: node.id, name: node.name, shareToken: token, url: '/i/' + token }, 200, NO_STORE);
  }
  return json({ error: '生成分享链接失败，请重试' }, 500, NO_STORE);
}

// DELETE /api/share { id }
export async function handleShareDelete(env, request) {
  let body = null;
  try {
    body = await request.json();
  } catch (_err) {
    return json({ error: '请求格式错误' }, 400, NO_STORE);
  }
  const id = body && body.id;
  if (!id) return json({ error: '缺少文件 id' }, 400, NO_STORE);
  const node = await getNode(env, id);
  if (!node || node.kind !== 'file') return json({ error: '文件不存在' }, 404, NO_STORE);
  await clearShareToken(env, node.id);
  return json({ ok: true, id: node.id, shareToken: null, url: null }, 200, NO_STORE);
}

// GET /api/share?id=xxx：查询当前状态（列表里已带 shareToken，这里给外部脚本用）
export async function handleShareStatus(env, url) {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: '缺少文件 id' }, 400, NO_STORE);
  const node = await liveFile(env, id);
  if (!node) return json({ error: '文件不存在' }, 404, NO_STORE);
  return json({ ok: true, ...shareOf(node) }, 200, NO_STORE);
}

// GET/HEAD /i/<token>：公开下载，缓存一年的强缓存，Range 与 /file/:id 一致
export async function handleShare(env, token, request, url) {
  const node = await getNodeByShareToken(env, token);
  if (!node) return json({ error: '链接不存在或已失效' }, 404, NO_STORE);
  return serveNode(env, node, request, url, { cacheControl: SHARE_CACHE });
}
