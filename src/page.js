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
    padding: 40px 20px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 15px; color: #111; background: #fff;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 720px; margin: 0 auto; }
  .title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0; }
  .actions { display: flex; gap: 8px; }
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    height: 34px; padding: 0 12px; border: 1px solid #ddd; border-radius: 6px;
    background: #fff; cursor: pointer; color: #333; font-size: 13px;
    transition: background 0.12s, border-color 0.12s;
  }
  .icon-btn:hover { background: #f5f5f5; border-color: #bbb; }
  .icon-btn.active { background: #f0f0f0; border-color: #999; font-weight: 600; }
  .breadcrumb { font-size: 13px; color: #888; margin-bottom: 12px; overflow: hidden; white-space: nowrap; }
  .breadcrumb a { color: #555; text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; color: #111; }
  .breadcrumb .sep { margin: 0 6px; color: #ccc; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { border-bottom: 1px solid #eee; }
  .row { display: flex; align-items: center; padding: 10px 8px; border-radius: 4px; cursor: default; }
  .row:hover { background: #f9f9f9; }
  .ico { flex-shrink: 0; width: 20px; margin-right: 10px; color: #999; display: inline-flex; align-items: center; }
  .name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #111; text-decoration: none;
  }
  .name.file-link { cursor: pointer; }
  .name.file-link:hover { text-decoration: underline; }
  .size, .date { color: #888; font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .size { width: 80px; text-align: right; margin-left: 16px; }
  .date { width: 140px; text-align: right; margin-left: 16px; overflow: hidden; text-overflow: ellipsis; }
  .empty { color: #aaa; text-align: center; padding: 48px 0; font-size: 14px; }
  .status {
    position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
    background: #111; color: #fff; padding: 8px 16px; border-radius: 6px;
    font-size: 13px; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 4000;
  }
  .status.show { opacity: 0.95; }
  #context-menu {
    position: fixed; display: none; background: #fff; border: 1px solid #ddd;
    border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 1000;
    padding: 4px 0; min-width: 140px;
  }
  .ctx-item { padding: 8px 16px; font-size: 13px; color: #333; cursor: pointer; }
  .ctx-item:hover { background: #f5f5f5; color: #000; }
  .ctx-item.danger { color: #d33; }
  .ctx-item.danger:hover { background: #fdf0f0; }
  .modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4);
    display: none; align-items: center; justify-content: center; z-index: 2000;
  }
  .modal-content {
    background: #fff; border-radius: 8px; padding: 20px; width: 90%; max-width: 400px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  }
  .modal-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
  .modal-input {
    width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;
    font-size: 14px; margin-bottom: 12px; outline: none;
  }
  .modal-input:focus { border-color: #999; }
  .tree-box {
    border: 1px solid #eee; border-radius: 4px; max-height: 150px; overflow-y: auto;
    margin-bottom: 16px; padding: 4px;
  }
  .tree-item { padding: 4px 8px; font-size: 13px; color: #555; cursor: pointer; border-radius: 4px; }
  .tree-item:hover { background: #f0f0f0; color: #111; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn { padding: 6px 16px; border-radius: 4px; font-size: 13px; cursor: pointer; border: 1px solid #ddd; background: #fff; }
  .btn.primary { background: #111; color: #fff; border-color: #111; }
  .btn.primary:hover { background: #333; }
  /* 拖拽上传遮罩 */
  .drop-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,0.9);
    display: none; align-items: center; justify-content: center; z-index: 5000; pointer-events: none;
  }
  .drop-overlay.show { display: flex; }
  .drop-inner {
    border: 2px dashed #999; border-radius: 10px; padding: 36px 56px;
    font-size: 15px; color: #333; background: #fff; max-width: 80%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* 上传队列面板 */
  .up-panel {
    position: fixed; right: 20px; bottom: 20px; width: 320px; background: #fff;
    border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.12);
    z-index: 1500; display: none; overflow: hidden;
  }
  .up-panel.show { display: block; }
  .up-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 12px; border-bottom: 1px solid #eee; font-size: 13px; color: #333;
  }
  .up-summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .up-link { font-size: 12px; color: #888; cursor: pointer; border: none; background: none; padding: 0 2px; font-family: inherit; }
  .up-link:hover { color: #111; text-decoration: underline; }
  .up-body { max-height: 240px; overflow-y: auto; }
  .up-panel.collapsed .up-body { display: none; }
  .up-item { padding: 8px 12px; border-bottom: 1px solid #f5f5f5; }
  .up-item:last-child { border-bottom: none; }
  .up-line { display: flex; align-items: baseline; gap: 8px; }
  .up-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: #111; }
  .up-state {
    flex-shrink: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12px; color: #888; font-variant-numeric: tabular-nums;
  }
  .up-state.ok { color: #2a7d2a; }
  .up-state.bad { color: #d33; }
  .up-bar { height: 3px; background: #f2f2f2; border-radius: 2px; margin-top: 6px; overflow: hidden; }
  .up-bar i { display: block; height: 100%; width: 0; background: #111; transition: width 0.15s linear; }
  .up-bar.ok i { background: #dcdcdc; }
  .up-bar.err i { background: #e0a5a5; }
  @media (max-width: 600px) {
    .date { width: 100px; }
    .size { display: none; }
    .up-panel { left: 12px; right: 12px; width: auto; bottom: 12px; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="title-row">
    <h1 id="pageTitle">File-Go！</h1>
    <div class="actions">
      <button class="icon-btn" id="trashBtn" title="回收站">回收站</button>
      <button class="icon-btn" id="mkdirBtn" title="新建文件夹" style="display:none;">新建文件夹</button>
      <button class="icon-btn" id="uploadBtn" title="上传文件">上传文件</button>
    </div>
  </div>
  <nav class="breadcrumb" id="breadcrumb"></nav>
  <input type="file" id="fileInput" multiple hidden>
  <ul id="list"></ul>
</div>

<div class="status" id="status"></div>

<div class="drop-overlay" id="dropOverlay">
  <div class="drop-inner" id="dropInner">松开鼠标即可上传</div>
</div>

<div class="up-panel" id="upPanel">
  <div class="up-head">
    <span class="up-summary" id="upSummary">上传队列</span>
    <button class="up-link" id="upToggle" type="button">收起</button>
    <button class="up-link" id="upClear" type="button">清除</button>
  </div>
  <div class="up-body" id="upBody"></div>
</div>

<div id="context-menu">
  <div class="ctx-item" id="ctxDownload" style="display:none;">下载 / 预览</div>
  <div class="ctx-item" id="ctxMove">移动到...</div>
  <div class="ctx-item" id="ctxCopy">复制到...</div>
  <div class="ctx-item danger" id="ctxDelete">删除（放入回收站）</div>
  <div class="ctx-item" id="ctxRestore" style="display:none;">恢复</div>
</div>

<div class="modal-overlay" id="modalOverlay">
  <div class="modal-content">
    <div class="modal-title" id="modalTitle">移动到</div>
    <input type="text" class="modal-input" id="targetPathInput" placeholder="输入目标路径，如：images/2024" autocomplete="off">
    <div class="tree-box" id="treeBox"></div>
    <div class="modal-actions">
      <button class="btn" id="modalCancel">取消</button>
      <button class="btn primary" id="modalConfirm">确定</button>
    </div>
  </div>
</div>

<script>
  var MAX_SIZE = 20 * 1024 * 1024;
  var listEl = document.getElementById('list');
  var breadcrumbEl = document.getElementById('breadcrumb');
  var statusEl = document.getElementById('status');
  var pageTitle = document.getElementById('pageTitle');
  var trashBtn = document.getElementById('trashBtn');
  var mkdirBtn = document.getElementById('mkdirBtn');
  var uploadBtn = document.getElementById('uploadBtn');
  var fileInput = document.getElementById('fileInput');
  var dropOverlay = document.getElementById('dropOverlay');
  var dropInner = document.getElementById('dropInner');
  var upPanel = document.getElementById('upPanel');
  var upBody = document.getElementById('upBody');
  var upSummary = document.getElementById('upSummary');
  var upToggle = document.getElementById('upToggle');
  var upClear = document.getElementById('upClear');

  var rawPath = location.pathname.replace(/^\\/+|\\/+$/g, '');
  var currentPath = '';
  try { currentPath = decodeURIComponent(rawPath); } catch (e) { currentPath = rawPath; }

  var isTrashView = false;
  var ctxTarget = null;

  var folderSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  var fileSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

  document.addEventListener('contextmenu', function(e) {
    if (e.target.closest('#context-menu')) return;
    e.preventDefault();
  });

  function showStatus(text) {
    statusEl.textContent = text;
    statusEl.classList.add('show');
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () { statusEl.classList.remove('show'); }, 2200);
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
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ===== 右键菜单 =====
  var ctxMenu = document.getElementById('context-menu');
  var ctxDownload = document.getElementById('ctxDownload');
  var ctxMove = document.getElementById('ctxMove');
  var ctxCopy = document.getElementById('ctxCopy');
  var ctxDelete = document.getElementById('ctxDelete');
  var ctxRestore = document.getElementById('ctxRestore');

  function hideContextMenu() { ctxMenu.style.display = 'none'; }
  document.addEventListener('click', hideContextMenu);

  function showContextMenu(e, type, data) {
    e.preventDefault();
    ctxTarget = { type: type, data: data };
    if (isTrashView) {
      ctxDownload.style.display = 'none';
      ctxMove.style.display = 'none';
      ctxCopy.style.display = 'none';
      ctxDelete.style.display = 'none';
      ctxRestore.style.display = 'block';
    } else {
      ctxDownload.style.display = type === 'file' ? 'block' : 'none';
      ctxMove.style.display = 'block';
      ctxCopy.style.display = 'block';
      ctxDelete.style.display = 'block';
      ctxRestore.style.display = 'none';
    }
    var x = e.clientX, y = e.clientY;
    if (x + 160 > window.innerWidth) x -= 160;
    if (y + 200 > window.innerHeight) y -= 200;
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    ctxMenu.style.display = 'block';
  }

  ctxDownload.addEventListener('click', function () {
    if (ctxTarget && ctxTarget.type === 'file') window.open('/file/' + ctxTarget.data.id, '_blank');
  });

  ctxDelete.addEventListener('click', function () {
    if (!ctxTarget) return;
    if (!confirm('确定删除并放入回收站？')) return;
    var body = ctxTarget.type === 'dir'
      ? { type: 'dir', path: ctxTarget.data.path }
      : { type: 'file', id: ctxTarget.data.id };
    fetch('/api/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { showStatus('已移入回收站'); load(); } else { showStatus(d.error || '删除失败'); }
    });
  });

  ctxRestore.addEventListener('click', function () {
    if (!ctxTarget) return;
    var body;
    if (ctxTarget.type === 'dir') {
      body = { type: 'dir', id: ctxTarget.data.path };
    } else {
      body = { type: 'file', id: ctxTarget.data.id };
    }
    fetch('/api/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { showStatus('已恢复'); load(); } else { showStatus(d.error || '恢复失败'); }
    });
  });

  // ===== 移动/复制弹窗 =====
  var modalOverlay = document.getElementById('modalOverlay');
  var modalTitle = document.getElementById('modalTitle');
  var targetPathInput = document.getElementById('targetPathInput');
  var treeBox = document.getElementById('treeBox');
  var modalConfirm = document.getElementById('modalConfirm');
  var modalCancel = document.getElementById('modalCancel');
  var currentAction = '';

  function openModal(action) {
    if (!ctxTarget) return;
    currentAction = action;
    modalTitle.textContent = action === 'move' ? '移动到...' : '复制到...';
    targetPathInput.value = currentPath;
    modalOverlay.style.display = 'flex';
    hideContextMenu();

    fetch('/api/tree').then(function (r) { return r.json(); }).then(function (dirs) {
      treeBox.innerHTML = '';
      var rootEl = document.createElement('div');
      rootEl.className = 'tree-item';
      rootEl.textContent = '[ 根目录 ]';
      rootEl.dataset.path = '';
      treeBox.appendChild(rootEl);
      dirs.forEach(function (d) {
        var el = document.createElement('div');
        el.className = 'tree-item';
        el.textContent = d;
        el.dataset.path = d;
        treeBox.appendChild(el);
      });
    }).catch(function () {
      showStatus('目录树加载失败');
    });
  }

  treeBox.addEventListener('click', function (e) {
    if (e.target.classList.contains('tree-item')) {
      targetPathInput.value = e.target.dataset.path || '';
    }
  });

  modalCancel.addEventListener('click', function () { modalOverlay.style.display = 'none'; });

  modalConfirm.addEventListener('click', function () {
    var targetDir = targetPathInput.value.trim();
    if (!ctxTarget) return;
    var source = ctxTarget.type === 'file' ? ctxTarget.data.id : ctxTarget.data.path;
    var body = { type: ctxTarget.type, source: source, targetDir: targetDir };
    fetch('/api/' + currentAction, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        showStatus(currentAction === 'move' ? '移动成功' : '复制成功');
        modalOverlay.style.display = 'none';
        load();
      } else {
        showStatus(d.error || '操作失败');
      }
    });
  });

  ctxMove.addEventListener('click', function () { openModal('move'); });
  ctxCopy.addEventListener('click', function () { openModal('copy'); });

  // ===== 渲染 =====
  function renderBreadcrumb() {
    breadcrumbEl.innerHTML = '';
    if (isTrashView) {
      breadcrumbEl.textContent = '回收站';
      return;
    }
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

  function makeRow(type, data) {
    var li = document.createElement('li');
    var row = document.createElement('div');
    row.className = 'row';

    var ico = document.createElement('span');
    ico.className = 'ico';
    ico.innerHTML = type === 'dir' ? folderSvg : fileSvg;

    var name;
    if (type === 'dir') {
      name = document.createElement('a');
      name.className = 'name';
      name.href = '/' + encodeURIComponent(data.path);
      name.textContent = data.name + '/';
    } else {
      name = document.createElement('a');
      name.className = 'name file-link';
      name.href = '/file/' + data.id;
      name.target = '_blank';
      name.rel = 'noopener';
      name.textContent = data.name;
    }

    var size = document.createElement('span');
    size.className = 'size';
    size.textContent = type === 'file' ? formatSize(data.size) : '-';

    var date = document.createElement('span');
    date.className = 'date';
    // 回收站视图的日期列用于展示原始路径
    if (isTrashView) {
      date.textContent = data.originalPath ? '原: ' + data.originalPath : '-';
    } else if (type === 'file') {
      date.textContent = formatDate(data.createdAt);
    } else {
      date.textContent = '-';
    }

    row.appendChild(ico);
    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(date);
    row.addEventListener('contextmenu', function (e) { showContextMenu(e, type, data); });

    li.appendChild(row);
    return li;
  }

  function renderList(data) {
    listEl.innerHTML = '';

    if (isTrashView) {
      var dates = Object.keys(data || {});
      // 数字型日期键会被浏览器按升序重排，这里手动倒序
      dates.sort().reverse();
      if (!dates.length) {
        listEl.innerHTML = '<li class="empty">回收站为空</li>';
        return;
      }
      dates.forEach(function (dateKey) {
        var groupLi = document.createElement('li');
        groupLi.style.cssText = 'padding: 10px 0 4px; color: #888; font-size: 13px; border-bottom: none; margin-top: 8px;';
        groupLi.textContent = '删除日期：' + dateKey;
        listEl.appendChild(groupLi);

        (data[dateKey] || []).forEach(function (item) {
          // 回收站条目：目录传 path，文件传 id，交给 makeRow 时保持 data 结构一致
          var normalized = item.type === 'dir'
            ? { path: item.path, name: item.name, originalPath: item.path }
            : item;
          listEl.appendChild(makeRow(item.type, normalized));
        });
      });
      return;
    }

    var dirs = data.dirs || [];
    var files = data.files || [];
    if (!dirs.length && !files.length) {
      listEl.innerHTML = '<li class="empty">此目录为空</li>';
      return;
    }
    dirs.forEach(function (d) { listEl.appendChild(makeRow('dir', d)); });
    files.forEach(function (f) { listEl.appendChild(makeRow('file', f)); });
  }

  function load() {
    renderBreadcrumb();
    if (isTrashView) {
      pageTitle.textContent = '回收站';
      trashBtn.classList.add('active');
      mkdirBtn.style.display = 'none';
      uploadBtn.style.display = 'none';
      fetch('/api/trash').then(function (r) { return r.json(); }).then(renderList)
        .catch(function () { listEl.innerHTML = '<li class="empty">加载失败</li>'; });
    } else {
      pageTitle.textContent = 'File-Go！';
      trashBtn.classList.remove('active');
      mkdirBtn.style.display = 'inline-flex';
      uploadBtn.style.display = 'inline-flex';
      fetch('/api/list?path=' + encodeURIComponent(currentPath))
        .then(function (r) { return r.json(); }).then(renderList)
        .catch(function () { listEl.innerHTML = '<li class="empty">加载失败</li>'; });
    }
  }

  trashBtn.addEventListener('click', function () {
    isTrashView = !isTrashView;
    load();
  });

  uploadBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = '';
  });

  // ===== 上传队列 =====
  var CONCURRENCY = 2;          // Telegram 对同一 chat 有频率限制，并发不宜过高
  var MAX_RETRY = 2;            // 限流/网络错误自动重试次数
  var queue = [];
  var running = 0;
  var reloadTimer = null;

  function isBusy() {
    for (var i = 0; i < queue.length; i++) {
      var s = queue[i].status;
      if (s === 'waiting' || s === 'uploading') return true;
    }
    return false;
  }

  function addFiles(files) {
    var added = 0, skipped = 0, oversize = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      // 拖拽进来的文件夹在浏览器里是 size 为 0 的条目
      if (f.size === 0) { skipped++; continue; }
      var item = {
        file: f, name: f.name, size: f.size,
        path: currentPath, loaded: 0, status: 'waiting', error: '', attempt: 0
      };
      if (f.size > MAX_SIZE) { item.status = 'error'; item.error = '超过 20MB'; item.noRetry = true; }
      queue.push(item);
      appendRow(item);
      added++;
      if (item.status === 'error') oversize++;
    }
    if (oversize) showStatus(oversize + ' 个文件超过 20MB');
    else if (skipped) showStatus('已跳过 ' + skipped + ' 个空文件或文件夹');
    else if (added) showStatus('已加入队列 ' + added + ' 个文件');
    pump();
  }

  function pump() {
    while (running < CONCURRENCY) {
      var next = null;
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].status === 'waiting') { next = queue[i]; break; }
      }
      if (!next) break;
      startUpload(next);
    }
    refreshPanel();
  }

  function startUpload(item) {
    item.status = 'uploading';
    item.loaded = 0;
    item.error = '';
    running++;
    updateRow(item);

    var form = new FormData();
    form.append('file', item.file);
    form.append('path', item.path);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) { item.loaded = e.loaded; updateRow(item); }
    };
    xhr.onload = function () {
      var d = null;
      try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && d && d.url) {
        item.status = 'done';
        item.loaded = item.size;
        scheduleReload();
      } else if (xhr.status === 429 && item.attempt < MAX_RETRY) {
        // 只有确定没有副作用的错误才自动重试；500/502 可能已经把文件传上了 Telegram
        retryLater(item, (d && d.error) || '请求过于频繁');
      } else {
        item.status = 'error';
        item.error = (d && d.error) || ('上传失败 (' + xhr.status + ')');
      }
      done(item);
    };
    xhr.onerror = function () {
      if (item.attempt < MAX_RETRY) { retryLater(item, '网络错误'); } else { item.status = 'error'; item.error = '网络错误'; }
      done(item);
    };
    xhr.onabort = function () { item.status = 'error'; item.error = '已取消'; done(item); };
    xhr.send(form);
  }

  function retryLater(item, reason) {
    item.attempt++;
    item.status = 'waiting';
    item.loaded = 0;
    item.error = reason;
    setTimeout(pump, 2000 * item.attempt);
  }

  function done(item) {
    running--;
    updateRow(item);
    pump();
  }

  // 多个文件同时完成时只刷新一次列表
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 600);
  }

  function appendRow(item) {
    var el = document.createElement('div');
    el.className = 'up-item';

    var line = document.createElement('div');
    line.className = 'up-line';

    var nameEl = document.createElement('span');
    nameEl.className = 'up-name';
    nameEl.textContent = item.name;
    nameEl.title = item.path ? item.name + ' → ' + item.path : item.name;

    var stateEl = document.createElement('span');
    stateEl.className = 'up-state';

    var retryEl = document.createElement('button');
    retryEl.className = 'up-link';
    retryEl.type = 'button';
    retryEl.textContent = '重试';
    retryEl.style.display = 'none';
    retryEl.addEventListener('click', function () {
      if (item.status !== 'error') return;
      item.status = 'waiting';
      item.error = '';
      item.loaded = 0;
      item.attempt = 0;
      updateRow(item);
      pump();
    });

    var bar = document.createElement('div');
    bar.className = 'up-bar';
    var fill = document.createElement('i');
    bar.appendChild(fill);

    line.appendChild(nameEl);
    line.appendChild(stateEl);
    line.appendChild(retryEl);
    el.appendChild(line);
    el.appendChild(bar);

    item.el = el;
    item.stateEl = stateEl;
    item.retryEl = retryEl;
    item.barEl = bar;
    item.fillEl = fill;
    upBody.appendChild(el);
    updateRow(item);
  }

  function updateRow(item) {
    if (!item.el) return;
    var pct = item.size ? Math.min(100, Math.round(item.loaded * 100 / item.size)) : 0;
    if (item.status === 'uploading') {
      item.stateEl.className = 'up-state';
      item.stateEl.textContent = pct + '%';
      item.fillEl.style.width = pct + '%';
      item.barEl.className = 'up-bar';
      item.retryEl.style.display = 'none';
    } else if (item.status === 'waiting') {
      item.stateEl.className = 'up-state';
      item.stateEl.textContent = item.attempt ? '重试中' : '排队';
      item.fillEl.style.width = pct + '%';
      item.barEl.className = 'up-bar';
      item.retryEl.style.display = 'none';
    } else if (item.status === 'done') {
      item.stateEl.className = 'up-state ok';
      item.stateEl.textContent = '完成';
      item.fillEl.style.width = '100%';
      item.barEl.className = 'up-bar ok';
      item.retryEl.style.display = 'none';
    } else {
      item.stateEl.className = 'up-state bad';
      item.stateEl.textContent = item.error || '失败';
      item.stateEl.title = item.error || '';
      item.fillEl.style.width = '100%';
      item.barEl.className = 'up-bar err';
      item.retryEl.style.display = item.noRetry ? 'none' : 'inline';
    }
    refreshPanel();
  }

  function refreshPanel() {
    if (!queue.length) { upPanel.classList.remove('show'); return; }
    upPanel.classList.add('show');
    var ok = 0, bad = 0;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].status === 'done') ok++;
      else if (queue[i].status === 'error') bad++;
    }
    var text = '上传队列 ' + ok + '/' + queue.length;
    if (bad) text += '，' + bad + ' 个失败';
    upSummary.textContent = text;
  }

  upToggle.addEventListener('click', function () {
    var collapsed = upPanel.classList.toggle('collapsed');
    upToggle.textContent = collapsed ? '展开' : '收起';
  });

  upClear.addEventListener('click', function () {
    var keep = [];
    for (var i = 0; i < queue.length; i++) {
      var it = queue[i];
      if (it.status === 'done' || it.status === 'error') {
        if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el);
      } else {
        keep.push(it);
      }
    }
    queue = keep;
    refreshPanel();
  });

  window.addEventListener('beforeunload', function (e) {
    if (!isBusy()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ===== 拖拽上传 =====
  var dragDepth = 0;

  // 非文件拖拽（选中文字、链接）不拦截，保持浏览器默认行为
  function isFileDrag(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'Files' || types[i] === 'application/x-moz-file') return true;
    }
    return false;
  }

  document.addEventListener('dragenter', function (e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (isTrashView) return;
    dragDepth++;
    dropInner.textContent = '松开鼠标，上传到 ' + (currentPath ? currentPath : '根目录');
    dropOverlay.classList.add('show');
  });

  document.addEventListener('dragover', function (e) {
    if (!isFileDrag(e) || isTrashView) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('dragleave', function (e) {
    if (dragDepth > 0) dragDepth--;
    if (dragDepth === 0 || !e.relatedTarget) {
      dragDepth = 0;
      dropOverlay.classList.remove('show');
    }
  });

  document.addEventListener('drop', function (e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('show');
    if (isTrashView) { showStatus('回收站不支持上传'); return; }
    if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  mkdirBtn.addEventListener('click', function () {
    var name = prompt('新建文件夹名称：');
    if (!name || !name.trim()) return;
    fetch('/api/mkdir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: currentPath, name: name.trim() })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { showStatus('已创建'); load(); } else { showStatus(d.error || '创建失败'); }
    }).catch(function () { showStatus('网络错误'); });
  });

  load();
</script>
</body>
</html>`;
}
