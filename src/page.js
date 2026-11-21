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
    max-width: 80vw; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
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
  /* 多选与批量操作 */
  .row.sel, .row.sel:hover { background: #eef4ff; }
  .selbox {
    flex-shrink: 0; width: 15px; height: 15px; margin: 0 9px 0 2px;
    cursor: pointer; accent-color: #111;
  }
  .batchbar {
    display: none; align-items: center; gap: 8px; padding: 8px 10px; margin-bottom: 10px;
    background: #f7f7f8; border: 1px solid #e6e6e9; border-radius: 8px; font-size: 13px; color: #555;
  }
  .batchbar.show { display: flex; }
  .batchbar.busy { pointer-events: none; opacity: 0.55; }
  .batchbar .grow { flex: 1; }
  .batchbar .all { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  .bb-btn {
    border: 1px solid #ddd; background: #fff; color: #333; border-radius: 5px;
    padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: inherit;
  }
  .bb-btn:hover { background: #f2f2f2; border-color: #bbb; }
  .bb-btn.danger { color: #c33; }
  .bb-btn.danger:hover { background: #fdf0f0; }
  .bb-btn.primary { background: #111; color: #fff; border-color: #111; }
  .bb-btn.primary:hover { background: #333; }
  .rename-input {
    flex: 1; min-width: 0; font-family: inherit; font-size: 15px; color: #111;
    padding: 2px 6px; border: 1px solid #111; border-radius: 4px; outline: none; background: #fff;
  }
  /* 同名冲突弹窗 */
  .cf-desc { font-size: 13px; color: #666; line-height: 1.5; margin: -6px 0 14px; }
  .cf-opt {
    display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; margin-bottom: 8px;
    border: 1px solid #e6e6e6; border-radius: 6px; cursor: pointer; font-size: 13px; color: #111;
  }
  .cf-opt:hover { background: #f7f7f8; }
  .cf-opt input { margin: 2px 0 0; accent-color: #111; }
  .cf-sub { color: #888; font-size: 12px; margin-top: 2px; }
  .cf-opt.off { opacity: 0.45; }
  .cf-opt.off input { pointer-events: none; }
  .cf-all { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #555; margin: 4px 0 16px; cursor: pointer; }
  .cf-all input { accent-color: #111; }
  @media (max-width: 600px) {
    .date { width: 100px; }
    .size { display: none; }
    .up-panel { left: 12px; right: 12px; width: auto; bottom: 12px; }
    .batchbar { flex-wrap: wrap; }
    .batchbar .grow { display: none; }
    .batchbar .bb-btn { margin-left: 0; }
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
  <div class="batchbar" id="batchBar">
    <label class="all"><input type="checkbox" class="selbox" id="selAll"><span id="selCount">已选 0 项</span></label>
    <span class="grow"></span>
    <button class="bb-btn" id="bbRename" type="button">重命名</button>
    <button class="bb-btn" id="bbMove" type="button">移动到</button>
    <button class="bb-btn" id="bbCopy" type="button">复制到</button>
    <button class="bb-btn" id="bbRestore" type="button">恢复</button>
    <button class="bb-btn danger" id="bbDelete" type="button">删除</button>
    <button class="bb-btn" id="bbClear" type="button">取消选择</button>
  </div>
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
  <div class="ctx-item" id="ctxRename" style="display:none;">重命名</div>
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

<div class="modal-overlay" id="cfOverlay">
  <div class="modal-content">
    <div class="modal-title" id="cfTitle">已存在同名项目</div>
    <div class="cf-desc" id="cfDesc"></div>
    <label class="cf-opt" id="cfOverwrite">
      <input type="radio" name="cfChoice" value="overwrite">
      <span>替换<div class="cf-sub" id="cfOverwriteSub">目标中的同名项目会被移入回收站。</div></span>
    </label>
    <label class="cf-opt" id="cfRename">
      <input type="radio" name="cfChoice" value="rename">
      <span>保留两者<div class="cf-sub">新的项目自动改名为 “名称 (1)”。</div></span>
    </label>
    <label class="cf-opt" id="cfSkip">
      <input type="radio" name="cfChoice" value="skip">
      <span>跳过<div class="cf-sub">保持目标中的项目不变。</div></span>
    </label>
    <label class="cf-all" id="cfAllWrap"><input type="checkbox" id="cfAll">应用到全部</label>
    <div class="modal-actions">
      <button class="btn" id="cfCancel">取消</button>
      <button class="btn primary" id="cfOk">确定</button>
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
  var batchBar = document.getElementById('batchBar');
  var selAll = document.getElementById('selAll');
  var selCount = document.getElementById('selCount');
  var bbRename = document.getElementById('bbRename');
  var bbMove = document.getElementById('bbMove');
  var bbCopy = document.getElementById('bbCopy');
  var bbRestore = document.getElementById('bbRestore');
  var bbDelete = document.getElementById('bbDelete');
  var bbClear = document.getElementById('bbClear');

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

  // ===== 多选状态 =====
  // rows 按渲染顺序保存条目，Shift 区间选择依赖这个顺序；key 用路径或 id，重绘后仍能对应
  var rows = [];
  var selected = Object.create(null);
  var selectedNum = 0;
  var anchorIndex = -1;
  var lastMods = { shift: false };
  var batchRunning = false;

  function rowKey(type, data) {
    return type === 'dir' ? 'd:' + data.path : 'f:' + data.id;
  }

  function selection() {
    var out = [];
    for (var i = 0; i < rows.length; i++) if (selected[rows[i].key]) out.push(rows[i]);
    return out;
  }

  function markEntry(entry, on) {
    if (on) {
      if (!selected[entry.key]) selectedNum++;
      selected[entry.key] = entry;
    } else {
      if (selected[entry.key]) selectedNum--;
      delete selected[entry.key];
    }
    entry.rowEl.classList.toggle('sel', on);
    entry.checkEl.checked = on;
  }

  function selectOnly(entry) {
    clearSelection(false);
    markEntry(entry, true);
    anchorIndex = entry.index;
    refreshBatchBar();
  }

  // 复选框：普通切换自己，Shift 从锚点连续选择
  // useDomState —— change 事件里浏览器已经改过 checked，click 里则要自己取反
  function toggleEntry(entry, mods, useDomState) {
    if (mods.shift && anchorIndex >= 0 && anchorIndex < rows.length) {
      var lo = Math.min(anchorIndex, entry.index);
      var hi = Math.max(anchorIndex, entry.index);
      for (var i = lo; i <= hi; i++) markEntry(rows[i], true);
      refreshBatchBar();
      return;
    }
    var on = useDomState ? !!entry.checkEl.checked : !selected[entry.key];
    markEntry(entry, on);
    if (on) anchorIndex = entry.index;
    refreshBatchBar();
  }

  function clearSelection(repaint) {
    for (var key in selected) {
      var entry = selected[key];
      entry.rowEl.classList.remove('sel');
      entry.checkEl.checked = false;
    }
    selected = Object.create(null);
    selectedNum = 0;
    anchorIndex = -1;
    if (repaint !== false) refreshBatchBar();
  }

  function refreshBatchBar() {
    var total = rows.length;
    batchBar.classList.toggle('show', total > 0);
    selAll.checked = total > 0 && selectedNum === total;
    selAll.indeterminate = selectedNum > 0 && selectedNum < total;
    selCount.textContent = selectedNum ? '已选 ' + selectedNum + ' 项' : total + ' 项';
    var pick = selectedNum > 0 ? '' : 'none';
    bbClear.style.display = selectedNum > 0 ? '' : 'none';
    bbMove.style.display = !isTrashView ? pick : 'none';
    bbCopy.style.display = !isTrashView ? pick : 'none';
    bbDelete.style.display = !isTrashView ? pick : 'none';
    bbRestore.style.display = isTrashView ? pick : 'none';
    // 重命名一次只针对一项
    bbRename.style.display = !isTrashView && selectedNum === 1 ? '' : 'none';
  }

  // ===== 右键菜单 =====
  var ctxMenu = document.getElementById('context-menu');
  var ctxDownload = document.getElementById('ctxDownload');
  var ctxRename = document.getElementById('ctxRename');
  var ctxMove = document.getElementById('ctxMove');
  var ctxCopy = document.getElementById('ctxCopy');
  var ctxDelete = document.getElementById('ctxDelete');
  var ctxRestore = document.getElementById('ctxRestore');

  function hideContextMenu() { ctxMenu.style.display = 'none'; }
  document.addEventListener('click', hideContextMenu);

  function showContextMenu(e, entry) {
    e.preventDefault();
    // 右键未选中的行时选择范围收窄到该行，右键已选中的行则保留整组
    if (!entry) return;
    if (!selected[entry.key]) selectOnly(entry);
    ctxTarget = entry;

    var list = selection();
    var n = list.length;
    if (!n) return;
    var multi = n > 1;
    ctxDownload.style.display = !isTrashView && !multi && entry.type === 'file' ? 'block' : 'none';
    ctxRename.style.display = !isTrashView && !multi ? 'block' : 'none';
    ctxMove.style.display = !isTrashView ? 'block' : 'none';
    ctxCopy.style.display = !isTrashView ? 'block' : 'none';
    ctxDelete.style.display = !isTrashView ? 'block' : 'none';
    ctxRestore.style.display = isTrashView ? 'block' : 'none';
    ctxMove.textContent = multi ? '移动 ' + n + ' 项到...' : '移动到...';
    ctxCopy.textContent = multi ? '复制 ' + n + ' 项到...' : '复制到...';
    ctxDelete.textContent = multi ? '删除 ' + n + ' 项（放入回收站）' : '删除（放入回收站）';
    ctxRestore.textContent = multi ? '恢复 ' + n + ' 项' : '恢复';

    // 先落到左上角量出实际尺寸，再按视口边界回缩
    ctxMenu.style.left = '0px';
    ctxMenu.style.top = '0px';
    ctxMenu.style.display = 'block';
    var w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
    var x = e.clientX, y = e.clientY;
    if (x + w > window.innerWidth - 8) x = Math.max(8, window.innerWidth - w - 8);
    if (y + h > window.innerHeight - 8) y = Math.max(8, e.clientY - h);
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
  }

  ctxDownload.addEventListener('click', function () {
    if (ctxTarget && ctxTarget.type === 'file') window.open('/file/' + ctxTarget.data.id, '_blank');
  });

  ctxRename.addEventListener('click', function () { hideContextMenu(); startRename(ctxTarget); });

  // ===== 批量操作 =====
  function sourceOf(entry) {
    return entry.type === 'file' ? entry.data.id : entry.data.path;
  }

  // status 一并返回，409 的同名冲突要靠它判断是否弹窗
  function req(url, body) {
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { status: r.status, data: d || {} };
      });
    }).catch(function () {
      return { status: 0, data: { error: '网络错误' } };
    });
  }

  // 串行执行：后一项的判断依赖前一项写库的结果，并发会基于同一份过期状态做决定
  async function runBatch(list, makeOp) {
    var st = { ok: 0, skip: 0, fail: 0, error: '', cancelled: false };
    var auto = '';
    for (var i = 0; i < list.length; i++) {
      var op = makeOp(list[i], auto);
      var r = await req(op.url, op.body);
      var d = r.data;

      if (r.status === 409 && d.conflict) {
        // 已勾选应用到全部时沿用同一策略，不再逐项询问
        var answer = auto ? { choice: auto, all: true } : await askConflict(d, list.length - i);
        if (!answer) { st.cancelled = true; break; }
        if (answer.all) auto = answer.choice;
        op = makeOp(list[i], answer.choice);
        r = await req(op.url, op.body);
        d = r.data;
      }

      if (r.status === 200 && d.ok) { if (d.skipped) st.skip++; else st.ok++; }
      else {
        st.fail++;
        if (!st.error) st.error = d.error || ('操作失败 (' + r.status + ')');
      }
    }
    return st;
  }

  function summaryText(st) {
    var parts = [];
    if (st.ok) parts.push('成功 ' + st.ok + ' 项');
    if (st.skip) parts.push('跳过 ' + st.skip + ' 项');
    if (st.fail) parts.push('失败 ' + st.fail + ' 项');
    if (st.cancelled) parts.push('已取消，剩余项未处理');
    if (st.error) parts.push(st.error);
    return parts.length ? parts.join('，') : '没有可操作的项';
  }

  // 批量执行期间锁住工具条，避免连点重复提交
  function guard(fn) {
    return async function () {
      if (batchRunning) return;
      batchRunning = true;
      batchBar.classList.add('busy');
      try { await fn.apply(null, arguments); }
      finally { batchRunning = false; batchBar.classList.remove('busy'); }
    };
  }

  var runDelete = guard(async function () {
    var list = selection();
    if (!list.length) return;
    var tip = list.length > 1
      ? '确定删除选中的 ' + list.length + ' 项并放入回收站？'
      : '确定删除并放入回收站？';
    if (!confirm(tip)) return;
    var st = await runBatch(list, function (item) {
      return {
        url: '/api/delete',
        body: item.type === 'dir' ? { type: 'dir', path: item.data.path } : { type: 'file', id: item.data.id }
      };
    });
    showStatus(summaryText(st));
    clearSelection();
    load();
  });

  // 恢复目录会连带恢复其中所有层级的内容，因此位于其它选中目录之下（文件还包括父目录本身）的条目不必再单独恢复
  function pruneRestore(list) {
    var dirs = [];
    for (var i = 0; i < list.length; i++) if (list[i].type === 'dir') dirs.push(list[i].data.path);
    var out = [];
    for (var j = 0; j < list.length; j++) {
      var item = list[j];
      var p = item.type === 'dir' ? item.data.path : (item.data.originalPath || '');
      var covered = false;
      for (var k = 0; k < dirs.length; k++) {
        var d = dirs[k];
        if (p.slice(0, d.length + 1) === d + '/' || (item.type === 'file' && p === d)) { covered = true; break; }
      }
      if (!covered) out.push(item);
    }
    return out;
  }

  function depthOf(entry) {
    var p = entry.type === 'dir' ? entry.data.path : (entry.data.originalPath || '');
    return p ? p.split('/').length : 0;
  }

  var runRestore = guard(async function () {
    var list = pruneRestore(selection());
    list.sort(function (a, b) { return depthOf(a) - depthOf(b); });
    if (!list.length) return;
    var st = await runBatch(list, function (item) {
      return { url: '/api/restore', body: { type: item.type, id: item.type === 'dir' ? item.data.path : item.data.id } };
    });
    showStatus(summaryText(st));
    clearSelection();
    load();
  });

  ctxDelete.addEventListener('click', function () { hideContextMenu(); runDelete(); });
  ctxRestore.addEventListener('click', function () { hideContextMenu(); runRestore(); });
  bbDelete.addEventListener('click', runDelete);
  bbRestore.addEventListener('click', runRestore);
  bbRename.addEventListener('click', function () {
    var list = selection();
    if (list.length === 1) startRename(list[0]);
  });
  bbClear.addEventListener('click', function () { clearSelection(); });

  selAll.addEventListener('change', function () {
    var on = selAll.checked;
    for (var i = 0; i < rows.length; i++) markEntry(rows[i], on);
    refreshBatchBar();
  });

  listEl.addEventListener('click', function (e) {
    if (e.target === listEl) clearSelection();
  });

  // ===== 同名冲突弹窗 =====
  var cfOverlay = document.getElementById('cfOverlay');
  var cfDesc = document.getElementById('cfDesc');
  var cfOverwrite = document.getElementById('cfOverwrite');
  var cfOverwriteSub = document.getElementById('cfOverwriteSub');
  var cfAllWrap = document.getElementById('cfAllWrap');
  var cfAll = document.getElementById('cfAll');
  var cfOk = document.getElementById('cfOk');
  var cfCancel = document.getElementById('cfCancel');
  var cfResolve = null;

  function pickChoice(choice) {
    var radios = cfOverlay.querySelectorAll('input[name="cfChoice"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === choice;
  }

  // 单个冲突时的选择；取消返回 null，调用方据此中止整批操作
  function askConflict(info, remaining) {
    return new Promise(function (resolve) {
      cfResolve = resolve;
      cfDesc.textContent = '目标位置已包含名为“' + info.clashName + '”的'
        + (info.clashKind === 'dir' ? '文件夹' : '文件') + '，请选择如何处理。';
      // 回收站中的目录仍占用路径，服务端无法合并替换，因此目录冲突不提供替换
      var canReplace = info.clashKind !== 'dir';
      cfOverwrite.className = 'cf-opt' + (canReplace ? '' : ' off');
      cfOverwriteSub.textContent = canReplace
        ? '同名项目会被移入回收站，仍可再恢复。'
        : '文件夹同名时不支持替换，请选择保留两者或跳过。';
      pickChoice(canReplace ? 'overwrite' : 'rename');
      cfAll.checked = false;
      // 只剩这一项时“应用到全部”无意义
      cfAllWrap.style.display = remaining > 1 ? 'flex' : 'none';
      cfOverlay.style.display = 'flex';
    });
  }

  cfOk.addEventListener('click', function () {
    var chosen = cfOverlay.querySelector('input[name="cfChoice"]:checked');
    var resolve = cfResolve;
    cfResolve = null;
    cfOverlay.style.display = 'none';
    if (resolve) resolve({ choice: chosen ? chosen.value : 'rename', all: cfAll.checked });
  });

  cfCancel.addEventListener('click', function () {
    var resolve = cfResolve;
    cfResolve = null;
    cfOverlay.style.display = 'none';
    if (resolve) resolve(null);
  });

  // ===== 移动/复制弹窗 =====
  var modalOverlay = document.getElementById('modalOverlay');
  var modalTitle = document.getElementById('modalTitle');
  var targetPathInput = document.getElementById('targetPathInput');
  var treeBox = document.getElementById('treeBox');
  var modalConfirm = document.getElementById('modalConfirm');
  var modalCancel = document.getElementById('modalCancel');
  var currentAction = '';
  var modalItems = null;

  function openModal(action, list) {
    if (!list || !list.length) return;
    currentAction = action;
    modalItems = list;
    modalTitle.textContent = (action === 'move' ? '移动到' : '复制到')
      + (list.length > 1 ? ' ' + list.length + ' 项' : '');
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

  var runMoveCopy = guard(async function (action, list, targetDir) {
    var st = await runBatch(list, function (item, onConflict) {
      var body = { type: item.type, source: sourceOf(item), targetDir: targetDir };
      if (onConflict) body.onConflict = onConflict;
      return { url: '/api/' + action, body: body };
    });
    showStatus(summaryText(st));
    clearSelection();
    load();
  });

  modalConfirm.addEventListener('click', function () {
    modalOverlay.style.display = 'none';
    if (modalItems && modalItems.length) runMoveCopy(currentAction, modalItems, targetPathInput.value.trim());
    modalItems = null;
  });

  ctxMove.addEventListener('click', function () { openModal('move', selection()); });
  ctxCopy.addEventListener('click', function () { openModal('copy', selection()); });
  bbMove.addEventListener('click', function () { openModal('move', selection()); });
  bbCopy.addEventListener('click', function () { openModal('copy', selection()); });

  // ===== 行内重命名 =====
  function startRename(entry) {
    if (!entry || isTrashView || entry.renameEl) return;
    var data = entry.data;
    var input = document.createElement('input');
    input.className = 'rename-input';
    input.type = 'text';
    input.value = data.name;
    entry.nameEl.style.display = 'none';
    entry.rowEl.insertBefore(input, entry.nameEl);
    entry.renameEl = input;
    input.focus();
    // 默认只选中主名，扩展名保持不动
    var dot = data.name.lastIndexOf('.');
    input.setSelectionRange(0, entry.type === 'file' && dot > 0 ? dot : data.name.length);

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      if (input.parentNode) input.parentNode.removeChild(input);
      entry.nameEl.style.display = '';
      entry.renameEl = null;
    }

    async function commit() {
      var newName = input.value.trim();
      close();
      if (!newName || newName === data.name) return;
      var r = await req('/api/rename', { type: entry.type, source: sourceOf(entry), newName: newName });
      if (r.data.ok) { showStatus('已重命名为 ' + r.data.name); load(); }
      else showStatus(r.data.error || '重命名失败');
    }

    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', close);
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('contextmenu', function (e) { e.stopPropagation(); });
  }

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

    var entry = { type: type, data: data, key: rowKey(type, data), index: rows.length, rowEl: row, renameEl: null };
    rows.push(entry);

    var check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'selbox';
    // 修饰键只在 click 里可见，浏览器随后才派发 change，所以先记下来再交给 toggleEntry
    check.addEventListener('click', function (e) { lastMods = { shift: e.shiftKey }; });
    // 监听 change 而不是 click：checked 由浏览器维护，click 里 preventDefault 也拦不住它回写
    check.addEventListener('change', function () { toggleEntry(entry, lastMods, true); });

    var ico = document.createElement('span');
    ico.className = 'ico';
    ico.innerHTML = type === 'dir' ? folderSvg : fileSvg;

    var name = document.createElement('a');
    if (type === 'dir') {
      name.className = 'name';
      name.href = '/' + encodeURIComponent(data.path);
      name.textContent = data.name + '/';
    } else {
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

    entry.nameEl = name;
    entry.checkEl = check;

    row.appendChild(check);
    row.appendChild(ico);
    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(date);
    row.addEventListener('contextmenu', function (e) { showContextMenu(e, entry); });

    // 点名称仍是打开/进入，按住 Ctrl 或 Shift 才改成加选
    name.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); toggleEntry(entry, { shift: e.shiftKey }, false); }
      else selectOnly(entry);
    });
    row.addEventListener('click', function (e) {
      if (e.target === check || e.target === name) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); toggleEntry(entry, { shift: e.shiftKey }, false); }
      else selectOnly(entry);
    });

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
    // 换一次列表就换了一批可选项，选择状态不跨目录、跨视图保留
    rows = [];
    clearSelection(false);

    var paint = function (data) {
      renderList(data);
      refreshBatchBar();
    };
    var fail = function () {
      listEl.innerHTML = '<li class="empty">加载失败</li>';
      refreshBatchBar();
    };

    if (isTrashView) {
      pageTitle.textContent = '回收站';
      trashBtn.classList.add('active');
      mkdirBtn.style.display = 'none';
      uploadBtn.style.display = 'none';
      fetch('/api/trash').then(function (r) { return r.json(); }).then(paint).catch(fail);
    } else {
      pageTitle.textContent = 'File-Go！';
      trashBtn.classList.remove('active');
      mkdirBtn.style.display = 'inline-flex';
      uploadBtn.style.display = 'inline-flex';
      fetch('/api/list?path=' + encodeURIComponent(currentPath))
        .then(function (r) { return r.json(); }).then(paint).catch(fail);
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

  // 128 位随机，够避免撞别人的键；撞键会让上传被错误重放
  function genUploadKey() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  function addFiles(files) {
    var added = 0, skipped = 0, oversize = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      // 拖拽进来的文件夹在浏览器里是 size 为 0 的条目
      if (f.size === 0) { skipped++; continue; }
      var item = {
        file: f, name: f.name, size: f.size,
        path: currentPath, loaded: 0, status: 'waiting', error: '',
        attempt: 0, nextAt: 0, uploadKey: genUploadKey()
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

  // 未到 nextAt 的退避项不参与排队，否则 done() 里的 pump 会绕过后退时间立刻重发
  function pump() {
    var now = Date.now();
    while (running < CONCURRENCY) {
      var next = null;
      for (var i = 0; i < queue.length; i++) {
        var it = queue[i];
        if (it.status === 'waiting' && it.nextAt <= now) { next = it; break; }
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
    // 服务器按这个键重放首次结果，重试不会再往 Telegram 存第二份
    form.append('uploadKey', item.uploadKey);

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
      } else if ((xhr.status === 429 || xhr.status >= 500) && item.attempt < MAX_RETRY) {
        // 429 与 5xx 都可能已经有副作用，靠 uploadKey 重放兜底；400/413 是明确拒绝，不重试
        retryLater(item, (d && d.error) || '请求过于频繁');
      } else {
        item.status = 'error';
        item.error = (d && d.error) || ('上传失败 (' + xhr.status + ')');
      }
      done(item);
    };
    xhr.onerror = function () {
      // 断连时文件可能已经落库，重试会拿回原结果而不是重复存一份
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
    item.nextAt = Date.now() + 2000 * item.attempt;
    setTimeout(pump, item.nextAt - Date.now());
  }

  function done(item) {
    running = Math.max(0, running - 1);
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
      item.nextAt = 0;
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
