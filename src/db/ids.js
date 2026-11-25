import { genShortId } from '../utils.js';

// 生成 16 位 base62 节点 id，极小概率撞上已有 id 时重试。
export async function newShortId(env) {
  for (let i = 0; i < 5; i++) {
    const id = genShortId(16);
    const row = await env.DB.prepare('SELECT id FROM nodes WHERE id = ?').bind(id).first();
    if (!row) return id;
  }
  return genShortId(24);
}
