// 文件夹 / 文件图标：16px 线条 SVG，颜色跟随 currentColor，随文字大小对齐。
// 与旧版单文件页面保持一致，只通过 FG 暴露。
export function iconsModule(FG) {
  const folder =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

  const file =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>' +
    '<path d="M14 3v5h5"/></svg>';

  FG.icons = {
    folder: folder,
    file: file,
    // 供列表/目录树统一取值，避免各处自己判断 kind。
    of: function (kind) {
      return kind === 'dir' ? folder : file;
    },
  };
}
