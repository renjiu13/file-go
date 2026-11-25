// 应用入口：状态、API、路由与所有会改动数据的操作编排。
// 页面把各模块函数内联后按顺序执行，最后执行本模块并启动。
export function appModule(FG) {
  const state = {
    path: '',
    dirId: null,
    crumbs: [],
    dirs: [],
    files: [],
    trashMode: false,
    trashGroups: [],
    selected: new Set(),
    anchorIdx: -1,
    focusIdx: -1,
    query: '',
    sort: 'name',
    loading: true,
  };
  FG.state = state;

  FG.api = async function (path, opts) {
    opts = opts || {};
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) {
      init.method = opts.method || 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    if (opts.headers) Object.assign(init.headers, opts.headers);
    try {
      const res = await fetch(path, init);
      const type = res.headers.get('content-type') || '';
      const data = type.indexOf('json') >= 0 ? await res.json() : await res.text();
      return { status: res.status, ok: res.ok, data };
    } catch (err) {
      return { status: 0, ok: false, data: null, error: err };
    }
  };

  function apiPost(path, body) {
    return FG.api(path, { method: 'POST', body: body || {} });
  }

  function toast(msg, isError) {
    FG.ui.toast(msg, isError);
  }

  function pathFromHash() {
    let h = location.hash || '';
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.charAt(0) === '/') h = h.slice(1);
    if (!h) return '';
    return h
      .split('/')
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch (e) {
          return s;
        }
      })
      .join('/');
  }

  function writeHash(replace) {
    const enc = state.path ? '#/' + state.path.split('/').map(encodeURIComponent).join('/') : '#/';
    if (location.hash === enc) return;
    try {
      if (replace) history.replaceState(null, '', enc);
      else history.pushState(null, '', enc);
    } catch (e) {
      location.hash = enc;
    }
  }

  function knownNames() {
    return state.dirs.concat(state.files).map((x) => x.name);
  }

  async function load() {
    state.loading = true;
    state.selected = new Set();
    state.focusIdx = -1;
    state.anchorIdx = -1;
    FG.listing.render();
    const q = state.path ? '?path=' + encodeURIComponent(state.path) : '';
    const res = await FG.api('/api/list' + q);
    state.loading = false;
    if (res.status === 404) {
      toast('目录不存在，已返回根目录', true);
      state.path = '';
      state.dirId = null;
      state.crumbs = [];
      state.dirs = [];
      state.files = [];
      writeHash(true);
      FG.listing.render();
      return;
    }
    if (!res.ok) {
      toast((res.data && res.data.error) || '加载失败', true);
      FG.listing.render();
      return;
    }
    const d = res.data || {};
    state.path = d.path || '';
    state.dirId = d.dirId || null;
    state.crumbs = d.crumbs || [];
    state.dirs = d.dirs || [];
    state.files = d.files || [];
    FG.listing.render();
  }

  async function loadTrash() {
    state.loading = true;
    state.selected = new Set();
    state.focusIdx = -1;
    state.anchorIdx = -1;
    FG.listing.render();
    const res = await FG.api('/api/trash');
    state.loading = false;
    if (!res.ok) {
      toast((res.data && res.data.error) || '回收站加载失败', true);
      FG.listing.render();
      return;
    }
    state.trashGroups = (res.data && res.data.groups) || [];
    FG.listing.render();
  }

  function refresh() {
    return state.trashMode ? loadTrash() : load();
  }

  function navigate(path) {
    const clean = String(path || '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (clean === state.path) return;
    state.path = clean;
    writeHash(false);
    load();
  }

  function openItem(item) {
    if (!item) return;
    if (item.kind === 'dir') {
      navigate(state.path ? state.path + '/' + item.name : item.name);
      return;
    }
    const inline = /^(image\/|video\/|audio\/|text\/|application\/pdf|application\/json)/.test(item.mime || '');
    if (inline) window.open('/file/' + encodeURIComponent(item.id), '_blank', 'noopener');
    else downloadItem(item);
  }

  function downloadItem(item) {
    if (!item || item.kind !== 'file') return;
    FG.download.run(item);
  }

  function copyLink(item) {
    const url = location.origin + '/file/' + encodeURIComponent(item.id);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => toast('链接已复制'),
        () => toast(url)
      );
    } else {
      toast(url);
    }
  }

  async function mkdir() {
    const name = await FG.ui.prompt({ title: '新建文件夹', placeholder: '文件夹名称' });
    if (name == null) return;
    const err = FG.naming.nameError(name);
    if (err) {
      toast(err, true);
      return;
    }
    let res = await apiPost('/api/mkdir', { parentId: state.dirId, name });
    if (res.status === 409 || (res.data && res.data.conflict)) {
      const candidate = FG.naming.uniqueLocal(name, knownNames());
      const ok = await FG.ui.confirm({
        title: '名称冲突',
        message: '该位置已存在同名项。是否改为“' + candidate + '”？',
        okText: '保留两者',
      });
      if (!ok) return;
      res = await apiPost('/api/mkdir', { parentId: state.dirId, name: candidate });
    }
    if (!res.ok) {
      toast((res.data && res.data.error) || '新建文件夹失败', true);
      return;
    }
    toast('已创建文件夹');
    await refresh();
  }

  async function renameItem(item) {
    if (!item) return;
    const name = await FG.ui.prompt({ title: '重命名', value: item.name });
    if (name == null || name === item.name) return;
    const err = FG.naming.nameError(name);
    if (err) {
      toast(err, true);
      return;
    }
    let res = await apiPost('/api/rename', { id: item.id, name });
    if (res.status === 409 || (res.data && res.data.conflict)) {
      const candidate = FG.naming.uniqueLocal(name, knownNames());
      const ok = await FG.ui.confirm({
        title: '名称冲突',
        message: '该位置已存在同名项。是否改为“' + candidate + '”？',
        okText: '保留两者',
      });
      if (!ok) return;
      res = await apiPost('/api/rename', { id: item.id, name: candidate, onConflict: 'keep-both' });
    }
    if (!res.ok) {
      toast((res.data && res.data.error) || '重命名失败', true);
      return;
    }
    toast('已重命名');
    await refresh();
  }

  async function batch(action, ids, targetId) {
    const out = { success: 0, skipped: 0, failed: 0, results: [] };
    for (let i = 0; i < ids.length; i += 8) {
      const slice = ids.slice(i, i + 8);
      const body = { action, items: slice.map((id) => ({ id })) };
      if (targetId !== undefined) body.targetId = targetId;
      const res = await apiPost('/api/batch', body);
      if (res.ok && res.data) {
        out.success += res.data.success || 0;
        out.skipped += res.data.skipped || 0;
        out.failed += res.data.failed || 0;
        out.results = out.results.concat(res.data.results || []);
      } else {
        out.failed += slice.length;
      }
    }
    return out;
  }

  async function deleteItems(items) {
    if (!items || !items.length) return;
    const label = items.length === 1 ? '“' + items[0].name + '”' : items.length + ' 项';
    const ok = await FG.ui.confirm({
      title: '移到回收站',
      message: '确定把 ' + label + ' 移到回收站？',
      okText: '移到回收站',
      danger: true,
    });
    if (!ok) return;
    const r = await batch('trash', items.map((x) => x.id));
    toast(r.failed ? '已删除 ' + r.success + ' 项，失败 ' + r.failed + ' 项' : '已移到回收站：' + r.success + ' 项', r.failed > 0);
    await refresh();
  }

  async function moveItems(items) {
    if (!items || !items.length) return;
    const pick = await FG.ui.chooseDir({ title: '移动到…', currentId: state.dirId });
    if (!pick) return;
    const r = await batch('move', items.map((x) => x.id), pick.dirId);
    if (r.failed) {
      const first = (r.results.find((x) => x && !x.ok) || {}).error || '目标位置存在同名项';
      toast('已移动 ' + r.success + ' 项，失败 ' + r.failed + ' 项：' + first, true);
    } else {
      toast('已移动 ' + r.success + ' 项');
    }
    await refresh();
  }

  async function copyItems(items) {
    if (!items || !items.length) return;
    const pick = await FG.ui.chooseDir({ title: '复制到…', currentId: state.dirId });
    if (!pick) return;
    const r = await batch('copy', items.map((x) => x.id), pick.dirId);
    if (r.failed) {
      const first = (r.results.find((x) => x && !x.ok) || {}).error || '目标位置存在同名项';
      toast('已复制 ' + r.success + ' 项，失败 ' + r.failed + ' 项：' + first, true);
    } else {
      toast('已复制 ' + r.success + ' 项');
    }
    await refresh();
  }

  async function restoreItems(ids) {
    if (!ids || !ids.length) return;
    const r = await batch('restore', ids);
    toast('已恢复 ' + r.success + ' 项' + (r.failed ? '，失败 ' + r.failed + ' 项' : ''), r.failed > 0);
    await refresh();
  }

  function toggleTrash() {
    state.trashMode = !state.trashMode;
    state.selected = new Set();
    state.focusIdx = -1;
    state.anchorIdx = -1;
    refresh();
  }

  function pickUpload() {
    const input = document.getElementById('fileInput');
    if (input) input.click();
  }

  function wire() {
    const mk = document.getElementById('btnMkdir');
    if (mk) mk.addEventListener('click', mkdir);
    const up = document.getElementById('btnUpload');
    if (up) up.addEventListener('click', pickUpload);
    const tr = document.getElementById('btnTrash');
    if (tr) tr.addEventListener('click', toggleTrash);
    const rf = document.getElementById('btnRefresh');
    if (rf) rf.addEventListener('click', () => refresh());
    const input = document.getElementById('fileInput');
    if (input) {
      input.addEventListener('change', async () => {
        // input.files 是活对象：先抄成数组再清 value，否则清空后拿到的就是空列表，
        // 选择同一个文件也不会再触发 change。
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length) await FG.upload.run(files);
      });
    }
    const search = document.getElementById('search');
    if (search) {
      let timer = null;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.query = search.value;
          FG.listing.render();
        }, 120);
      });
    }
    const sort = document.getElementById('sort');
    if (sort) {
      sort.addEventListener('change', () => {
        state.sort = sort.value;
        FG.listing.render();
      });
    }
  }

  async function init() {
    FG.listing.attach();
    FG.selection.attach();
    FG.contextmenu.attach();
    wire();
    state.path = pathFromHash();
    const sort = document.getElementById('sort');
    if (sort && sort.value) state.sort = sort.value;
    const onLocation = () => {
      const p = pathFromHash();
      if (p !== state.path) {
        state.path = p;
        state.trashMode = false;
        state.selected = new Set();
        state.focusIdx = -1;
        state.anchorIdx = -1;
        load();
      }
    };
    window.addEventListener('popstate', onLocation);
    window.addEventListener('hashchange', onLocation);
    await load();
  }

  FG.app = {
    navigate,
    refresh,
    openItem,
    downloadItem,
    copyLink,
    mkdir,
    renameItem,
    deleteItems,
    moveItems,
    copyItems,
    restoreItems,
    toggleTrash,
    pickUpload,
    load,
    loadTrash,
  };

  init().catch((err) => {
    toast('页面初始化失败：' + (err && err.message ? err.message : err), true);
  });
}
