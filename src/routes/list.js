import { json } from '../utils.js';
import { listDir, getAllDirs } from '../db/dirs.js';

// 目录内容（path 由调用方规范化后传入）
export async function handleList(env, path) {
  const data = await listDir(env, path);
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// 目录树：供移动/复制弹窗列目标目录
export async function handleTree(env) {
  return json(await getAllDirs(env));
}
