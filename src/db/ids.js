import { genShortId, ID_LENGTH } from '../utils.js';

export async function newShortId(env) {
  for (let i = 0; i < 10; i++) {
    const id = genShortId(ID_LENGTH);
    const row = await env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(id).first();
    if (!row) return id;
  }
  return genShortId(ID_LENGTH + 4);
}
