// Cron：消费待删除的 Telegram 消息，并清理过期的上传会话。
// 单次最多 40 条消息 + 20 个会话，控制在免费版 50 子请求以内。

import { deleteChannelMessage } from './telegram.js';
import { dropPendingDeletes, expireUploads, listPendingDeletes } from './db/parts.js';
import { cleanThrottle } from './db/throttle.js';

export async function runCleanup(env, now = Date.now()) {
  const ids = await listPendingDeletes(env, 40);
  let deleted = 0;
  for (const messageId of ids) {
    if (await deleteChannelMessage(env, messageId)) deleted += 1;
  }
  // Bot API 删除消息有时间和权限限制，删不掉的也出队，接受少量残留
  await dropPendingDeletes(env, ids);

  const expired = await expireUploads(env, now, 20);
  // 登录失败记录只留一天，省得表无限增长
  const throttles = await cleanThrottle(env, now);
  return { queued: ids.length, deleted, expired, throttles };
}
