// 回收站：按删除日期分组展示，只列出顶层项（服务端只返回 id = trash_id 的行）。
export function trashModule(FG) {
  function fmtGroup(date) {
    const s = String(date || '');
    if (s.length === 8) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    return s;
  }

  function items() {
    const groups = FG.state.trashGroups || [];
    const out = [];
    for (const g of groups) {
      const label = fmtGroup(g.date);
      for (const it of g.items || []) {
        out.push(Object.assign({}, it, { group: label, trashTag: true }));
      }
    }
    return out;
  }

  function rows(list, rowFn) {
    let html = '';
    let last = null;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.group !== last) {
        html += '<li class="date-group">' + FG.listing.esc(it.group) + '</li>';
        last = it.group;
      }
      html += rowFn(it, i);
    }
    return html;
  }

  FG.trash = { items, rows };
}
