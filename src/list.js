import { getIndex } from './kv.js';

// 返回公开文件列表 JSON
export async function handleList(env) {
  const body = await getIndex(env);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=30',
    },
  });
}
