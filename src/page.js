// 渲染首页：上传组件 + 最近文件列表
export function renderPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>文件仓库</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #fafafa;
    color: #222;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .container {
    max-width: 720px;
    margin: 48px auto;
    padding: 0 20px;
  }
  h1 {
    font-size: 1.6rem;
    font-weight: 600;
    margin-bottom: 28px;
    color: #111;
    letter-spacing: -0.02em;
  }
  .card {
    background: #ffffff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 24px;
    margin-bottom: 20px;
  }
  .card h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 18px;
    color: #111;
  }
  .upload-row {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  input[type="file"] {
    flex: 1;
    min-width: 220px;
    padding: 8px 10px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fafafa;
    cursor: pointer;
    color: #555;
    font-size: 0.9rem;
  }
  input[type="file"]:hover {
    border-color: #bbb;
    background: #f5f5f5;
  }
  button {
    padding: 9px 22px;
    background: #222;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.95rem;
    font-weight: 500;
    transition: background 0.15s ease;
  }
  button:hover:not(:disabled) {
    background: #444;
  }
  button:disabled {
    background: #aaa;
    cursor: not-allowed;
  }
  progress {
    width: 100%;
    height: 8px;
    margin-top: 14px;
    border: none;
    border-radius: 4px;
    background: #eee;
    display: none;
  }
  progress::-webkit-progress-bar {
    background: #eee;
    border-radius: 4px;
  }
  progress::-webkit-progress-value {
    background: #666;
    border-radius: 4px;
    transition: width 0.1s linear;
  }
  .status {
    margin-top: 14px;
    font-size: 0.88rem;
    color: #888;
    min-height: 1.3em;
  }
  .status.error { color: #c0392b; }
  .status.success { color: #27ae60; }
  .result {
    margin-top: 10px;
    word-break: break-all;
    font-size: 0.9rem;
  }
  .result a {
    color: #333;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .result a:hover { color: #000; }
  .file-list {
    list-style: none;
  }
  .file-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid #f0f0f0;
    transition: background 0.1s;
  }
  .file-item:hover {
    background: #fafafa;
  }
  .file-item:last-child { border-bottom: none; }
  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 16px;
    font-size: 0.95rem;
  }
  .file-name a {
    color: #222;
    text-decoration: none;
  }
  .file-name a:hover { text-decoration: underline; }
  .file-meta {
    flex-shrink: 0;
    color: #999;
    font-size: 0.82rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    color: #bbb;
    text-align: center;
    padding: 32px 0;
    font-size: 0.9rem;
  }
  .footer {
    text-align: center;
    color: #bbb;
    font-size: 0.8rem;
    margin-top: 24px;
  }
</style>
</head>
<body>
<div class="container">
  <h1>文件仓库</h1>

  <div class="card">
    <h2>上传文件</h2>
    <div class="upload-row">
      <input type="file" id="fileInput">
      <button id="uploadBtn">上传</button>
    </div>
    <progress id="progress" value="0" max="100"></progress>
    <div class="status" id="status">最大 20MB</div>
    <div class="result" id="result"></div>
  </div>

  <div class="card">
    <h2>最近文件</h2>
    <ul class="file-list" id="fileList"></ul>
  </div>

  <div class="footer">Powered by Cloudflare Workers</div>
</div>

<script>
  var fileInput = document.getElementById('fileInput');
  var uploadBtn = document.getElementById('uploadBtn');
  var progress = document.getElementById('progress');
  var status = document.getElementById('status');
  var result = document.getElementById('result');
  var fileList = document.getElementById('fileList');

  var MAX_SIZE = 20 * 1024 * 1024;

  function formatSize(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function setStatus(text, type) {
    status.textContent = text;
    status.className = 'status' + (type ? ' ' + type : '');
  }

  function loadList() {
    fetch('/api/files')
      .then(function (r) { return r.json(); })
      .then(function (items) {
        fileList.innerHTML = '';
        if (!items || !items.length) {
          var li = document.createElement('li');
          li.className = 'empty';
          li.textContent = '暂无文件';
          fileList.appendChild(li);
          return;
        }
        items.forEach(function (it) {
          var li = document.createElement('li');
          li.className = 'file-item';

          var nameDiv = document.createElement('div');
          nameDiv.className = 'file-name';
          var a = document.createElement('a');
          a.href = '/file/' + it.id;
          a.textContent = it.name;
          nameDiv.appendChild(a);

          var metaDiv = document.createElement('div');
          metaDiv.className = 'file-meta';
          metaDiv.textContent = formatSize(it.size);

          li.appendChild(nameDiv);
          li.appendChild(metaDiv);
          fileList.appendChild(li);
        });
      })
      .catch(function () {
        fileList.innerHTML = '<li class="empty">加载失败</li>';
      });
  }

  uploadBtn.addEventListener('click', function () {
    var file = fileInput.files[0];
    if (!file) {
      setStatus('请先选择文件', 'error');
      return;
    }
    if (file.size > MAX_SIZE) {
      setStatus('文件不能超过 20MB', 'error');
      return;
    }

    uploadBtn.disabled = true;
    result.innerHTML = '';
    progress.style.display = 'block';
    progress.value = 0;
    setStatus('上传中 0%');

    var form = new FormData();
    form.append('file', file);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        var pct = Math.round((e.loaded / e.total) * 100);
        progress.value = pct;
        setStatus('上传中 ' + pct + '%');
      }
    };

    xhr.onload = function () {
      uploadBtn.disabled = false;
      progress.style.display = 'none';
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && data.url) {
        setStatus('上传成功', 'success');
        var a = document.createElement('a');
        a.href = data.url;
        a.textContent = data.url;
        result.appendChild(a);
        loadList();
      } else {
        setStatus(data.error || '上传失败', 'error');
      }
    };

    xhr.onerror = function () {
      uploadBtn.disabled = false;
      progress.style.display = 'none';
      setStatus('网络错误', 'error');
    };

    xhr.send(form);
  });

  // 回车也可触发上传
  fileInput.addEventListener('change', function () {
    setStatus(fileInput.files[0] ? fileInput.files[0].name : '最大 20MB');
  });

  loadList();
</script>
</body>
</html>`;
}
