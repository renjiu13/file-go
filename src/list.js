import { listDir } from './kv.js';

// 返回指定目录的内容 JSON（path 由调用方规范化后传入）
export async function handleList(env, path) {
  const data = await listDir(env, path);
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
