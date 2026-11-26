// 列表：排序、选择、面包屑和行渲染。
// 数据来自 FG.state；本模块只负责把数据画出来并把点击翻译成选择/打开。
export function listingModule(FG) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtSize(n) {
    if (n == null || n === '') return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let v = Number(n);
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return (i === 0 ? String(v) : v.toFixed(v < 10 ? 2 : 1)) + ' ' + units[i];
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function items() {
    if (FG.state.trashMode) return FG.trash.items();
    const dirs = FG.state.dirs.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
    const files = FG.state.files.slice();
    const sort = FG.state.sort;
    files.sort((a, b) => {
      if (sort === 'size') return (b.size || 0) - (a.size || 0) || String(a.name).localeCompare(String(b.name));
      if (sort === 'date') return (b.createdAt || 0) - (a.createdAt || 0) || String(a.name).localeCompare(String(b.name));
      return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    });
    return dirs.concat(files);
  }

  function byId(id) {
    const all = items();
    for (const it of all) if (String(it.id) === String(id)) return it;
    return null;
  }

  function selectedItems() {
    const all = items();
    const sel = FG.state.selected;
    return all.filter((it) => sel.has(it.id));
  }

  function rowHtml(item, idx) {
    const isDir = item.kind === 'dir';
    const sel = FG.state.selected.has(item.id);
    const focus = idx === FG.state.focusIdx;
    const date = isDir ? item.updatedAt || item.createdAt : item.createdAt;
    let extra = '';
    if (item.trashTag) extra += '<span class="trash-tag">回收站</span>';
    if (item.shareToken) extra += '<span class="share-tag">公开</span>';
    if (item.originalPath) extra += '<span class="orig">原位置：' + esc(item.originalPath) + '</span>';
    return (
      '<li><div class="row' + (sel ? ' selected' : '') + (focus ? ' focused' : '') +
      '" data-id="' + esc(item.id) + '" data-kind="' + esc(item.kind) + '" data-idx="' + idx + '">' +
      '<span class="ico">' + FG.icons.of(item.kind) + '</span>' +
      '<span class="name">' + esc(item.name) + extra + '</span>' +
      (isDir
        ? '<span class="size"></span>'
        : '<span class="size">' + fmtSize(item.size) + '</span>') +
      '<span class="date">' + fmtDate(date) + '</span>' +
      (FG.state.trashMode ? '<button class="btn-restore" type="button">恢复</button>' : '') +
      '</div></li>'
    );
  }

  function renderCrumbs() {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    if (FG.state.trashMode) {
      bc.innerHTML = '<span class="crumb-current">回收站</span>';
      return;
    }
    let html = '<a href="#" data-path="">全部文件</a>';
    for (const c of FG.state.crumbs || []) {
      html += '<span class="sep">/</span><a href="#" data-path="' + esc(c.path) + '">' + esc(c.name) + '</a>';
    }
    bc.innerHTML = html;
  }

  function updateToolbar() {
    const trash = FG.state.trashMode;
    // 访客的写入口一律置灰；这里每次渲染都会重写 disabled，所以登录态必须一起算进来
    const locked = trash || FG.state.anonymous;
    const bMkdir = document.getElementById('btnMkdir');
    const bUpload = document.getElementById('btnUpload');
    const bTrash = document.getElementById('btnTrash');
    if (bMkdir) bMkdir.disabled = locked;
    if (bUpload) bUpload.disabled = locked;
    if (bTrash) bTrash.textContent = trash ? '返回文件' : '回收站';
    const info = document.getElementById('selInfo');
    if (info) {
      const n = FG.state.selected.size;
      info.textContent = n ? '已选 ' + n + ' 项' : '';
    }
  }

  function render() {
    renderCrumbs();
    updateToolbar();
    const list = document.getElementById('list');
    if (!list) return;
    if (FG.state.loading) {
      list.innerHTML = '<li class="empty">加载中…</li>';
      return;
    }
    const all = items();
    if (FG.state.focusIdx != null && FG.state.focusIdx >= all.length) FG.state.focusIdx = all.length - 1;
    if (!all.length) {
      list.innerHTML = '<li class="empty">' + (FG.state.trashMode ? '回收站是空的' : '这个文件夹是空的') + '</li>';
      return;
    }
    let html = '';
    if (FG.state.trashMode) {
      html = FG.trash.rows(all, rowHtml);
    } else {
      for (let i = 0; i < all.length; i++) html += rowHtml(all[i], i);
    }
    list.innerHTML = html;
    const focused = list.querySelector('.row.focused');
    if (focused && focused.scrollIntoView) focused.scrollIntoView({ block: 'nearest' });
  }

  function selectOnly(idx) {
    const all = items();
    if (!all.length) {
      FG.state.selected = new Set();
      FG.state.focusIdx = -1;
      render();
      return;
    }
    const clamped = Math.max(0, Math.min(all.length - 1, idx));
    FG.state.selected = new Set([all[clamped].id]);
    FG.state.focusIdx = clamped;
    FG.state.anchorIdx = clamped;
    render();
  }

  function toggle(idx) {
    const all = items();
    if (!all[idx]) return;
    const id = all[idx].id;
    if (FG.state.selected.has(id)) FG.state.selected.delete(id);
    else FG.state.selected.add(id);
    FG.state.focusIdx = idx;
    FG.state.anchorIdx = idx;
    render();
  }

  function selectRange(toIdx) {
    const all = items();
    if (!all.length) return;
    const from = FG.state.anchorIdx == null ? 0 : FG.state.anchorIdx;
    const start = Math.max(0, Math.min(from, toIdx));
    const end = Math.min(all.length - 1, Math.max(from, toIdx));
    const next = new Set();
    for (let i = start; i <= end; i++) next.add(all[i].id);
    FG.state.selected = next;
    FG.state.focusIdx = toIdx;
    render();
  }

  function focusBy(idx) {
    selectOnly(idx);
  }

  function selectAll() {
    const all = items();
    FG.state.selected = new Set(all.map((it) => it.id));
    FG.state.focusIdx = all.length ? 0 : -1;
    render();
  }

  function attach() {
    const list = document.getElementById('list');
    if (!list) return;
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-restore');
      if (btn) {
        e.stopPropagation();
        const row = btn.closest('.row');
        if (row) FG.app.restoreItems([row.dataset.id]);
        return;
      }
      const row = e.target.closest('.row');
      if (!row) {
        FG.state.selected = new Set();
        render();
        return;
      }
      const idx = Number(row.dataset.idx);
      const all = items();
      const item = all[idx];
      if (!item) return;
      if (e.shiftKey) {
        selectRange(idx);
      } else if (e.ctrlKey || e.metaKey) {
        toggle(idx);
      } else {
        if (FG.state.selected.has(item.id) && FG.state.selected.size > 1) {
          // 点击已在选区内的项：保持多选，仅移动焦点
          FG.state.focusIdx = idx;
          FG.state.anchorIdx = idx;
          render();
        } else {
          selectOnly(idx);
        }
      }
    });
    list.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      const item = byId(row.dataset.id);
      if (item) FG.app.openItem(item);
    });
    const bc = document.getElementById('breadcrumb');
    if (bc) {
      bc.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-path]');
        if (!a) return;
        e.preventDefault();
        FG.app.navigate(a.dataset.path || '');
      });
    }
  }

  FG.listing = {
    items,
    byId,
    selectedItems,
    render,
    attach,
    selectOnly,
    selectRange,
    toggle,
    focusBy,
    selectAll,
    fmtSize,
    fmtDate,
    rowHtml,
    esc,
  };
}
