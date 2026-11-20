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

  .title-row {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
  }
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

  .breadcrumb {
    font-size: 13px; color: #888; margin-bottom: 12px; overflow: hidden; white-space: nowrap;
  }
  .breadcrumb a { color: #555; text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; color: #111; }
  .breadcrumb .sep { margin: 0 6px; color: #ccc; }

  /* 列表样式 */
  ul { list-style: none; margin: 0; padding: 0; }
  li { border-bottom: 1px solid #eee; }
  .row {
    display: flex; align-items: center; padding: 10px 8px; border-radius: 4px;
    cursor: default; /* 禁止默认文本选中 */
  }
  .row:hover { background: #f9f9f9; }
  .ico { flex-shrink: 0; width: 20px; margin-right: 10px; color: #999; }
  .name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #111; text-decoration: none;
  }
  .name.file-link { cursor: pointer; }
  .name.file-link:hover { text-decoration: underline; }
  .size, .date { color: #888; font-size: 13px; white-space: nowrap; }
  .size { width: 80px; text-align: right; margin-left: 16px; }
  .date { width: 140px; text-align: right; margin-left: 16px; }

  .empty { color: #aaa; text-align: center; padding: 48px 0; font-size: 14px; }
  
  /* 状态提示 */
  .status {
    position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
    background: #111; color: #fff; padding: 8px 16px; border-radius: 6px;
    font-size: 13px; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 100;
  }
  .status.show { opacity: 0.95; }

  /* 自定义右键菜单 */
  #context-menu {
    position: fixed; display: none; background: #fff; border: 1px solid #ddd;
    border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 1000;
    padding: 4px 0; min-width: 140px;
  }
  .ctx-item {
    padding: 8px 16px; font-size: 13px; color: #333; cursor: pointer; display: flex; align-items: center; gap: 8px;
  }
  .ctx-item:hover { background: #f5f5f5; color: #000; }
  .ctx-item.danger { color: #d33; }
  .ctx-item.danger:hover { background: #fdf0f0; }

  /* 弹窗 Modal */
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

  @media (max-width: 600px) {
    .date { width: 100px; } .size { display: none; }
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

  <input type="file" id="fileInput" hidden>
  <ul id="list"></ul>
</div>

<!-- 状态提示 -->
<div class="status" id="status"></div>

<!-- 自定义右键菜单 -->
<div id="context-menu">
  <div class="ctx-item" id="ctxDownload" style="display:none;">下载 / 预览</div>
  <div class="ctx-item" id="ctxMove">移动到...</div>
  <div class="ctx-item" id="ctxCopy">复制到...</div>
  <div class="ctx-item danger" id="ctxDelete">删除（放入回收站）</div>
  <div class="ctx-item" id="ctxRestore" style="display:none;">恢复</div>
</div>

<!-- 移动/复制 弹窗 -->
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

  // 当前状态
  var currentPath = location.pathname.replace(/^\\/+|\\/+$/g, '');
  var isTrashView = false;
  var ctxTarget = null; // { type: 'file'|'dir', id, path, name }

  // SVG 图标
  var folderSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  var fileSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

  // 禁用浏览器默认右键菜单
  document.addEventListener('contextmenu', function(e) {
    // 如果在自定义菜单内部右键，放过
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
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ============ 右键菜单逻辑 ============
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
      // 回收站视图：只显示恢复
      ctxDownload.style.display = 'none';
      ctxMove.style.display = 'none';
      ctxCopy.style.display = 'none';
      ctxDelete.style.display = 'none';
      ctxRestore.style.display = 'block';
    } else {
      // 正常视图
      ctxDownload.style.display = type === 'file' ? 'block' : 'none';
      ctxMove.style.display = 'block';
      ctxCopy.style.display = 'block';
      ctxDelete.style.display = 'block';
      ctxRestore.style.display = 'none';
    }

    var x = e.clientX, y = e.clientY;
    // 防止超出屏幕
    if (x + 160 > window.innerWidth) x -= 160;
    if (y + 200 > window.innerHeight) y -= 200;

    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    ctxMenu.style.display = 'block';
  }

  // 右键菜单事件绑定
  ctxDownload.addEventListener('click', function() {
    if (ctxTarget && ctxTarget.type === 'file') window.open('/file/' + ctxTarget.data.id, '_blank');
  });

  ctxDelete.addEventListener('click', function() {
    if (!ctxTarget) return;
    if (!confirm('确定删除并放入回收站？')) return;
    var body = ctxTarget.type === 'dir' ? { type: 'dir', path: ctxTarget.data.path } : { type: 'file', id: ctxTarget.data.id };
    fetch('/api/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json()).then(d => {
      if (d.ok) { showStatus('已移入回收站'); load(); } else { showStatus(d.error || '删除失败'); }
    });
  });

  ctxRestore.addEventListener('click', function() {
    if (!ctxTarget) return;
    fetch('/api/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: ctxTarget.type, id: ctxTarget.type === 'dir' ? ctxTarget.data.path : ctxTarget.data.id })
    }).then(r => r.json()).then(d => {
      if (d.ok) { showStatus('已恢复'); load(); } else { showStatus(d.error || '恢复失败'); }
    });
  });

  // ============ 移动/复制 弹窗逻辑 ============
  var modalOverlay = document.getElementById('modalOverlay');
  var modalTitle = document.getElementById('modalTitle');
  var targetPathInput = document.getElementById('targetPathInput');
  var treeBox = document.getElementById('treeBox');
  var modalConfirm = document.getElementById('modalConfirm');
  var modalCancel = document.getElementById('modalCancel');
  var currentAction = ''; // 'move' or 'copy'

  function openModal(action) {
    if (!ctxTarget) return;
    currentAction = action;
    modalTitle.textContent = action === 'move' ? '移动到...' : '复制到...';
    targetPathInput.value = currentPath;
    modalOverlay.style.display = 'flex';
    hideContextMenu();
    
    // 加载目录树
    fetch('/api/tree').then(r => r.json()).then(dirs => {
      treeBox.innerHTML = '<div class="tree-item" data-path="">[ 根目录 ]</div>';
      dirs.forEach(d => {
        var el = document.createElement('div');
        el.className = 'tree-item';
        el.textContent = d;
        el.dataset.path = d;
        treeBox.appendChild(el);
      });
    });
  }

  treeBox.addEventListener('click', function(e) {
    if (e.target.classList.contains('tree-item')) {
      targetPathInput.value = e.target.dataset.path;
    }
  });

  modalCancel.addEventListener('click', () => modalOverlay.style.display = 'none');

  modalConfirm.addEventListener('click', function() {
    var targetDir = targetPathInput.value.trim();
    if (!ctxTarget) return;
    
    var source = ctxTarget.type === 'file' ? ctxTarget.data.id : ctxTarget.data.path;
    var body = { type: ctxTarget.type, source: source, targetDir: targetDir };
    
    fetch('/api/' + currentAction, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json()).then(d => {
      if (d.ok) {
        showStatus(currentAction === 'move' ? '移动成功' : '复制成功');
        modalOverlay.style.display = 'none';
        load();
      } else {
        showStatus(d.error || '操作失败');
      }
    });
  });

  ctxMove.addEventListener('click', () => openModal('move'));
  ctxCopy.addEventListener('click', () => openModal('copy'));

  // ============ 页面渲染 ============
  function renderBreadcrumb() {
    breadcrumbEl.innerHTML = '';
    if (isTrashView) {
      breadcrumbEl.innerHTML = '<span>回收站</span>';
      return;
    }
    var root = document.createElement('a');
    root.href = '/'; root.textContent = '根';
    breadcrumbEl.appendChild(root);
    if (!currentPath) return;
    var parts = currentPath.split('/'); var acc = '';
    parts.forEach(function(seg) {
      acc = acc ? acc + '/' + seg : seg;
      var sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '/';
      breadcrumbEl.appendChild(sep);
      var a = document.createElement('a');
      a.href = '/' + encodeURIComponent(acc); a.textContent = seg;
      breadcrumbEl.appendChild(a);
    });
  }

  function renderList(data) {
    listEl.innerHTML = '';
    
    if (isTrashView) {
      // 渲染回收站数据
      var hasItems = false;
      for (var date in data) {
        hasItems = true;
        var groupLi = document.createElement('li');
        groupLi.style.cssText = 'padding: 8px 0; color: #888; font-size: 13px; border-bottom: none; margin-top: 12px;';
        groupLi.textContent = '删除日期：' + date;
        listEl.appendChild(groupLi);

        data[date].forEach(function(f) {
          var li = document.createElement('li');
          li.innerHTML = '<div class="row">' +
            '<span class="ico">' + fileSvg + '</span>' +
            '<span class="name" style="cursor:pointer;">' + f.name + '</span>' +
            '<span class="size">' + formatSize(f.size) + '</span>' +
            '<span class="date">' + (f.originalPath ? '原:' + f.originalPath : '-') + '</span>' +
            '</div>';
          li.querySelector('.row').addEventListener('contextmenu', function(e) { showContextMenu(e, 'file', f); });
          listEl.appendChild(li);
        });
      }
      if (!hasItems) listEl.innerHTML = '<li class="empty">回收站为空</li>';
      return;
    }

    // 正常渲染
    var dirs = data.dirs || [], files = data.files || [];
    if (!dirs.length && !files.length) {
      listEl.innerHTML = '<li class="empty">此目录为空</li>'; return;
    }

    dirs.forEach(function(d) {
      var li = document.createElement('li');
      li.innerHTML = '<div class="row">' +
        '<span class="ico">' + folderSvg + '</span>' +
        '<a class="name" href="/' + encodeURIComponent(d.path) + '">' + d.name + '/</a>' +
        '<span class="size">-</span><span class="date">-</span>' +
        '</div>';
      li.querySelector('.row').addEventListener('contextmenu', function(e) { showContextMenu(e, 'dir', d); });
      listEl.appendChild(li);
    });

    files.forEach(function(f) {
      var li = document.createElement('li');
      li.innerHTML = '<div class="row">' +
        '<span class="ico">' + fileSvg + '</span>' +
        '<a class="name file-link" href="/file/' + f.id + '" target="_blank">' + f.name + '</a>' +
        '<span class="size">' + formatSize(f.size) + '</span>' +
        '<span class="date">' + formatDate(f.createdAt) + '</span>' +
        '</div>';
      li.querySelector('.row').addEventListener('contextmenu', function(e) { showContextMenu(e, 'file', f); });
      listEl.appendChild(li);
    });
  }

  function load() {
    renderBreadcrumb();
    if (isTrashView) {
      pageTitle.textContent = '回收站';
      trashBtn.classList.add('active');
      mkdirBtn.style.display = 'none';
      uploadBtn.style.display = 'none';
      fetch('/api/trash').then(r => r.json()).then(renderList);
    } else {
      pageTitle.textContent = 'File-Go！';
      trashBtn.classList.remove('active');
      mkdirBtn.style.display = 'inline-flex';
      uploadBtn.style.display = 'inline-flex';
      fetch('/api/list?path=' + encodeURIComponent(currentPath)).then(r => r.json()).then(renderList);
    }
  }

  // 事件绑定
  trashBtn.addEventListener('click', function() {
    isTrashView = !isTrashView;
    load();
  });

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', function() {
    var file = fileInput.files[0];
    if (file) {
      if (file.size > MAX_SIZE) return showStatus('文件不能超过 20MB');
      var form = new FormData();
      form.append('file', file);
      form.append('path', currentPath);
      showStatus('上传中...');
      fetch('/api/upload', { method: 'POST', body: form })
        .then(r => r.json()).then(d => {
          if (d.url) { showStatus('上传成功'); load(); } else { showStatus(d.error || '上传失败'); }
        });
    }
    fileInput.value = '';
  });

  mkdirBtn.addEventListener('click', function() {
    var name = prompt('新建文件夹名称：');
    if (!name || !name.trim()) return;
    fetch('/api/mkdir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: currentPath, name: name.trim() })
    }).then(r => r.json()).then(d => {
      if (d.ok) { showStatus('已创建'); load(); } else { showStatus(d.error || '创建失败'); }
    });
  });

  load();
</script>
</body>
</html>`;
}