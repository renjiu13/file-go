// 回收站列表

import { getTrashList } from '../db/nodes.js';
import { json } from '../utils.js';
import { NO_STORE } from './common.js';

export async function handleTrash(env) {
  return json({ groups: await getTrashList(env) }, 200, NO_STORE);
}
