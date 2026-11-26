// 渲染入口页：骨架 + 样式 + 内联脚本。
// 各交互模块是普通函数，这里把函数源码按顺序拼接后在浏览器里执行；
// 这样模块文件能被 check-inline 检查，也不需要处理模板字符串转义。
import { CSS } from './style.js';
import { iconsModule } from './icons.js';
import { namingModule } from './naming.js';
import { uiModule } from './ui.js';
import { selectionModule } from './selection.js';
import { listingModule } from './listing.js';
import { trashModule } from './trash.js';
import { uploadModule } from './upload.js';
import { downloadModule } from './download.js';
import { contextmenuModule } from './contextmenu.js';
import { appModule } from './app.js';

const MODULES = [
  iconsModule,
  namingModule,
  uiModule,
  selectionModule,
  listingModule,
  trashModule,
  uploadModule,
  downloadModule,
  contextmenuModule,
  appModule,
];

const PRE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>File-Go！</title>
<style>`;

const MID = `</style>
</head>
<body>
<div class="container">
  <div class="title-row">
    <h1 id="pageTitle">File-Go！</h1>
    <div class="actions" id="toolbar">
      <button class="icon-btn" id="btnMkdir" title="新建文件夹">新建文件夹</button>
      <button class="icon-btn" id="btnUpload" title="上传文件">上传文件</button>
      <!-- 默认藏好，由 loadAuth 按登录态决定显示，避免访客看到按钮闪一下 -->
      <button class="icon-btn" id="btnTrash" title="回收站" style="display:none;">回收站</button>
      <span class="toolbar-sep"></span>
      <select class="sort-select" id="sort" title="排序">
        <option value="name">名称</option>
        <option value="date">时间</option>
        <option value="size">大小</option>
      </select>
      <button class="icon-btn" id="btnRefresh" title="刷新">刷新</button>
      <a class="icon-btn" id="btnAuth" href="/login" style="display:none;">登录</a>
    </div>
  </div>
  <nav class="breadcrumb" id="breadcrumb"></nav>
  <div class="list-head"><span class="sel-info" id="selInfo"></span></div>
  <input type="file" id="fileInput" hidden multiple>
  <ul id="list" tabindex="0" style="outline:none;"></ul>
  <footer class="footer">由A,wang@2026 ws驱动</footer>
</div>

<div class="status" id="status"></div>
<div id="uploads"></div>

<!-- 右键菜单 -->
<div id="ctx-menu"></div>

<!-- 通用 Modal 容器 -->
<div class="modal-overlay" id="modal">
  <div class="modal-content" id="modalContent">
    <div class="modal-title" id="modalTitle"></div>
    <div class="modal-body" id="modalBody"></div>
    <div class="modal-actions" id="modalActions"></div>
  </div>
</div>

<script>`;

const POST = `</script>
</body>
</html>`;

function buildApp() {
  // esbuild 的 keepNames（wrangler 默认开着）会把函数包成 __name(fn, "name")，
  // 这些引用随函数源码一起进页面，而定义只活在 Worker 的模块作用域里，
  // 浏览器一执行到就 ReferenceError，整页脚本静默报废。兜一层，页面不再依赖打包配置。
  const parts = [
    'var FG = {};var __name = function (fn) { return fn; };',
  ];
  for (const mod of MODULES) parts.push('(' + mod.toString() + ')(FG);');
  return parts.join('\n');
}

export function renderPage() {
  return PRE + CSS + MID + buildApp() + POST;
}
