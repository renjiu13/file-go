// 生成 PASSWORD_HASH：node scripts/hash-password.mjs "你的密码"
// 输出形如 pbkdf2-sha256$100000$<salt>$<hash>，贴进 wrangler secret 即可。
// 顺手生成 SESSION_SECRET（未提供第二个参数时）。

import { hashPassword, toBase64Url } from '../src/auth.js';

const password = process.argv[2];
if (!password) {
  console.error('用法: node scripts/hash-password.mjs <密码> [迭代次数]');
  process.exit(1);
}

const iterations = Number(process.argv[3]) || 100000;
const hash = await hashPassword(password, iterations);
const secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

console.log('PASSWORD_HASH=' + hash);
console.log('SESSION_SECRET=' + secret);
console.log('');
console.log('写入方式（二选一）：');
console.log('  npx wrangler secret put PASSWORD_HASH');
console.log('  npx wrangler secret put SESSION_SECRET');
console.log('或本地 .dev.vars：');
console.log('  PASSWORD_HASH=' + hash);
console.log('  SESSION_SECRET=' + secret);
