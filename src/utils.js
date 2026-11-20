// 文件大小上限：20MB（受 Telegram Bot API getFile 限制）
export const MAX_SIZE = 20 * 1024 * 1024;

// 公开索引保留的最大条数
export const INDEX_LIMIT = 200;

// 短 ID 长度
export const ID_LENGTH = 10;

// 返回 JSON 响应
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// MIME 类型映射表
const MIME_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  bz2: 'application/x-bzip2',
  apk: 'application/vnd.android.package-archive',
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv; charset=utf-8',
  srt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
};

// 根据文件名推断 MIME 类型
export function guessMime(name = '') {
  const parts = name.split('.');
  if (parts.length < 2) return 'application/octet-stream';
  const ext = parts.pop().toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

// 判断 MIME 类型是否可在浏览器内联预览
export function isInlineMime(mime) {
  const inlinePattern = /^(image\/|video\/|audio\/|text\/|application\/pdf|application\/json)/;
  return inlinePattern.test(mime);
}

// 生成随机短 ID（字母数字）
export function genShortId(length = ID_LENGTH) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}
