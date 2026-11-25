// 浏览器端命名规则：与 src/utils.js 的校验/清理逻辑保持一致。
// 本文件以函数源码的形式内联进页面，所以所有依赖都必须写在函数体内部。
export function namingModule(FG) {
  const ILLEGAL_RE = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
  const ILLEGAL_RE_G = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
  const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  const NAME_MAX = 100;

  function isValidName(name) {
    if (!name) return false;
    if (name !== name.trim()) return false;
    if (name === '.' || name === '..') return false;
    if (/[. ]$/.test(name)) return false;
    if (ILLEGAL_RE.test(name)) return false;
    if (RESERVED_RE.test(name)) return false;
    if (name.length > NAME_MAX) return false;
    return true;
  }

  function nameError(name) {
    if (!name || !name.trim()) return '名称不能为空';
    if (name !== name.trim()) return '名称首尾不能有空格';
    if (name === '.' || name === '..') return '名称不能是 . 或 ..';
    if (/[. ]$/.test(name)) return '名称不能以点或空格结尾';
    if (ILLEGAL_RE.test(name)) return '名称不能包含 < > : " / \\ | ? * 等字符';
    if (RESERVED_RE.test(name)) return '名称是 Windows 保留名，请换一个';
    if (name.length > NAME_MAX) return '名称不能超过 ' + NAME_MAX + ' 个字符';
    return '';
  }

  function sanitizeName(name) {
    let out = String(name || '').replace(ILLEGAL_RE_G, '_').replace(/[. ]+$/, '').trim();
    if (!out) out = 'file';
    if (RESERVED_RE.test(out)) out = '_' + out;
    if (out.length > NAME_MAX) {
      const dot = out.lastIndexOf('.');
      const ext = dot > 0 && out.length - dot <= 12 ? out.slice(dot) : '';
      out = out.slice(0, NAME_MAX - ext.length).replace(/[. ]+$/, '') + ext;
    }
    return out;
  }

  function buildCandidate(name, n) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return name + ' (' + n + ')';
    return name.slice(0, dot) + ' (' + n + ')' + name.slice(dot);
  }

  // 在当前目录的已知条目里找一个不冲突的名字（仅用于界面预判，最终以服务端为准）
  function uniqueLocal(name, names) {
    const lower = new Set((names || []).map((x) => String(x).toLowerCase()));
    if (!lower.has(name.toLowerCase())) return name;
    for (let i = 1; i < 1000; i++) {
      const c = buildCandidate(name, i);
      if (!lower.has(c.toLowerCase())) return c;
    }
    return name;
  }

  FG.naming = {
    ILLEGAL_RE,
    RESERVED_RE,
    NAME_MAX,
    isValidName,
    nameError,
    sanitizeName,
    buildCandidate,
    uniqueLocal,
  };
}
