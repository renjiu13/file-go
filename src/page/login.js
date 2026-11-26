// 登录页：独立渲染，不带业务模块（未登录时不执行任何列表/上传代码）。
import { CSS } from './style.js';

const LOGIN_CSS = `
.login-wrap { max-width: 360px; margin: 96px auto; padding: 0 16px; }
.login-card { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 24px; }
.login-card h2 { margin: 0 0 4px; font-size: 16px; color: #111; }
.login-card p.sub { margin: 0 0 18px; font-size: 12px; color: #999; }
.login-card label { display: block; font-size: 12px; color: #666; margin-bottom: 6px; }
.login-card input[type="password"] {
  width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px;
  border: 1px solid #ddd; border-radius: 4px; outline: none;
}
.login-card input[type="password"]:focus { border-color: #4a90d9; }
.login-card button {
  margin-top: 14px; width: 100%; padding: 8px 10px; font-size: 13px;
  background: #4a90d9; border: 1px solid #4a90d9; color: #fff; border-radius: 4px; cursor: pointer;
}
.login-card button:disabled { opacity: .6; cursor: default; }
.login-msg { margin-top: 12px; font-size: 12px; min-height: 16px; color: #c0392b; }
.login-msg.ok { color: #2e7d32; }
.login-foot { margin-top: 16px; text-align: center; font-size: 12px; }
.login-foot a { color: #888; text-decoration: none; }
.login-foot a:hover { text-decoration: underline; }
`;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// opts: { next, configured }
export function renderLogin(opts) {
  const o = opts || {};
  const next = o.next || '/';
  const configured = o.configured !== false;
  const nextJson = JSON.stringify(next).replace(/</g, '\\u003c');

  const body = configured
    ? `<form id="loginForm" autocomplete="off">
        <label for="pw">密码</label>
        <input id="pw" type="password" autocomplete="current-password" autofocus required>
        <button type="submit" id="loginBtn">登录</button>
      </form>
      <div class="login-msg" id="loginMsg"></div>`
    : `<div class="login-msg">未配置登录：请设置 <code>PASSWORD_HASH</code> 与 <code>SESSION_SECRET</code>。</div>
      <div class="login-foot"><a href="/">返回文件列表</a></div>`;

  const script = configured
    ? `<script>
(function () {
  var next = ${nextJson};
  var form = document.getElementById('loginForm');
  var pw = document.getElementById('pw');
  var btn = document.getElementById('loginBtn');
  var msg = document.getElementById('loginMsg');
  function say(text, ok) {
    msg.textContent = text || '';
    msg.className = 'login-msg' + (ok ? ' ok' : '');
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!pw.value) { say('请输入密码'); return; }
    btn.disabled = true;
    say('正在验证…', true);
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-File-Go-Csrf': '1' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: pw.value })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data };
      });
    }).then(function (r) {
      if (r.status === 200 && r.data && r.data.ok) {
        say('登录成功，正在跳转…', true);
        location.href = next;
        return;
      }
      btn.disabled = false;
      pw.value = '';
      pw.focus();
      var wait = r.data && r.data.retryAfter;
      say(wait ? '尝试过于频繁，请 ' + wait + ' 秒后再试' : ((r.data && r.data.error) || '登录失败'));
    }).catch(function () {
      btn.disabled = false;
      say('网络错误，请重试');
    });
  });
})();
</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 · File-Go!</title>
<style>${CSS}${LOGIN_CSS}</style>
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <h2>File-Go!</h2>
    <p class="sub">登录后才能修改文件</p>
    ${body}
    <div class="login-foot"><a href="/">返回文件列表</a></div>
  </div>
</div>
${script}
</body>
</html>`;
}

// 供 /login 之外的地方复用错误页
export function renderInlineNotice(title, text, linkHref, linkText) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}${LOGIN_CSS}</style></head>
<body><div class="login-wrap"><div class="login-card">
<h2>${esc(title)}</h2><p class="sub">${esc(text)}</p>
<div class="login-foot"><a href="${esc(linkHref || '/')}">${esc(linkText || '返回文件列表')}</a></div>
</div></div></body></html>`;
}
