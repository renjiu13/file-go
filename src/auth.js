// 单账号登录：PBKDF2 校验口令，HMAC 签名会话 Cookie（无服务端会话表）。
//
// 约定：
//   - 只有同时配置了 PASSWORD_HASH 与 SESSION_SECRET 才算“启用了登录”；
//     没配就是完全敞开，与需求一致（本仓库默认是公开文件列表）。
//   - 读默认公开（页面、列表、下载），写操作（上传/改名/删除/移动/复制）
//     必须带有效会话与 CSRF 头；REQUIRE_LOGIN_FOR_READ=1 时读也要求登录。
//   - 口令只在 POST /api/login 里算一次 PBKDF2，其余请求只做 HMAC 校验。

import { genShortId } from './utils.js';

const enc = new TextEncoder();
const SESSION_COOKIE = 'fg_session';
const SESSION_VERSION = 'v1';
const DEFAULT_TTL_HOURS = 168;
const DEFAULT_ITERATIONS = 100000;

export function authEnabled(env) {
  return !!(env && env.PASSWORD_HASH && env.SESSION_SECRET);
}

export function readLocked(env) {
  return String((env && env.REQUIRE_LOGIN_FOR_READ) || '') === '1';
}

export function sessionTtlMs(env) {
  const hours = Number(env && env.SESSION_TTL_HOURS);
  const safe = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS;
  return safe * 3600 * 1000;
}

export function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parsePasswordHash(value) {
  const parts = String(value || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 1000000) return null;
  let salt;
  let hash;
  try {
    salt = fromBase64Url(parts[2]);
    hash = fromBase64Url(parts[3]);
  } catch (_err) {
    return null;
  }
  if (!salt.length || hash.length < 16) return null;
  return { iterations, salt, hash };
}

async function pbkdf2(password, salt, iterations, length) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password == null ? '' : password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// 定长比较：长度不同也要跑完整轮，避免用耗时泄露信息
export function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

// 生成 `pbkdf2-sha256$<iterations>$<salt>$<hash>`，供 scripts/hash-password.mjs 与测试使用
export async function hashPassword(password, iterations) {
  const rounds = Number.isInteger(iterations) && iterations > 0 ? iterations : DEFAULT_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, rounds, 32);
  return ['pbkdf2-sha256', rounds, toBase64Url(salt), toBase64Url(bits)].join('$');
}

export async function verifyPassword(env, password) {
  const parsed = parsePasswordHash(env && env.PASSWORD_HASH);
  if (!parsed) return false;
  const bits = await pbkdf2(password, parsed.salt, parsed.iterations, parsed.hash.length);
  return timingSafeEqual(bits, parsed.hash);
}

// 签名密钥同时混入口令哈希：改密码即让所有旧会话失效
async function sessionKey(env) {
  const material = 'file-go-session|' + SESSION_VERSION + '|' +
    String(env.SESSION_SECRET || '') + '|' + String(env.PASSWORD_HASH || '');
  return crypto.subtle.importKey('raw', enc.encode(material), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function issueSession(env, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const payload = [SESSION_VERSION, t + sessionTtlMs(env), genShortId(12)].join('.');
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(env), enc.encode(payload));
  return payload + '.' + toBase64Url(new Uint8Array(sig));
}

export async function verifySession(env, token, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  if (!token) return { ok: false };
  const parts = String(token).split('.');
  if (parts.length !== 4 || parts[0] !== SESSION_VERSION) return { ok: false };
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= t) return { ok: false };
  let sig;
  try {
    sig = fromBase64Url(parts[3]);
  } catch (_err) {
    return { ok: false };
  }
  const payload = parts.slice(0, 3).join('.');
  const ok = await crypto.subtle.verify('HMAC', await sessionKey(env), sig, enc.encode(payload));
  return ok ? { ok: true, exp } : { ok: false };
}

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch (_err) {
      return part.slice(i + 1).trim();
    }
  }
  return null;
}

export function readSessionToken(request) {
  return readCookie(request, SESSION_COOKIE);
}

export function isSecureRequest(request) {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

export function sessionCookie(env, token, secure) {
  const maxAge = Math.floor(sessionTtlMs(env) / 1000);
  return SESSION_COOKIE + '=' + encodeURIComponent(token) +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}

export function clearSessionCookie(secure) {
  return SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
}

// 未启用登录时一律视为已授权（公开模式）
export async function currentSession(env, request) {
  if (!authEnabled(env)) return { ok: true, open: true };
  return verifySession(env, readSessionToken(request));
}

export function isWriteMethod(method) {
  return !(method === 'GET' || method === 'HEAD' || method === 'OPTIONS');
}

// 写操作要求显式 CSRF 头；带 Origin 时必须同源（挡住跨站表单）
export function checkCsrf(request, url) {
  if (request.headers.get('X-File-Go-Csrf') !== '1') return false;
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return false;
  return true;
}

export function clientKey(request) {
  const direct = request.headers.get('CF-Connecting-IP');
  if (direct) return direct.trim();
  const forwarded = request.headers.get('X-Forwarded-For') || '';
  const first = forwarded.split(',')[0].trim();
  return first || 'unknown';
}

// 只允许站内相对路径，避免登录后被带去外站
export function safeNext(next) {
  const s = String(next || '');
  if (!s.startsWith('/') || s.startsWith('//')) return '/';
  if (s.includes('\\') || s.includes('\n') || s.includes('\r')) return '/';
  return s;
}

export const LOGIN_PATH = '/login';
