
(function () {
  'use strict';

  // ============================================================
  // 状态
  // ============================================================
  var MAX_SIZE = 20 * 1024 * 1024;
  var $list = document.getElementById('list');
  var $breadcrumb = document.getElementById('breadcrumb');
  var $status = document.getElementById('status');
  var $pageTitle = document.getElementById('pageTitle');
  var $ctxMenu = document.getElementById('ctx-menu');
  var $modal = document.getElementById('modal');
  var $modalTitle = document.getElementById('modalTitle');
  var $modalBody = document.getElementById('modalBody');
  var $modalActions = document.getElementById('modalActions');
  var $fileInput = document.getElementById('fileInput');
  var $btnTrash = document.getElementById('btnTrash');
  var $btnMkdir = document.getElementById('btnMkdir');
  var $btnUpload = document.getElementById('btnUpload');

  var rawPath = location.pathname.replace(/^\/+|\/+$/g, '');
  var currentPath = '';
  try { currentPath = decodeURIComponent(rawPath); } catch (e) { currentPath = rawPath; }

  var isTrashView = false;
  var items = [];          // 当前列表数据
  var selected = new Map();// key -> item
  var anchorKey = null;    // Shift 选择锚点
  var focusedKey = null;   // 键盘焦点
  var renamingKey = null;  // 正在重命名的项 key

  var SVG = {
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>'
  };

  // ============================================================
  // 工具函数
  // ============================================================
  function itemKey(item) {
    return item.type === 'dir' ? 'd:' + (item.path || '') : 'f:' + (item.id || '');
  }

  function itemName(item) {
    return item.name || '';
  }

  function formatSize(bytes) {
    if (!bytes || bytes < 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function formatDate(ts) {
    if (!ts) return '-';
    var d = new Date(ts);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function showStatus(text, ms) {
    $status.textContent = text;
    $status.classList.add('show');
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () { $status.classList.remove('show'); }, ms || 2000);
  }

  function getNameExtension(name) {
    var i = name.lastIndexOf('.');
    if (i <= 0) return { base: name, ext: '' };
    return { base: name.slice(0, i), ext: name.slice(i) };
  }

  // ============================================================
  // 选择系统
  // ============================================================
  function clearSelection() {
    selected.clear();
    anchorKey = null;
  }

  function setSelection(keyList) {
    selected.clear();
    for (var i = 0; i < keyList.length; i++) {
      var it = findItemByKey(keyList[i]);
      if (it) selected.set(keyList[i], it);
    }
  }

  function findItemByKey(key) {
    for (var i = 0; i < items.length; i++) {
      if (itemKey(items[i]) === key) return items[i];
    }
    return null;
  }

  function findItemIndex(key) {
    for (var i = 0; i < items.length; i++) {
      if (itemKey(items[i]) === key) return i;
    }
    return -1;
  }

  function selectOne(key, additive) {
    var it = findItemByKey(key);
    if (!it) return;
    if (!additive) {
      selected.clear();
      selected.set(key, it);
    } else {
      if (selected.has(key)) selected.delete(key);
      else selected.set(key, it);
    }
    anchorKey = key;
    focusedKey = key;
  }

  function selectRange(endKey) {
    if (!anchorKey) { selectOne(endKey, false); return; }
    var startIdx = findItemIndex(anchorKey);
    var endIdx = findItemIndex(endKey);
    if (startIdx < 0 || endIdx < 0) return;
    if (startIdx > endIdx) { var t = startIdx; startIdx = endIdx; endIdx = t; }
    selected.clear();
    for (var i = startIdx; i <= endIdx; i++) {
      var it = items[i];
      selected.set(itemKey(it), it);
    }
    focusedKey = endKey;
  }

  function selectAll() {
    selected.clear();
    for (var i = 0; i < items.length; i++) {
      selected.set(itemKey(items[i]), items[i]);
    }
    if (items.length) {
      anchorKey = itemKey(items[0]);
      focusedKey = itemKey(items[items.length - 1]);
    }
  }

  function selectedItems() {
    var arr = [];
    selected.forEach(function (v) { arr.push(v); });
    return arr;
  }

  function selectedForApi() {
    return selectedItems().map(function (it) {
      return it.type === 'dir'
        ? { type: 'dir', path: it.path }
        : { type: 'file', id: it.id };
    });
  }

  // ============================================================
  // 列表渲染
  // ============================================================
  function renderBreadcrumb() {
    $breadcrumb.innerHTML = '';
    if (isTrashView) {
      $breadcrumb.textContent = '回收站';
      return;
    }
    var root = document.createElement('a');
    root.href = '/';
    root.textContent = '根目录';
    $breadcrumb.appendChild(root);
    if (!currentPath) return;
    var parts = currentPath.split('/');
    var acc = '';
    parts.forEach(function (seg) {
      acc = acc ? acc + '/' + seg : seg;
      var sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      $breadcrumb.appendChild(sep);
      var a = document.createElement('a');
      a.href = '/' + encodeURIComponent(acc);
      a.textContent = seg;
      $breadcrumb.appendChild(a);
    });
  }

  function renderList() {
    $list.innerHTML = '';
    if (!items.length && !isTrashView) {
      $list.innerHTML = '<li class="empty">此目录为空</li>';
      return;
    }
    if (!items.length && isTrashView) {
      $list.innerHTML = '<li class="empty">回收站为空</li>';
      return;
    }

    var currentDate = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var key = itemKey(it);

      // 回收站日期分组
      if (isTrashView && it.trashDate && it.trashDate !== currentDate) {
        currentDate = it.trashDate;
        var groupLi = document.createElement('li');
        groupLi.className = 'date-group';
        groupLi.textContent = '删除日期：' + it.trashDate;
        $list.appendChild(groupLi);
      }

      var li = document.createElement('li');
      var row = document.createElement('div');
      row.className = 'row';
      row.dataset.key = key;
      row.dataset.index = i;

      if (selected.has(key)) row.classList.add('selected');
      if (focusedKey === key) row.classList.add('focused');

      // 图标
      var ico = document.createElement('span');
      ico.className = 'ico';
      ico.innerHTML = it.type === 'dir' ? SVG.folder : SVG.file;

      // 名称
      if (renamingKey === key) {
        var input = document.createElement('input');
        input.className = 'name-input';
        input.value = it.name;
        var parts = getNameExtension(it.name);
        // 选中主文件名（不含扩展名）
        setTimeout(function () {
          input.focus();
          if (parts.ext && it.type === 'file') {
            input.setSelectionRange(0, parts.base.length);
          } else {
            input.select();
          }
        }, 0);
        input.addEventListener('keydown', handleRenameKeydown);
        input.addEventListener('blur', handleRenameBlur);
        row.appendChild(ico);
        row.appendChild(input);
      } else {
        var nameEl;
        if (it.type === 'dir') {
          nameEl = document.createElement('a');
          nameEl.className = 'name';
          nameEl.href = '/' + encodeURIComponent(it.path);
          nameEl.textContent = it.name + '/';
        } else {
          nameEl = document.createElement('a');
          nameEl.className = 'name file-link';
          nameEl.href = '/file/' + it.id;
          nameEl.target = '_blank';
          nameEl.rel = 'noopener';
          nameEl.textContent = it.name;
        }
        row.appendChild(ico);
        row.appendChild(nameEl);
      }

      // 大小
      var sizeEl = document.createElement('span');
      sizeEl.className = 'size';
      sizeEl.textContent = it.type === 'file' ? formatSize(it.size) : '-';
      row.appendChild(sizeEl);

      // 日期 / 原路径
      var dateEl = document.createElement('span');
      dateEl.className = 'date';
      if (isTrashView) {
        dateEl.textContent = it.originalPath ? '原: ' + it.originalPath : '-';
      } else if (it.type === 'file') {
        dateEl.textContent = formatDate(it.createdAt);
      } else {
        dateEl.textContent = '-';
      }
      row.appendChild(dateEl);

      li.appendChild(row);
      $list.appendChild(li);
    }
  }

  // ============================================================
  // 鼠标交互
  // ============================================================
  $list.addEventListener('click', function (e) {
    if (renamingKey) return;
    var row = e.target.closest('.row');
    if (!row) {
      // 点击空白区：清空选择
      clearSelection();
      focusedKey = null;
      renderList();
      return;
    }
    var key = row.dataset.key;

    // 单击只做选择，进入目录/打开文件交给双击与 Enter，否则 <a> 的默认跳转会把整页刷掉
    if (e.target.tagName === 'A') e.preventDefault();

    if (e.shiftKey) {
      selectRange(key);
    } else if (e.ctrlKey || e.metaKey) {
      selectOne(key, true);
    } else {
      selectOne(key, false);
    }
    renderList();
  });

  $list.addEventListener('dblclick', function (e) {
    if (renamingKey) return;
    var row = e.target.closest('.row');
    if (!row) return;
    var key = row.dataset.key;
    var it = findItemByKey(key);
    if (!it) return;
    if (it.type === 'dir') {
      navigateTo(it.path);
    } else {
      window.open('/file/' + it.id, '_blank');
    }
  });

  // 面包屑点击不触发页面跳转，用 history push
  $breadcrumb.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    var path = a.getAttribute('href');
    if (path === '/') navigateTo('');
    else navigateTo(decodeURIComponent(path.slice(1)));
  });

  // ============================================================
  // 右键菜单
  // ============================================================
  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest('#ctx-menu')) return;
    e.preventDefault();
    var row = e.target.closest('.row');
    var key = row ? row.dataset.key : null;

    if (key) {
      // 右键项目
      if (!selected.has(key)) {
        // 未选中：先选中它
        selectOne(key, false);
        renderList();
      }
      openItemContextMenu(e.clientX, e.clientY);
    } else {
      // 右键空白区
      clearSelection();
      focusedKey = null;
      renderList();
      openBlankContextMenu(e.clientX, e.clientY);
    }
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#ctx-menu')) hideContextMenu();
  });

  function hideContextMenu() { $ctxMenu.style.display = 'none'; }

  function positionMenu(x, y) {
    if (x + 180 > window.innerWidth) x = window.innerWidth - 190;
    if (y + 300 > window.innerHeight) y = window.innerHeight - 310;
    $ctxMenu.style.left = x + 'px';
    $ctxMenu.style.top = y + 'px';
  }

  function ctxItem(label, handler, opts) {
    opts = opts || {};
    var div = document.createElement('div');
    div.className = 'ctx-item' + (opts.danger ? ' danger' : '') + (opts.disabled ? ' disabled' : '');
    div.textContent = label;
    if (!opts.disabled) {
      div.addEventListener('click', function () {
        hideContextMenu();
        handler();
      });
    }
    return div;
  }

  function ctxSep() {
    var div = document.createElement('div');
    div.className = 'ctx-sep';
    return div;
  }

  function openBlankContextMenu(x, y) {
    $ctxMenu.innerHTML = '';
    if (!isTrashView) {
      $ctxMenu.appendChild(ctxItem('新建文件夹', function () { promptMkdir(); }));
      $ctxMenu.appendChild(ctxItem('上传文件', function () { $fileInput.click(); }));
      $ctxMenu.appendChild(ctxSep());
      $ctxMenu.appendChild(ctxItem('刷新', function () { load(); }));
      $ctxMenu.appendChild(ctxSep());
      $ctxMenu.appendChild(ctxItem('回收站', function () { toggleTrashView(); }));
    } else {
      $ctxMenu.appendChild(ctxItem('刷新', function () { load(); }));
      $ctxMenu.appendChild(ctxSep());
      $ctxMenu.appendChild(ctxItem('返回文件列表', function () { toggleTrashView(); }));
    }
    $ctxMenu.style.display = 'block';
    positionMenu(x, y);
  }

  function openItemContextMenu(x, y) {
    $ctxMenu.innerHTML = '';
    var sel = selectedItems();
    var multi = sel.length > 1;

    if (isTrashView) {
      // 回收站：只有恢复
      $ctxMenu.appendChild(ctxItem(
        multi ? '恢复选中的 ' + sel.length + ' 项' : '恢复',
        function () { restoreSelected(); }
      ));
    } else {
      // 正常视图
      if (!multi) {
        var it = sel[0];
        if (it.type === 'file') {
          $ctxMenu.appendChild(ctxItem('下载 / 预览', function () {
            window.open('/file/' + it.id, '_blank');
          }));
        } else {
          $ctxMenu.appendChild(ctxItem('打开', function () { navigateTo(it.path); }));
        }
        $ctxMenu.appendChild(ctxItem('重命名', function () { startRename(itemKey(it)); }));
        $ctxMenu.appendChild(ctxSep());
        $ctxMenu.appendChild(ctxItem('移动到…', function () { openMoveCopyDialog('move'); }));
        $ctxMenu.appendChild(ctxItem('复制到…', function () { openMoveCopyDialog('copy'); }));
        $ctxMenu.appendChild(ctxSep());
        $ctxMenu.appendChild(ctxItem('放入回收站', function () { trashSelected(); }, { danger: true }));
      } else {
        $ctxMenu.appendChild(ctxItem('移动到…', function () { openMoveCopyDialog('move'); }));
        $ctxMenu.appendChild(ctxItem('复制到…', function () { openMoveCopyDialog('copy'); }));
        $ctxMenu.appendChild(ctxSep());
        $ctxMenu.appendChild(ctxItem('放入回收站 (' + sel.length + ' 项)', function () {
          trashSelected();
        }, { danger: true }));
      }
    }

    $ctxMenu.style.display = 'block';
    positionMenu(x, y);
  }

  // ============================================================
  // 重命名
  // ============================================================
  function startRename(key) {
    renamingKey = key;
    renderList();
  }

  function handleRenameKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(this.value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  function handleRenameBlur(e) {
    // 点击弹窗或其他元素时不立即提交，等下一帧判断是否仍在编辑
    setTimeout(function () {
      if (renamingKey && document.activeElement !== e.target) {
        cancelRename();
      }
    }, 0);
  }

  function commitRename(newName) {
    var key = renamingKey;
    if (!key) return;
    var it = findItemByKey(key);
    if (!it) return;

    // 基础校验
    if (!newName) { showStatus('名称不能为空'); return; }
    if (newName === it.name) { cancelRename(); return; }

    // 本文件整体是模板字符串：正则里的每个反斜杠都要写成两条，否则到浏览器就变成普通字母
    // 前端快速校验非法字符（与后端规则一致）
    if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(newName)) {
      showStatus('名称不能包含 < > : " / \ | ? * 等字符'); return;
    }
    if (/^[. ]|[. ]$/.test(newName)) {
      showStatus('名称不能以点或空格开头或结尾'); return;
    }
    if (newName === '.' || newName === '..') {
      showStatus('名称不能是 . 或 ..'); return;
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(newName)) {
      showStatus('名称是 Windows 保留名，请换一个'); return;
    }

    var source = it.type === 'dir' ? it.path : it.id;
    fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: it.type, source: source, newName: newName })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        showStatus('已重命名');
        renamingKey = null;
        load();
      } else if (d.conflict) {
        showConflictDialog({
          name: newName,
          clashName: d.clashName,
          clashKind: d.clashKind,
          targetDir: it.type === 'dir' ? parentPathOf(it.path) : it.path,
          onChoose: function (choice) {
            if (choice === 'skip' || choice === 'overwrite' && d.clashKind === 'dir') {
              renamingKey = null;
              renderList();
              showStatus('已取消');
              return;
            }
            // rename 场景只能"保留两者"
            fetch('/api/rename', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: it.type, source: source,
                newName: newName, onConflict: 'rename'
              })
            }).then(function (r2) { return r2.json(); }).then(function (d2) {
              if (d2.ok) { showStatus('已重命名'); renamingKey = null; load(); }
              else { showStatus(d2.error || '重命名失败'); renamingKey = null; renderList(); }
            });
          }
        });
      } else {
        showStatus(d.error || '重命名失败');
        renamingKey = null;
        renderList();
      }
    }).catch(function () {
      showStatus('网络错误');
      renamingKey = null;
      renderList();
    });
  }

  function cancelRename() {
    renamingKey = null;
    renderList();
  }

  function parentPathOf(p) {
    var i = p.lastIndexOf('/');
    return i === -1 ? '' : p.slice(0, i);
  }

  // ============================================================
  // Modal 工具
  // ============================================================
  function openModal(title, bodyHtml, actions) {
    $modalTitle.textContent = title;
    $modalBody.innerHTML = '';
    if (typeof bodyHtml === 'string') $modalBody.innerHTML = bodyHtml;
    else $modalBody.appendChild(bodyHtml);
    $modalActions.innerHTML = '';
    actions.forEach(function (a) {
      var btn = document.createElement('button');
      btn.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
      btn.textContent = a.label;
      if (a.disabled) btn.disabled = true;
      btn.addEventListener('click', function () {
        if (a.onClick) a.onClick();
      });
      $modalActions.appendChild(btn);
    });
    $modal.classList.add('show');
    // 聚焦第一个可聚焦元素
    setTimeout(function () {
      var first = $modalBody.querySelector('input, button, select');
      if (first) first.focus();
    }, 0);
  }

  function closeModal() { $modal.classList.remove('show'); }

  $modal.addEventListener('click', function (e) {
    if (e.target === $modal) closeModal();
  });

  // ============================================================
  // 冲突对话框
  // ============================================================
  // opts: { name, clashName, clashKind, targetDir, isDir, onChoose(choice, applyAll) }
  function showConflictDialog(opts) {
    var body = document.createElement('div');

    var info = document.createElement('div');
    info.className = 'conflict-info';
    info.innerHTML =
      '<div><span class="label">目标位置：</span>' + (opts.targetDir || '根目录') + '</div>' +
      '<div style="margin-top:4px;"><span class="label">源项目：</span>' + opts.name + '</div>' +
      '<div><span class="label">已有同名' + (opts.clashKind === 'dir' ? '文件夹' : '文件') + '：</span>' + opts.clashName + '</div>';
    body.appendChild(info);

    var options = document.createElement('div');
    options.className = 'conflict-options';
    var choices = [
      { val: 'overwrite', label: '替换目标中的项目' },
      { val: 'rename', label: '保留两者（自动重命名）' },
      { val: 'skip', label: '跳过此项目' }
    ];
    // 目录不支持替换
    if (opts.clashKind === 'dir') {
      choices[0].disabled = true;
      choices[0].label += '（文件夹冲突不支持替换）';
    }

    var chosen = opts.clashKind === 'dir' ? 'rename' : 'overwrite';
    choices.forEach(function (c) {
      var label = document.createElement('label');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'conflict-choice';
      radio.value = c.val;
      radio.checked = c.val === chosen;
      if (c.disabled) radio.disabled = true;
      radio.addEventListener('change', function () { chosen = c.val; });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(c.label));
      options.appendChild(label);
    });
    body.appendChild(options);

    var applyAllWrap = document.createElement('label');
    applyAllWrap.className = 'apply-all';
    var applyAll = document.createElement('input');
    applyAll.type = 'checkbox';
    applyAllWrap.appendChild(applyAll);
    applyAllWrap.appendChild(document.createTextNode('对后续所有冲突使用相同操作'));
    body.appendChild(applyAllWrap);

    openModal('确认替换', body, [
      { label: '取消', onClick: function () { closeModal(); opts.onChoose('skip', false); } },
      {
        label: '确定', primary: true,
        onClick: function () {
          closeModal();
          opts.onChoose(chosen, applyAll.checked);
        }
      }
    ]);
  }

  // ============================================================
  // 放入回收站
  // ============================================================
  function trashSelected() {
    var sel = selectedForApi();
    if (!sel.length) return;

    openModal('放入回收站',
      '<p>确定将选中的 ' + sel.length + ' 项放入回收站吗？</p>' +
      '<p style="margin-top:6px;color:#888;font-size:12px;">文件内容保留在云端，可随时从回收站恢复。</p>',
      [
        { label: '取消', onClick: closeModal },
        {
          label: '放入回收站', danger: true,
          onClick: function () {
            closeModal();
            doBatchTrash(sel);
          }
        }
      ]
    );
  }

  function doBatchTrash(sel) {
    showProgress('正在放入回收站…', 0, sel.length);
    fetch('/api/batch-trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: sel })
    }).then(function (r) { return r.json(); }).then(function (d) {
      hideProgress();
      showResultSummary('放入回收站完成', d);
      load();
    }).catch(function () {
      hideProgress();
      showStatus('网络错误');
    });
  }

  // ============================================================
  // 恢复
  // ============================================================
  function restoreSelected() {
    var sel = selectedForApi();
    if (!sel.length) return;

    openModal('恢复项目',
      '<p>确定恢复选中的 ' + sel.length + ' 项到原位置吗？</p>' +
      '<p style="margin-top:6px;color:#888;font-size:12px;">如遇同名项目，将提示选择处理方式。</p>',
      [
        { label: '取消', onClick: closeModal },
        {
          label: '恢复', primary: true,
          onClick: function () {
            closeModal();
            doBatchRestore(sel, null, false);
          }
        }
      ]
    );
  }

  function doBatchRestore(sel, onConflict, applyAll) {
    showProgress('正在恢复…', 0, sel.length);
    var body = { items: sel };
    if (onConflict) body.onConflict = onConflict;

    fetch('/api/batch-restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      hideProgress();

      // 检查是否有冲突项需要用户决策
      var conflicts = d.results.filter(function (r) { return r.conflict; });
      if (conflicts.length && !applyAll && !onConflict) {
        var first = conflicts[0];
        showConflictDialog({
          name: first.name,
          clashName: first.clashName,
          clashKind: first.clashKind,
          targetDir: first.targetDir,
          onChoose: function (choice, all) {
            // 用用户选的策略重发
            var remaining = sel.filter(function (s) {
              var k = s.type === 'dir' ? 'd:' + s.path : 'f:' + s.id;
              return !d.results.some(function (r) {
                return r.ok && !r.skipped && (
                  (s.type === 'file' && r.source === s.id) ||
                  (s.type === 'dir' && r.source === s.path)
                );
              });
            });
            if (remaining.length) {
              doBatchRestore(remaining, choice, all);
            } else {
              showResultSummary('恢复完成', d);
              load();
            }
          }
        });
        return;
      }

      showResultSummary('恢复完成', d);
      load();
    }).catch(function () {
      hideProgress();
      showStatus('网络错误');
    });
  }

  // ============================================================
  // 移动 / 复制 弹窗
  // ============================================================
  function openMoveCopyDialog(action) {
    var sel = selectedForApi();
    if (!sel.length) return;

    var body = document.createElement('div');

    var input = document.createElement('input');
    input.className = 'modal-input';
    input.type = 'text';
    input.placeholder = '目标路径，留空为根目录';
    input.value = isTrashView ? '' : currentPath;
    body.appendChild(input);

    var treeBox = document.createElement('div');
    treeBox.className = 'tree-box';
    treeBox.textContent = '加载中…';
    body.appendChild(treeBox);

    var selectedTarget = isTrashView ? '' : currentPath;

    fetch('/api/tree').then(function (r) { return r.json(); }).then(function (dirs) {
      treeBox.innerHTML = '';
      var root = document.createElement('div');
      root.className = 'tree-item';
      root.textContent = '[ 根目录 ]';
      root.dataset.path = '';
      if (selectedTarget === '') root.classList.add('selected');
      root.addEventListener('click', function () {
        selectedTarget = '';
        input.value = '';
        treeBox.querySelectorAll('.tree-item').forEach(function (el) { el.classList.remove('selected'); });
        root.classList.add('selected');
      });
      treeBox.appendChild(root);
      dirs.forEach(function (d) {
        var el = document.createElement('div');
        el.className = 'tree-item';
        el.textContent = d;
        el.dataset.path = d;
        if (d === selectedTarget) el.classList.add('selected');
        el.addEventListener('click', function () {
          selectedTarget = d;
          input.value = d;
          treeBox.querySelectorAll('.tree-item').forEach(function (x) { x.classList.remove('selected'); });
          el.classList.add('selected');
        });
        treeBox.appendChild(el);
      });
    }).catch(function () { treeBox.textContent = '加载失败'; });

    input.addEventListener('input', function () {
      selectedTarget = this.value.trim();
      treeBox.querySelectorAll('.tree-item').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.path === selectedTarget);
      });
    });

    var actionLabel = action === 'move' ? '移动' : '复制';
    openModal(actionLabel + '到…', body, [
      { label: '取消', onClick: closeModal },
      {
        label: actionLabel, primary: true,
        onClick: function () {
          closeModal();
          if (action === 'move') doBatchMove(sel, selectedTarget, null, false);
          else doBatchCopy(sel, selectedTarget, null, false);
        }
      }
    ]);
  }

  function doBatchMove(sel, targetDir, onConflict, applyAll) {
    showProgress('正在移动…', 0, sel.length);
    var body = { items: sel, targetDir: targetDir };
    if (onConflict) body.onConflict = onConflict;

    fetch('/api/batch-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      hideProgress();
      var conflicts = d.results.filter(function (r) { return r.conflict; });
      if (conflicts.length && !applyAll && !onConflict) {
        var first = conflicts[0];
        showConflictDialog({
          name: first.name,
          clashName: first.clashName,
          clashKind: first.clashKind,
          targetDir: first.targetDir,
          onChoose: function (choice, all) {
            var remaining = d.results.filter(function (r) {
              if (r.ok && !r.skipped) return false;
              if (r.conflict) return false;
              return !r.ok;
            });
            // 已成功的不算，冲突和失败的重发
            var retryItems = sel.filter(function (s) {
              var src = s.type === 'dir' ? s.path : s.id;
              return !d.results.some(function (r) { return r.source === src && r.ok && !r.skipped; });
            });
            if (retryItems.length) {
              doBatchMove(retryItems, targetDir, choice, all);
            } else {
              showResultSummary('移动完成', d);
              load();
            }
          }
        });
        return;
      }
      showResultSummary('移动完成', d);
      load();
    }).catch(function () {
      hideProgress();
      showStatus('网络错误');
    });
  }

  function doBatchCopy(sel, targetDir, onConflict, applyAll) {
    showProgress('正在复制…', 0, sel.length);
    var body = { items: sel, targetDir: targetDir };
    if (onConflict) body.onConflict = onConflict;

    fetch('/api/batch-copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      hideProgress();
      var conflicts = d.results.filter(function (r) { return r.conflict; });
      if (conflicts.length && !applyAll && !onConflict) {
        var first = conflicts[0];
        showConflictDialog({
          name: first.name,
          clashName: first.clashName,
          clashKind: first.clashKind,
          targetDir: first.targetDir,
          onChoose: function (choice, all) {
            var retryItems = sel.filter(function (s) {
              var src = s.type === 'dir' ? s.path : s.id;
              return !d.results.some(function (r) { return r.source === src && r.ok && !r.skipped; });
            });
            if (retryItems.length) {
              doBatchCopy(retryItems, targetDir, choice, all);
            } else {
              showResultSummary('复制完成', d);
              load();
            }
          }
        });
        return;
      }
      showResultSummary('复制完成', d);
      load();
    }).catch(function () {
      hideProgress();
      showStatus('网络错误');
    });
  }

  // ============================================================
  // 进度条
  // ============================================================
  function showProgress(text, done, total) {
    var pct = total ? Math.round(done / total * 100) : 0;
    var body = document.createElement('div');
    body.innerHTML =
      '<div class="progress-text">' + text + ' (' + done + '/' + total + ')</div>' +
      '<div class="progress-wrap"><div class="progress-bar" style="width:' + pct + '%"></div></div>';
    openModal('处理中', body, []);
  }

  function updateProgress(done, total) {
    var bar = document.querySelector('.progress-bar');
    var txt = document.querySelector('.progress-text');
    if (!bar || !txt) return;
    var pct = total ? Math.round(done / total * 100) : 0;
    bar.style.width = pct + '%';
    txt.textContent = txt.textContent.replace(/\(\d+\/\d+\)/, '(' + done + '/' + total + ')');
  }

  function hideProgress() { closeModal(); }

  // ============================================================
  // 结果汇总
  // ============================================================
  function showResultSummary(title, d) {
    var body = document.createElement('div');
    var summary = document.createElement('div');
    summary.className = 'result-summary';
    summary.innerHTML =
      '<div class="ok"><div class="num">' + d.success + '</div><div>成功</div></div>' +
      '<div class="skip"><div class="num">' + d.skiped + '</div><div>跳过</div></div>' +
      '<div class="fail"><div class="num">' + d.failed + '</div><div>失败</div></div>';
    // 注意：后端字段是 skipped，但拼写可能有差异，做兼容
    var skipped = d.skipped !== undefined ? d.skipped : d.skiped;
    summary.querySelector('.skip .num').textContent = skipped || 0;
    body.appendChild(summary);

    if (d.results && d.results.length) {
      var list = document.createElement('div');
      list.className = 'result-list';
      d.results.forEach(function (r) {
        if (r.ok && !r.skipped) return; // 成功的不列
        var div = document.createElement('div');
        div.className = 'result-item';
        var name = r.name || r.source || '';
        var status = r.skipped ? '已跳过' : (r.error || '失败');
        div.innerHTML = name + '<span class="err">' + status + '</span>';
        list.appendChild(div);
      });
      if (list.children.length) body.appendChild(list);
    }

    openModal(title, body, [
      { label: '确定', primary: true, onClick: closeModal }
    ]);
  }

  // ============================================================
  // 新建文件夹
  // ============================================================
  function promptMkdir() {
    var body = document.createElement('div');
    var input = document.createElement('input');
    input.className = 'modal-input';
    input.type = 'text';
    input.placeholder = '文件夹名称';
    body.appendChild(input);

    openModal('新建文件夹', body, [
      { label: '取消', onClick: closeModal },
      {
        label: '创建', primary: true,
        onClick: function () {
          var name = input.value.trim();
          if (!name) { showStatus('请输入名称'); return; }
          fetch('/api/mkdir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent: currentPath, name: name })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) { closeModal(); showStatus('已创建'); load(); }
            else if (d.conflict) {
              showStatus('该名称已存在');
            }
            else showStatus(d.error || '创建失败');
          }).catch(function () { showStatus('网络错误'); });
        }
      }
    ]);
  }

  // ============================================================
  // 上传
  // ============================================================
  $btnUpload.addEventListener('click', function () { $fileInput.click(); });
  $fileInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call($fileInput.files);
    if (!files.length) return;
    uploadFiles(files);
    $fileInput.value = '';
  });

  function uploadFiles(files) {
    var done = 0, success = 0, failed = 0;
    showProgress('正在上传…', 0, files.length);

    function next() {
      if (done >= files.length) {
        hideProgress();
        showResultSummary('上传完成', {
          success: success, skipped: 0, failed: failed, results: []
        });
        load();
        return;
      }
      updateProgress(done, files.length);
      var file = files[done];
      if (file.size > MAX_SIZE) {
        done++; failed++;
        setTimeout(next, 0);
        return;
      }
      var form = new FormData();
      form.append('file', file);
      form.append('path', currentPath);
      fetch('/api/upload', { method: 'POST', body: form })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          done++;
          if (d.url) success++;
          else failed++;
          next();
        })
        .catch(function () {
          done++; failed++;
          next();
        });
    }
    next();
  }

  // ============================================================
  // 键盘操作
  // ============================================================
  document.addEventListener('keydown', function (e) {
    // 输入框中不处理
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape' && renamingKey) {
        // 重命名 Esc 由输入框自己处理
      }
      return;
    }

    // 弹窗打开时，Esc 关闭
    if ($modal.classList.contains('show')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      if (isTrashView) return; // 回收站不提供删除
      if (selected.size) trashSelected();
    } else if (e.key === 'F2') {
      e.preventDefault();
      if (isTrashView) return;
      if (selected.size === 1) {
        var keys = Array.from(selected.keys());
        startRename(keys[0]);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selected.size === 1 && !isTrashView) {
        var it = selected.values().next().value;
        if (it.type === 'dir') navigateTo(it.path);
        else window.open('/file/' + it.id, '_blank');
      }
    } else if (e.key === 'Escape') {
      clearSelection();
      focusedKey = null;
      renderList();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      selectAll();
      renderList();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      navigateFocus(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      if (!isTrashView) goUp();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      // 预留撤销，暂不实现
    }
  });

  function navigateFocus(dir, shiftSelect) {
    if (!items.length) return;
    var idx = focusedKey ? findItemIndex(focusedKey) : -1;
    var newIdx;
    if (idx < 0) {
      newIdx = dir > 0 ? 0 : items.length - 1;
    } else {
      newIdx = idx + dir;
      if (newIdx < 0) newIdx = 0;
      if (newIdx >= items.length) newIdx = items.length - 1;
    }
    var key = itemKey(items[newIdx]);
    focusedKey = key;
    if (shiftSelect) {
      selectRange(key);
    } else {
      selected.clear();
      selected.set(key, items[newIdx]);
      anchorKey = key;
    }
    renderList();
    // 滚动到可视区域
    var row = $list.querySelector('.row[data-key="' + CSS.escape(key) + '"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }

  // ============================================================
  // 导航
  // ============================================================
  function navigateTo(path) {
    if (isTrashView) {
      // 在回收站中点目录不导航
      return;
    }
    currentPath = path;
    clearSelection();
    focusedKey = null;
    renamingKey = null;
    // 更新 URL 但不跳转
    history_pushState(path);
    load();
  }

  function history_pushState(path) {
    var url = path ? '/' + encodeURIComponent(path) : '/';
    try { window.history.pushState(null, '', url); } catch (e) {}
  }

  function goUp() {
    if (!currentPath) return;
    var p = parentPathOf(currentPath);
    navigateTo(p);
  }

  // 浏览器后退/前进
  window.addEventListener('popstate', function () {
    var raw = location.pathname.replace(/^\/+|\/+$/g, '');
    try { currentPath = decodeURIComponent(raw); } catch (e) { currentPath = raw; }
    clearSelection();
    focusedKey = null;
    load();
  });

  // ============================================================
  // 回收站视图切换
  // ============================================================
  $btnTrash.addEventListener('click', toggleTrashView);

  function toggleTrashView() {
    isTrashView = !isTrashView;
    clearSelection();
    focusedKey = null;
    renamingKey = null;
    if (isTrashView) {
      $pageTitle.textContent = '回收站';
      $btnTrash.textContent = '返回';
      $btnMkdir.style.display = 'none';
      $btnUpload.style.display = 'none';
    } else {
      $pageTitle.textContent = 'File-Go！';
      $btnTrash.textContent = '回收站';
      $btnMkdir.style.display = 'inline-flex';
      $btnUpload.style.display = 'inline-flex';
    }
    load();
  }

  $btnMkdir.addEventListener('click', function () {
    if (isTrashView) return;
    promptMkdir();
  });

  // ============================================================
  // 数据加载
  // ============================================================
  function load() {
    renderBreadcrumb();
    $list.innerHTML = '<li class="empty">加载中…</li>';

    if (isTrashView) {
      fetch('/api/trash')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          // 把按日期分组的对象拍平为列表，保留日期信息
          var flat = [];
          var dates = Object.keys(data || {}).sort().reverse();
          dates.forEach(function (date) {
            (data[date] || []).forEach(function (item) {
              item.trashDate = date;
              flat.push(item);
            });
          });
          items = flat;
          renderList();
        })
        .catch(function () {
          $list.innerHTML = '<li class="empty">加载失败</li>';
        });
    } else {
      fetch('/api/list?path=' + encodeURIComponent(currentPath))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          items = [];
          (data.dirs || []).forEach(function (d) {
            items.push({ type: 'dir', path: d.path, name: d.name });
          });
          (data.files || []).forEach(function (f) {
            items.push({
              type: 'file', id: f.id, name: f.name,
              size: f.size, mime: f.mime, createdAt: f.createdAt
            });
          });
          renderList();
        })
        .catch(function () {
          $list.innerHTML = '<li class="empty">加载失败</li>';
        });
    }
  }

  // ============================================================
  // 初始化
  // ============================================================
  load();

})();
