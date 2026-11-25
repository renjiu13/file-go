// 自定义右键菜单：列表行与空白区域各有一套菜单项。
export function contextmenuModule(FG) {
  function hide() {
    const m = document.getElementById('ctx-menu');
    if (m) m.style.display = 'none';
  }

  function entry(label, fn, opts) {
    opts = opts || {};
    const div = document.createElement('div');
    div.className = 'ctx-item' + (opts.danger ? ' danger' : '') + (opts.disabled ? ' disabled' : '');
    div.textContent = label;
    if (!opts.disabled) {
      div.addEventListener('click', () => {
        hide();
        fn();
      });
    }
    return div;
  }

  function sep() {
    const d = document.createElement('div');
    d.className = 'ctx-sep';
    return d;
  }

  function show(x, y) {
    const m = document.getElementById('ctx-menu');
    if (!m) return;
    m.style.display = 'block';
    m.style.left = '0px';
    m.style.top = '0px';
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 6)) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 6)) + 'px';
  }

  function clear() {
    const m = document.getElementById('ctx-menu');
    if (!m) return;
    m.innerHTML = '';
  }

  function buildForItems(items, clicked) {
    clear();
    const m = document.getElementById('ctx-menu');
    const many = items.length > 1;
    if (FG.state.trashMode) {
      m.appendChild(entry(many ? '恢复所选 ' + items.length + ' 项' : '恢复', () => FG.app.restoreItems(items.map((x) => x.id))));
      return;
    }
    if (many) {
      const label = '已选 ' + items.length + ' 项';
      m.appendChild(entry(label, () => {}, { disabled: true }));
      m.appendChild(sep());
      m.appendChild(entry('移动到…', () => FG.app.moveItems(items)));
      m.appendChild(entry('复制到…', () => FG.app.copyItems(items)));
      m.appendChild(sep());
      m.appendChild(entry('删除', () => FG.app.deleteItems(items), { danger: true }));
      return;
    }
    const it = clicked;
    m.appendChild(entry(it.kind === 'dir' ? '打开' : '打开/预览', () => FG.app.openItem(it)));
    if (it.kind === 'file') {
      m.appendChild(entry('下载', () => FG.app.downloadItem(it)));
      m.appendChild(entry('复制链接', () => FG.app.copyLink(it)));
    }
    m.appendChild(sep());
    m.appendChild(entry('重命名', () => FG.app.renameItem(it)));
    m.appendChild(entry('移动到…', () => FG.app.moveItems([it])));
    m.appendChild(entry('复制到…', () => FG.app.copyItems([it])));
    m.appendChild(sep());
    m.appendChild(entry('删除', () => FG.app.deleteItems([it]), { danger: true }));
  }

  function buildBlank() {
    clear();
    const m = document.getElementById('ctx-menu');
    m.appendChild(entry('新建文件夹', () => FG.app.mkdir()));
    m.appendChild(entry('上传文件', () => FG.app.pickUpload()));
    m.appendChild(sep());
    m.appendChild(entry(FG.state.trashMode ? '返回文件' : '回收站', () => FG.app.toggleTrash()));
    m.appendChild(entry('刷新', () => FG.app.refresh()));
  }

  function attach() {
    document.addEventListener('contextmenu', (e) => {
      const list = document.getElementById('list');
      if (!list || !list.contains(e.target)) return;
      e.preventDefault();
      const row = e.target.closest('.row');
      if (!row) {
        buildBlank();
        show(e.clientX, e.clientY);
        return;
      }
      const item = FG.listing.byId(row.dataset.id);
      if (!item) return;
      if (!FG.state.selected.has(item.id)) FG.listing.selectOnly(Number(row.dataset.idx));
      const sel = FG.listing.selectedItems();
      const targets = sel.length > 1 && FG.state.selected.has(item.id) ? sel : [item];
      buildForItems(targets, item);
      show(e.clientX, e.clientY);
    });
    document.addEventListener('click', hide);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
  }

  FG.contextmenu = { attach, hide };
}
