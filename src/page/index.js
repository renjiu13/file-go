// 渲染首页：文件资源管理器风格交互。
// 骨架在这里拼接，样式见 style.js，交互脚本见 app.js；三段产物拼起来必须和拆分前逐字节一致。
import { CSS } from './style.js';
import { APP } from './app.js';

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
      <span style="width: 6px;"></span>
      <button class="icon-btn" id="btnTrash" title="回收站">回收站</button>
    </div>
  </div>
  <nav class="breadcrumb" id="breadcrumb"></nav>
  <input type="file" id="fileInput" hidden multiple>
  <ul id="list" tabindex="0" style="outline:none;"></ul>
</div>

<div class="status" id="status"></div>

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

export function renderPage() {
  return PRE + CSS + MID + APP + POST;
}
