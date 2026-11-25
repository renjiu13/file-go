// 键盘交互：方向键移动焦点、Shift/Ctrl 扩选、Enter 打开、F2 重命名、Delete 删除。
// 列表点击里的 Shift/Ctrl 选择在 listing.js 中处理，这里只管键盘。
export function selectionModule(FG) {
  function isTyping(e) {
    const t = e.target;
    if (!t) return false;
    const tag = (t.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function modalOpen() {
    const m = document.getElementById('modal');
    return !!(m && m.classList.contains('show'));
  }

  function onKey(e) {
    if (modalOpen()) return;
    if (isTyping(e)) return;
    const list = FG.listing.items();
    const n = list.length;
    const cur = FG.state.focusIdx;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!n) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = cur < 0 ? (delta > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, cur + delta));
      if (e.shiftKey) FG.listing.selectRange(next);
      else FG.listing.focusBy(next);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (!n) return;
      const next = e.key === 'Home' ? 0 : n - 1;
      if (e.shiftKey) FG.listing.selectRange(next);
      else FG.listing.focusBy(next);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      FG.listing.selectAll();
      return;
    }
    if (e.key === 'Escape') {
      FG.state.selected = new Set();
      FG.listing.render();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (n) FG.listing.toggle(cur < 0 ? 0 : cur);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const it = list[cur];
      if (it) FG.app.openItem(it);
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      const it = list[cur];
      if (it && !FG.state.trashMode) FG.app.renameItem(it);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      if (FG.state.trashMode) return;
      const sel = FG.listing.selectedItems();
      if (sel.length) FG.app.deleteItems(sel);
    }
  }

  FG.selection = {
    attach() {
      document.addEventListener('keydown', onKey);
    },
  };
}
