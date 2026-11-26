// 上传：切片、SHA-256、3 路并发、重试、断点续传（IndexedDB）与完成确认。
// 分片大小完全以服务端返回的 chunkSize 为准，浏览器不假设 16 MiB。
export function uploadModule(FG) {
  const IDB_NAME = 'filego';
  const IDB_STORE = 'uploads';

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function sha256Hex(buf) {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('浏览器不支持 IndexedDB'));
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    });
  }

  async function idbGet(key) {
    let db;
    try {
      db = await idbOpen();
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const rq = tx.objectStore(IDB_STORE).get(key);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      });
    } catch (e) {
      try {
        if (db) db.close();
      } catch (_) {}
      return null;
    }
  }

  async function idbPut(rec) {
    let db;
    try {
      db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      // 断点信息是尽力而为，失败不影响上传
    } finally {
      try {
        if (db) db.close();
      } catch (_) {}
    }
  }

  async function idbDel(key) {
    let db;
    try {
      db = await idbOpen();
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (e) {
      // ignore
    } finally {
      try {
        if (db) db.close();
      } catch (_) {}
    }
  }

  function partSize(node, idx) {
    if (idx === node.chunkCount - 1) return node.size - idx * node.chunkSize;
    return node.chunkSize;
  }

  async function putPart(node, idx, blob, expected, sha) {
    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      let res;
      try {
        res = await fetch(
          '/api/upload/' + encodeURIComponent(node.id) + '/part/' + idx,
          {
            method: 'PUT',
            headers: {
              'X-Part-SHA256': sha,
              'X-File-Go-Csrf': '1',
              'Content-Type': 'application/octet-stream',
            },
            body: blob,
          }
        );
      } catch (err) {
        lastErr = err;
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
      if (res.status === 200) return;
      if (res.status === 429) {
        const ra = Number(res.headers.get('Retry-After') || 5);
        await sleep(Math.max(1, ra) * 1000);
        continue;
      }
      if (res.status >= 500) {
        lastErr = new Error('服务器错误（' + res.status + '）');
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
      let msg = '分片上传失败（' + res.status + '）';
      try {
        const data = await res.json();
        if (data && data.error) msg = data.error;
      } catch (_) {}
      throw new Error(msg);
    }
    throw lastErr || new Error('分片上传失败');
  }

  async function initUpload(file, parentId, modeState) {
    const base = {
      parentId: parentId || null,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    };
    async function send(mode) {
      const body = Object.assign({}, base);
      if (mode) body.onConflict = mode;
      return FG.api('/api/upload/init', { method: 'POST', body });
    }
    let res = await send(null);
    if (res.status === 409) {
      let mode = modeState.mode;
      if (!mode) {
        const pick = await FG.ui.conflict(file.name);
        if (!pick) return { skipped: true };
        mode = pick.mode;
        if (pick.applyAll) modeState.mode = mode;
      }
      res = await send(mode);
      if (res.data && res.data.clashKind === 'dir' && (mode === 'replace' || mode === 'overwrite')) {
        FG.ui.toast('文件夹同名冲突不支持替换，已改为保留两者', true);
        res = await send('keep-both');
      }
    }
    if (res.status === 200 && res.data && res.data.skipped) return { skipped: true };
    if (!res.ok) throw new Error((res.data && res.data.error) || '初始化上传失败');
    return { node: res.data };
  }

  async function uploadOne(file, modeState, task) {
    if (!file.size) throw new Error('空文件不支持上传');
    const key = file.name + '|' + file.size + '|' + file.lastModified;
    const parentId = FG.state.dirId || null;

    let node = null;
    let haveParts = [];
    const rec = await idbGet(key);
    if (rec && rec.nodeId) {
      const r = await FG.api('/api/upload/' + encodeURIComponent(rec.nodeId));
      if (
        r.ok &&
        r.data &&
        r.data.node &&
        r.data.node.status === 'uploading' &&
        r.data.node.size === file.size
      ) {
        node = r.data.node;
        haveParts = r.data.parts || [];
      }
    }
    if (!node) {
      const init = await initUpload(file, parentId, modeState);
      if (init.skipped) return { skipped: true };
      node = init.node;
    }

    const total = node.chunkCount;
    const existing = new Map();
    for (const p of haveParts) existing.set(p.idx, p);

    let doneParts = 0;
    let aborted = false;
    const abortError = new Error('已取消上传');
    task.update(0);
    task.setCancel(async () => {
      aborted = true;
      try {
        await FG.api('/api/upload/' + encodeURIComponent(node.id) + '/abort', { method: 'POST', body: {} });
      } catch (_) {}
      try {
        await idbDel(key);
      } catch (_) {}
    });

    let next = 0;
    const worker = async () => {
      for (;;) {
        const idx = next;
        next += 1;
        if (idx >= total) return;
        if (aborted) throw abortError;
        const start = idx * node.chunkSize;
        const end = Math.min(node.size, start + node.chunkSize);
        const expected = end - start;
        const blob = file.slice(start, end);
        const buf = await blob.arrayBuffer();
        const sha = await sha256Hex(buf);
        const old = existing.get(idx);
        if (old && old.size === expected && old.sha256 === sha) {
          doneParts += 1;
          task.update(doneParts / total, Math.round((doneParts / total) * 100) + '%');
          continue;
        }
        await putPart(node, idx, blob, expected, sha);
        if (aborted) throw abortError;
        doneParts += 1;
        task.update(doneParts / total, Math.round((doneParts / total) * 100) + '%');
        await idbPut({ key, nodeId: node.id, name: node.name, size: node.size, updatedAt: Date.now() });
      }
    };

    await Promise.all([worker(), worker(), worker()]);
    if (aborted) throw abortError;

    task.update(0.99, '校验中');
    const comp = await FG.api('/api/upload/' + encodeURIComponent(node.id) + '/complete', {
      method: 'POST',
      body: {},
    });
    if (!comp.ok) throw new Error((comp.data && comp.data.error) || '完成上传失败');
    await idbDel(key);
    return { name: (comp.data && comp.data.name) || node.name };
  }

  async function run(files) {
    const list = Array.from(files || []).filter((f) => f && f.size > 0);
    if (!list.length) {
      FG.ui.toast('没有可上传的文件（空文件不支持）');
      return;
    }
    const modeState = { mode: null };
    for (const file of list) {
      const task = FG.ui.progress.create(file.name);
      try {
        const r = await uploadOne(file, modeState, task);
        if (r && r.skipped) {
          task.remove();
          FG.ui.toast('已跳过：' + file.name);
        } else {
          task.done();
        }
      } catch (err) {
        const msg = err && err.message ? err.message : '上传失败';
        task.fail(msg.length > 24 ? '失败' : msg);
        FG.ui.toast(msg + '：' + file.name, true);
      }
    }
    await FG.app.refresh();
  }

  FG.upload = { run, sha256Hex };
}
