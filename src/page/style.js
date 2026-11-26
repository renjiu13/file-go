// 页面样式：纯黑白灰，只管外观，不含行为逻辑。
// 这是模板字符串：反斜杠要写两层，否则浏览器里的正则和转义会静默变形。
export const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    padding: 40px 20px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 14px; color: #111; background: #fff;
    -webkit-font-smoothing: antialiased; user-select: none;
  }
  .container {
    max-width: 960px; margin: 0 auto;
    min-height: calc(100vh - 80px); display: flex; flex-direction: column;
  }
  .title-row {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
  }
  h1 { font-size: 17px; font-weight: 600; margin: 0; }
  .actions { display: flex; gap: 6px; }
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    height: 30px; padding: 0 10px; border: 1px solid #ddd; border-radius: 5px;
    background: #fff; cursor: pointer; color: #333; font-size: 12px;
    transition: background 0.12s, border-color 0.12s;
  }
  .icon-btn:hover { background: #f5f5f5; border-color: #bbb; }
  .breadcrumb {
    font-size: 12px; color: #888; margin-bottom: 8px; overflow: hidden; white-space: nowrap;
  }
  .breadcrumb a { color: #555; text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; color: #111; }
  .breadcrumb .sep { margin: 0 5px; color: #ccc; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { border-bottom: 1px solid #f0f0f0; }
  .row {
    display: flex; align-items: center; padding: 7px 6px; border-radius: 3px;
    cursor: default; position: relative;
  }
  .row:hover { background: #f7f7f7; }
  .row.selected { background: #e8f0fe; }
  .row.focused::after {
    content: ''; position: absolute; inset: 1px; border: 1px dotted #999;
    border-radius: 2px; pointer-events: none;
  }
  .ico { flex-shrink: 0; width: 18px; margin-right: 8px; color: #888; display: inline-flex; align-items: center; line-height: 0; }
  .name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #111; text-decoration: none;
  }
  .name.file-link { cursor: pointer; }
  .name.file-link:hover { text-decoration: underline; }
  .name-input {
    flex: 1; min-width: 0; padding: 2px 6px; border: 1px solid #6699ff;
    border-radius: 2px; font-size: 14px; font-family: inherit; outline: none;
    background: #fff;
  }
  .name-error { color: #d33; font-size: 11px; margin-left: 8px; flex-shrink: 0; }
  .size, .date { color: #888; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .size { width: 72px; text-align: right; margin-left: 12px; }
  .date { width: 130px; text-align: right; margin-left: 12px; overflow: hidden; text-overflow: ellipsis; }
  .empty { color: #aaa; text-align: center; padding: 48px 0; font-size: 13px; }
  .footer { text-align: center; color: #bbb; font-size: 12px; padding: 16px 0 0; margin-top: auto; }
  /* bottom 抬高到页脚文字之上，否则居中的提示会和贴底的页脚叠在一起 */
  .status {
    position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%);
    background: #111; color: #fff; padding: 8px 16px; border-radius: 6px;
    font-size: 12px; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 100;
  }
  .status.show { opacity: 0.95; }

  /* 右键菜单 */
  #ctx-menu {
    position: fixed; display: none; background: #fff; border: 1px solid #ddd;
    border-radius: 5px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); z-index: 1600;
    padding: 4px 0; min-width: 160px;
  }
  .ctx-item {
    padding: 6px 16px; font-size: 12px; color: #333; cursor: pointer;
  }
  .ctx-item:hover { background: #f0f0f0; color: #000; }
  .ctx-item.danger { color: #d33; }
  .ctx-item.danger:hover { background: #fdf0f0; }
  .ctx-item.disabled { color: #bbb; cursor: default; background: transparent; }
  .ctx-sep { height: 1px; background: #eee; margin: 4px 0; }

  /* Modal */
  .modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.35);
    display: none; align-items: center; justify-content: center; z-index: 2000;
  }
  .modal-overlay.show { display: flex; }
  .modal-content {
    background: #fff; border-radius: 8px; padding: 20px; width: 90%; max-width: 420px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.2);
  }
  .modal-title { font-size: 15px; font-weight: 600; margin-bottom: 14px; }
  .modal-body { margin-bottom: 16px; font-size: 13px; color: #333; }
  .modal-input {
    width: 100%; padding: 7px 10px; border: 1px solid #ddd; border-radius: 4px;
    font-size: 13px; margin-bottom: 10px; outline: none; font-family: inherit;
  }
  .modal-input:focus { border-color: #999; }
  .tree-box {
    border: 1px solid #eee; border-radius: 4px; max-height: 180px; overflow-y: auto;
    margin-bottom: 12px; padding: 4px;
  }
  .tree-item { padding: 4px 8px; font-size: 12px; color: #555; cursor: pointer; border-radius: 3px; display: flex; align-items: center; gap: 4px; }
  .tree-item .ico { width: 16px; margin-right: 2px; }
  .tree-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tree-item:hover { background: #f0f0f0; color: #111; }
  .tree-item.selected { background: #e8f0fe; color: #111; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .btn {
    padding: 6px 16px; border-radius: 4px; font-size: 12px; cursor: pointer;
    border: 1px solid #ddd; background: #fff; font-family: inherit;
  }
  .btn:hover { background: #f5f5f5; }
  .btn.primary { background: #111; color: #fff; border-color: #111; }
  .btn.primary:hover { background: #333; }
  .btn.danger { background: #d33; color: #fff; border-color: #d33; }
  .btn.danger:hover { background: #b22; }
  .btn:disabled { opacity: 0.4; cursor: default; }

  /* 进度条 */
  .progress-wrap {
    width: 100%; height: 6px; background: #eee; border-radius: 3px; overflow: hidden; margin-bottom: 10px;
  }
  .progress-bar {
    height: 100%; background: #333; width: 0%; transition: width 0.2s;
  }
  .progress-text { font-size: 12px; color: #666; margin-bottom: 10px; }

  /* 结果汇总 */
  .result-summary {
    display: flex; gap: 20px; margin-bottom: 12px; font-size: 13px;
  }
  .result-summary .num { font-weight: 600; font-size: 18px; }
  .result-summary .ok .num { color: #2a7; }
  .result-summary .skip .num { color: #f90; }
  .result-summary .fail .num { color: #d33; }
  .result-list {
    max-height: 160px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px;
    padding: 6px; margin-bottom: 12px; font-size: 12px;
  }
  .result-item { padding: 3px 4px; color: #555; }
  .result-item .err { color: #d33; margin-left: 6px; }

  /* 冲突对话框 */
  .conflict-info {
    background: #f7f7f7; border-radius: 4px; padding: 10px 12px; margin-bottom: 12px; font-size: 12px;
  }
  .conflict-info .label { color: #888; }
  .conflict-options { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .conflict-options label {
    display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; padding: 4px 0;
  }
  .apply-all {
    display: flex; align-items: center; gap: 6px; font-size: 12px; color: #666;
    margin-bottom: 12px; padding-top: 8px; border-top: 1px solid #eee;
  }

  /* 日期分组（回收站） */
  .date-group {
    padding: 10px 6px 2px; color: #888; font-size: 11px;
    border-bottom: 1px solid #eee; margin-top: 6px; font-weight: 500;
  }
  .trash-tag {
    font-size: 10px; color: #f90; background: #fff5e6; padding: 1px 5px;
    border-radius: 3px; margin-left: 6px; flex-shrink: 0;
  }

  .share-tag {
    font-size: 10px; color: #2a7; background: #e9f8f1; padding: 1px 5px;
    border-radius: 3px; margin-left: 6px; flex-shrink: 0;
  }

  @media (max-width: 600px) {
    .date { width: 90px; }
    .size { display: none; }
    #uploads { left: 12px; right: 12px; width: auto; }
  }

  /* ---- 分片版本新增 ---- */
  .toolbar-sep { width: 1px; height: 18px; background: #eee; margin: 0 2px; }
  .sort-select {
    height: 30px; border: 1px solid #ddd; border-radius: 5px; background: #fff;
    font-size: 12px; padding: 0 6px; outline: none; font-family: inherit; color: #333;
  }
  .list-head { display: flex; justify-content: flex-end; height: 18px; margin-bottom: 2px; }
  .sel-info { font-size: 11px; color: #888; }
  .crumb-current { color: #111; }
  .status.error { background: #c22; }
  .row { min-height: 34px; }
  .orig {
    color: #aaa; font-size: 11px; margin-left: 8px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  li.date-group {
    border-bottom: 1px solid #eee; padding: 12px 6px 4px; color: #888;
    font-size: 11px; font-weight: 500;
  }
  .btn-restore {
    margin-left: 10px; padding: 2px 10px; font-size: 11px; border: 1px solid #ddd;
    border-radius: 4px; background: #fff; cursor: pointer; color: #333; flex-shrink: 0;
  }
  .btn-restore:hover { background: #f5f5f5; }
  #uploads {
    position: fixed; right: 18px; bottom: 18px; width: 320px; max-height: 45vh;
    overflow-y: auto; display: flex; flex-direction: column; gap: 8px; z-index: 1500;
  }
  .upload-row {
    background: #fff; border: 1px solid #e5e5e5; border-radius: 7px; padding: 10px 12px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.08); position: relative;
  }
  .upload-top { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 6px; }
  .upload-name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; color: #222;
  }
  .upload-pct { color: #777; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .upload-bar-wrap { height: 4px; background: #eee; border-radius: 2px; overflow: hidden; }
  .upload-bar { height: 100%; width: 0; background: #333; transition: width 0.2s; }
  .upload-cancel {
    position: absolute; right: 10px; bottom: 8px; border: none; background: transparent;
    color: #999; font-size: 11px; cursor: pointer; font-family: inherit;
  }
  .upload-row.done .upload-bar { background: #2a7; }
  .upload-row.failed .upload-bar { background: #d33; }
  .modal-hint { font-size: 11px; color: #888; margin-top: 2px; min-height: 14px; }
  .conflict-sub { margin-top: 4px; color: #888; }
`;
