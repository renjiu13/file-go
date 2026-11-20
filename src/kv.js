import { genShortId, ID_LENGTH, INDEX_LIMIT } from './utils.js';

// 生成不重复的短 ID
export async function newShortId(env) {
  // 尝试生成不重复的 ID，最多尝试 10 次
  for (let i = 0; i < 10; i++) {
    const id = genShortId(ID_LENGTH);
    const exists = await env.FILE_KV.get(`f:${id}`);
    if (!exists) return id;
  }
  // 极端碰撞时用更长的 ID
  return genShortId(ID_LENGTH + 4);
}

// 保存文件元信息并更新公开索引
export async function saveFile(env, meta) {
  // 写入文件元信息
  await env.FILE_KV.put(`f:${meta.id}`, JSON.stringify(meta));

  // 更新索引
  const raw = await env.FILE_KV.get('index');
  const index = raw ? JSON.parse(raw) : [];
  index.unshift({
    id: meta.id,
    name: meta.name,
    size: meta.size,
    mime: meta.mime,
    createdAt: meta.createdAt,
  });
  // 只保留最近 N 条
  await env.FILE_KV.put('index', JSON.stringify(index.slice(0, INDEX_LIMIT)));
}

// 获取文件元信息
export async function getFileMeta(env, id) {
  const raw = await env.FILE_KV.get(`f:${id}`);
  return raw ? JSON.parse(raw) : null;
}

// 获取公开索引（返回原始 JSON 字符串）
export async function getIndex(env) {
  const raw = await env.FILE_KV.get('index');
  return raw || '[]';
}

// 幂等性检查：根据 update_id 判断是否已处理过
// 返回 true 表示是新请求，false 表示重复请求
export async function checkIdempotent(env, updateId) {
  const key = `idem:${updateId}`;
  const exists = await env.FILE_KV.get(key);
  if (exists) return false;
  // 设置 24 小时过期的幂等标记
  await env.FILE_KV.put(key, '1', { expirationTtl: 86400 });
  return true;
}
