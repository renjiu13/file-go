// 渲染首页：文件仓库列表（文件浏览器）
export function renderPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>File-Go！</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    margin: 0;
    padding: 40px 20px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    color: #111;
    background: #fff;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 720px; margin: 0 auto; }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  h1 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }
  .actions { display: flex; gap: 8px; }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    color: #333;
    transition: background 0.12s, border-color 0.12s;
  }
  .icon-btn:hover { background: #f5f5f5; border-color: #bbb; }
  .icon-btn svg { display: block; }

  .breadcrumb {
    font-size: 13px;
    color: #888;
    margin-bottom: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .breadcrumb a {
    color: #555;
    text-decoration: none;
  }
  .breadcrumb a:hover { text-decoration: underline; color: #111; }
  .breadcrumb .sep { margin: 0 6px; color: #ccc; }

  ul { list-style: none; margin: 0; padding: 0; }
  li { border-bottom: 1px solid #eee; }
  .row {
    display: flex;
    align-items: center;
    padding: 10px 0;
  }
  .ico {
    flex-shrink: 0;
    width: 20px;
    margin-right: 10px;
    display: inline-flex;
    align-items: center;
    color: #999;
  }
  .ico svg { display: block; }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #111;
    text-decoration: none;
  }
  .name:hover { text-decoration: underline; }
  .size, .date {
    color: #888;
    font-size: 13px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .size { width: 80px; text-align: right; margin-left: 16px; }
  .date { width: 140px; text-align: right; margin-left: 16px; }
  .del-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin-left: 8px;
    border: none;
    background: transparent;
    color: #bbb;
    cursor: pointer;
    border-radius: 4px;
    transition: color 0.12s, background 0.12s;
  }
  .del-btn:hover { color: #d33; background: #fdf0f0; }
  .del-btn svg { display: block; }

  .empty {
    color: #aaa;
    text-align: center;
    padding: 48px 0;
    font-size: 14px;
  }
  .status {
    position: fixed;
    left: 50%;
    bottom: 32px;
    transform: translateX(-50%);
    background: #111;
    color: #fff;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    z-index: 10;
  }
  .status.show { opacity: 0.95; }

  @media (max-width: 600px) {
    .date { width: 100px; }
    .size { display: none; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="title-row">
    <h1>File-Go！</h1>
    <div class="actions">
      <button class="icon-btn" id="mkdirBtn" title="新建文件夹" aria-label="新建文件夹">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <path d="M12 11v6M9 14h6"/>
        </svg>
      </button>
      <button class="icon-btn" id="uploadBtn" title="上传文件" aria-label="上传文件">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v12M7 8l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
        </svg>
      </button>
    </div>
  </div>

  <nav class="breadcrumb" id="breadcrumb"></nav>

  <input type="file" id="fileInput" hidden>
  <ul id="list"></ul>
</div>

<div class="status" id="status"></div>

<script>
  var MAX_SIZE = 20 * 1024 * 1024;

  var listEl = document.getElementById('list');
  var breadcrumbEl = document.getElementById('breadcrumb');
  var uploadBtn = document.getElementById('uploadBtn');
  var mkdirBtn = document.getElementById('mkdirBtn');
  var fileInput = document.getElementById('fileInput');
  var statusEl = document.getElementById('status');

  // 从 pathname 解析当前目录路径（根目录为空字符串）
  function currentPathFromLocation() {
    var p = location.pathname.replace(/^\\/+|\\/+$/g, '');
    try { p = decodeURIComponent(p); } catch (e) {}
    return p;
  }

  var currentPath = currentPathFromLocation();

  var folderSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  var fileSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
  var delSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  function showStatus(text) {
    statusEl.textContent = text;
    statusEl.classList.add('show');
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () {
      statusEl.classList.remove('show');
    }, 2200);
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatSize(bytes) {
    if (!bytes || bytes < 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function formatDate(ts) {
    if (!ts) return '-';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderBreadcrumb() {
    breadcrumbEl.innerHTML = '';
    var root = document.createElement('a');
    root.href = '/';
    root.textContent = '根';
    breadcrumbEl.appendChild(root);

    if (!currentPath) return;

    var parts = currentPath.split('/');
    var acc = '';
    parts.forEach(function (seg) {
      acc = acc ? acc + '/' + seg : seg;
      var sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      breadcrumbEl.appendChild(sep);

      var a = document.createElement('a');
      a.href = '/' + encodeURIComponent(acc);
      a.textContent = seg;
      breadcrumbEl.appendChild(a);
    });
  }

  function createDelBtn(type, target, label) {
    var btn = document.createElement('button');
    btn.className = 'del-btn';
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = delSvg;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      delItem(type, target);
    });
    return btn;
  }

  function delItem(type, target) {
    var msg = type === 'dir' ? '确定删除该文件夹及其所有内容？' : '确定删除该文件？';
    if (!confirm(msg)) return;

    var body = type === 'dir' ? { type: 'dir', path: target } : { type: 'file', id: target };

    fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showStatus('已删除');
          load();
        } else {
          showStatus(data.error || '删除失败');
        }
      })
      .catch(function () {
        showStatus('网络错误');
      });
  }

  function renderList(data) {
    listEl.innerHTML = '';
    var dirs = data.dirs || [];
    var files = data.files || [];

    if (!dirs.length && !files.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '此目录为空';
      listEl.appendChild(empty);
      return;
    }

    dirs.forEach(function (d) {
      var li = document.createElement('li');
      var row = document.createElement('div');
      row.className = 'row';

      var ico = document.createElement('span');
      ico.className = 'ico';
      ico.innerHTML = folderSvg;

      var name = document.createElement('a');
      name.className = 'name';
      name.href = '/' + encodeURIComponent(d.path);
      name.textContent = d.name + '/';

      var size = document.createElement('span');
      size.className = 'size';
      size.textContent = '-';

      var date = document.createElement('span');
      date.className = 'date';
      date.textContent = '-';

      row.appendChild(ico);
      row.appendChild(name);
      row.appendChild(size);
      row.appendChild(date);
      row.appendChild(createDelBtn('dir', d.path, '删除文件夹'));
      li.appendChild(row);
      listEl.appendChild(li);
    });

    files.forEach(function (f) {
      var li = document.createElement('li');
      var row = document.createElement('div');
      row.className = 'row';

      var ico = document.createElement('span');
      ico.className = 'ico';
      ico.innerHTML = fileSvg;

      var name = document.createElement('a');
      name.className = 'name';
      name.href = '/file/' + f.id;
      name.target = '_blank';
      name.rel = 'noopener';
      name.textContent = f.name;

      var size = document.createElement('span');
      size.className = 'size';
      size.textContent = formatSize(f.size);

      var date = document.createElement('span');
      date.className = 'date';
      date.textContent = formatDate(f.createdAt);

      row.appendChild(ico);
      row.appendChild(name);
      row.appendChild(size);
      row.appendChild(date);
      row.appendChild(createDelBtn('file', f.id, '删除文件'));
      li.appendChild(row);
      listEl.appendChild(li);
    });
  }

  function load() {
    fetch('/api/list?path=' + encodeURIComponent(currentPath))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        renderBreadcrumb();
        renderList(data);
      })
      .catch(function () {
        listEl.innerHTML = '<li class="empty">加载失败</li>';
      });
  }

  function upload(file) {
    if (!file) return;
    if (file.size > MAX_SIZE) {
      showStatus('文件不能超过 20MB');
      return;
    }

    var form = new FormData();
    form.append('file', file);
    form.append('path', currentPath);

    showStatus('上传中...');

    fetch('/api/upload', { method: 'POST', body: form })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.url) {
          showStatus('上传成功');
          load();
        } else {
          showStatus(data.error || '上传失败');
        }
      })
      .catch(function () {
        showStatus('网络错误');
      });
  }

  uploadBtn.addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files[0];
    if (file) upload(file);
    fileInput.value = '';
  });

  mkdirBtn.addEventListener('click', function () {
    var name = prompt('新建文件夹名称：');
    if (name === null) return;
    name = name.trim();
    if (!name) return;

    fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: currentPath, name: name })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showStatus('已创建');
          load();
        } else {
          showStatus(data.error || '创建失败');
        }
      })
      .catch(function () {
        showStatus('网络错误');
      });
  });

  load();
</script>
</body>
</html>`;
}
