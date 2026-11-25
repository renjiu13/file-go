// 文件大小上限：20MB（受 Telegram Bot API getFile 限制）
export const MAX_SIZE = 20 * 1024 * 1024;

// 默认分片大小：16 MiB。低于 getFile 的 20MB 下载上限（留余量），远低于 50MB 上传上限。
// 实际分片大小随文件记录持久化，代码里不假设它固定。
export const DEFAULT_CHUNK_SIZE = 16 * 1024 * 1024;

// 短 ID 长度：16 位 base62，足够避免碰撞；旧的 10 位 ID 仍可访问
export const ID_LENGTH = 16;

// 返回 JSON 响应
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers),
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

// 规范化路径：去除首尾斜杠、折叠重复斜杠、解析 . 和 ..
export function normalizePath(p = '') {
  const parts = String(p).split('/');
  const out = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

// 获取父目录路径；根目录返回 null
export function parentOf(p = '') {
  if (p === '') return null;
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

// 获取路径最后一段
export function basename(p = '') {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

// 拼接路径
export function joinPath(parent, name) {
  if (parent === '') return name;
  return parent + '/' + name;
}

// Windows 名称禁止的字符与控制字符（拆成两份是因为带 /g 的 test 有 lastIndex 状态）
const ILLEGAL_RE = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
const ILLEGAL_RE_G = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
// 保留设备名，不区分大小写，CON.txt 这类带扩展名的形式同样被 Windows 拒绝
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const NAME_MAX = 100;

// 校验名称是否合法（用于目录名与重命名）
export function isValidName(name = '') {
  if (!name) return false;
  if (name !== name.trim()) return false;
  if (name === '.' || name === '..') return false;
  // Windows 会静默去掉结尾的点和空格，直接拒绝比静默改写更清楚
  if (/[. ]$/.test(name)) return false;
  if (ILLEGAL_RE.test(name)) return false;
  if (RESERVED_RE.test(name)) return false;
  if (name.length > NAME_MAX) return false;
  return true;
}

// 校验名称并返回拒绝原因，用于给用户可直接阅读的提示
export function nameError(name) {
  if (!name || !name.trim()) return '名称不能为空';
  if (name !== name.trim()) return '名称首尾不能有空格';
  if (name === '.' || name === '..') return '名称不能是 . 或 ..';
  if (/[. ]$/.test(name)) return '名称不能以点或空格结尾';
  if (ILLEGAL_RE.test(name)) return '名称不能包含 < > : " / \\ | ? * 等字符';
  if (RESERVED_RE.test(name)) return '名称是 Windows 保留名，请换一个';
  if (name.length > NAME_MAX) return `名称不能超过 ${NAME_MAX} 个字符`;
  return '';
}

// 上传文件名来自用户本地磁盘，可能带非 Windows 字符；用下划线替换而不是拒绝，
// 保证存进来的名字在任何系统下都能正常落地，也不会因删除字符而撞名。
export function sanitizeName(name = '') {
  let out = String(name).replace(ILLEGAL_RE_G, '_').replace(/[. ]+$/, '').trim();
  if (!out) out = 'file';
  if (RESERVED_RE.test(out)) out = '_' + out;
  if (out.length > NAME_MAX) {
    const dot = out.lastIndexOf('.');
    const ext = dot > 0 && out.length - dot <= 12 ? out.slice(dot) : '';
    out = out.slice(0, NAME_MAX - ext.length).replace(/[. ]+$/, '') + ext;
  }
  return out;
}
