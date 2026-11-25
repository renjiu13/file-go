// 通用交互：模态框、提示条、冲突选择、目录选择、进度面板。
// 所有函数只通过 FG 暴露，不依赖模块作用域。
export function uiModule(FG) {
  const $ = (id) => document.getElementById(id);
  let activeModal = null;
  let toastTimer = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(msg, isError) {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('show');
    el.classList.toggle('error', !!isError);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 4200 : 2400);
  }

  function modal(opts) {
    const overlay = $('modal');
    const titleEl = $('modalTitle');
    const bodyEl = $('modalBody');
    const actionsEl = $('modalActions');
    titleEl.textContent = opts.title || '';
    bodyEl.innerHTML = '';
    if (typeof opts.body === 'string') bodyEl.innerHTML = opts.body;
    else if (opts.body) bodyEl.appendChild(opts.body);
    actionsEl.innerHTML = '';
    return new Promise((resolve) => {
      const finish = (v) => {
        if (activeModal !== finish) return;
        activeModal = null;
        overlay.classList.remove('show');
        resolve(v);
      };
      activeModal = finish;
      const buttons = opts.buttons || [
        { label: '取消', value: null },
        { label: '确定', value: 'ok', primary: true },
      ];
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
        btn.textContent = b.label;
        if (b.disabled) btn.disabled = true;
        btn.addEventListener('click', () => {
          const v = typeof b.value === 'function' ? b.value() : b.value;
          finish(v);
        });
        actionsEl.appendChild(btn);
      }
      overlay.classList.add('show');
      if (typeof opts.onMount === 'function') opts.onMount(bodyEl, finish);
      setTimeout(() => {
        const input = bodyEl.querySelector('input[type=text], input[type=search], textarea');
        if (input) {
          input.focus();
          if (input.select) input.select();
        }
      }, 30);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeModal) {
      e.preventDefault();
      activeModal(null);
    }
  });

  function prompt(opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.className = 'modal-input';
    input.type = 'text';
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    const hint = document.createElement('div');
    hint.className = 'modal-hint';
    hint.textContent = opts.hint || '';
    wrap.appendChild(input);
    wrap.appendChild(hint);
    return modal({
      title: opts.title || '输入名称',
      body: wrap,
      buttons: [
        { label: '取消', value: null },
        { label: opts.okText || '确定', primary: true, value: () => input.value.trim() },
      ],
      onMount: (body, finish) => {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(input.value.trim());
          }
        });
        input.addEventListener('input', () => {
          const err = FG.naming.nameError(input.value.trim());
          hint.textContent = err || opts.hint || '';
          hint.style.color = err ? '#d33' : '#888';
        });
      },
    });
  }

  function confirm(opts) {
    opts = opts || {};
    const body = document.createElement('div');
    body.textContent = opts.message || '';
    return modal({
      title: opts.title || '请确认',
      body,
      buttons: [
        { label: '取消', value: false },
        { label: opts.okText || '确定', primary: !opts.danger, danger: !!opts.danger, value: true },
      ],
    }).then((v) => v === true);
  }

  function conflict(name) {
    const body = document.createElement('div');
    body.innerHTML =
      '<div class="conflict-info"><div><span class="label">名称：</span>' +
      esc(name) +
      '</div><div class="conflict-sub">目标位置已存在同名项，请选择处理方式。</div></div>' +
      '<div class="conflict-options">' +
      '<label><input type="radio" name="cf" value="keep-both" checked> 保留两者（自动改名）</label>' +
      '<label><input type="radio" name="cf" value="replace"> 替换已有文件</label>' +
      '<label><input type="radio" name="cf" value="skip"> 跳过</label>' +
      '</div>' +
      '<label class="apply-all"><input type="checkbox" id="cf-all"> 对后续同名项应用相同选择</label>';
    return modal({
      title: '发现同名项',
      body,
      buttons: [
        { label: '取消', value: null },
        {
          label: '确定',
          primary: true,
          value: () => {
            const checked = body.querySelector('input[name=cf]:checked');
            const all = body.querySelector('#cf-all');
            return { mode: checked ? checked.value : 'keep-both', applyAll: !!(all && all.checked) };
          },
        },
      ],
    });
  }

  // 目录选择：返回 { dirId } 或 null；dirId 为 null 表示根目录
  async function chooseDir(opts) {
    opts = opts || {};
    const res = await FG.api('/api/tree');
    const tree = res.ok && res.data && Array.isArray(res.data.tree) ? res.data.tree : [];
    const list = document.createElement('div');
    list.className = 'tree-box';
    let selected = opts.currentId == null ? null : opts.currentId;
    const entries = [{ id: null, path: '全部文件' }].concat(tree);
    for (const d of entries) {
      const row = document.createElement('div');
      row.className = 'tree-item' + (String(d.id) === String(selected) ? ' selected' : '');
      row.textContent = d.path || '全部文件';
      row.addEventListener('click', () => {
        list.querySelectorAll('.tree-item').forEach((x) => x.classList.remove('selected'));
        row.classList.add('selected');
        selected = d.id;
      });
      list.appendChild(row);
    }
    return modal({
      title: opts.title || '选择目录',
      body: list,
      buttons: [
        { label: '取消', value: null },
        { label: opts.okText || '确定', primary: true, value: () => ({ dirId: selected }) },
      ],
    });
  }

  let panel = null;
  function progressPanel() {
    if (!panel) panel = document.getElementById('uploads');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'uploads';
      document.body.appendChild(panel);
    }
    return panel;
  }

  function createProgress(name) {
    const host = progressPanel();
    const row = document.createElement('div');
    row.className = 'upload-row';
    row.innerHTML =
      '<div class="upload-top"><span class="upload-name">' + esc(name) + '</span><span class="upload-pct">0%</span></div>' +
      '<div class="upload-bar-wrap"><div class="upload-bar"></div></div>';
    const pct = row.querySelector('.upload-pct');
    const bar = row.querySelector('.upload-bar');
    const btn = document.createElement('button');
    btn.className = 'upload-cancel';
    btn.textContent = '取消';
    row.appendChild(btn);
    host.appendChild(row);
    let onCancel = null;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      if (onCancel) onCancel();
    });
    return {
      setCancel(fn) {
        onCancel = fn;
      },
      update(ratio, label) {
        const p = Math.max(0, Math.min(100, Math.round(ratio * 100)));
        bar.style.width = p + '%';
        pct.textContent = label || p + '%';
      },
      done() {
        row.classList.add('done');
        pct.textContent = '完成';
        btn.remove();
        setTimeout(() => row.remove(), 4000);
      },
      fail(msg) {
        row.classList.add('failed');
        pct.textContent = msg || '失败';
        btn.remove();
        setTimeout(() => row.remove(), 8000);
      },
      remove() {
        row.remove();
      },
    };
  }

  FG.ui = {
    esc,
    toast,
    modal,
    prompt,
    confirm,
    conflict,
    chooseDir,
    progress: { create: createProgress },
  };
}
