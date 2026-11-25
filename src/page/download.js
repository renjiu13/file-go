// 下载：manifest → 逐片请求 → SHA-256 校验 → 流式写盘（File System Access）或 Blob 兜底。
export function downloadModule(FG) {
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

  async function fetchPart(id, idx, part) {
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch('/file/' + encodeURIComponent(id) + '?part=' + idx);
        if (!res.ok) throw new Error('分片 ' + (idx + 1) + ' 下载失败（' + res.status + '）');
        const buf = await res.arrayBuffer();
        if (buf.byteLength !== part.size) throw new Error('分片 ' + (idx + 1) + ' 大小不符');
        if (part.sha256) {
          const h = await sha256Hex(buf);
          if (h !== part.sha256) throw new Error('分片 ' + (idx + 1) + ' 校验失败');
        }
        return buf;
      } catch (err) {
        lastErr = err;
        await sleep(300 * Math.pow(2, attempt));
      }
    }
    throw lastErr || new Error('下载失败');
  }

  async function run(node) {
    if (!node || !node.id) return;
    // 保存对话框必须在用户手势里打开，所以先选目标再取 manifest
    let writable = null;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: node.name || 'download' });
        writable = await handle.createWritable();
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        writable = null;
      }
    }

    const res = await FG.api('/api/files/' + encodeURIComponent(node.id) + '/manifest');
    if (!res.ok) {
      FG.ui.toast((res.data && res.data.error) || '无法获取下载清单', true);
      return;
    }
    const man = res.data;
    if (!writable && man.size > 300 * 1024 * 1024) {
      const ok = await FG.ui.confirm({
        title: '文件较大',
        message:
          '当前浏览器不支持流式保存，需要把整个文件读入内存（' +
          FG.listing.fmtSize(man.size) +
          '）。继续？',
        okText: '继续',
      });
      if (!ok) return;
    }

    const task = FG.ui.progress.create('下载 ' + man.name);
    const chunks = [];
    let done = 0;
    try {
      for (let i = 0; i < man.chunkCount; i++) {
        const part = man.parts[i];
        const buf = await fetchPart(man.id, i, part);
        if (writable) await writable.write(new Uint8Array(buf));
        else chunks.push(buf);
        done += buf.byteLength;
        task.update(man.size ? done / man.size : 1, FG.listing.fmtSize(done) + ' / ' + FG.listing.fmtSize(man.size));
      }
      if (writable) {
        await writable.close();
        writable = null;
      } else {
        const blob = new Blob(chunks, { type: man.mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = man.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      task.done();
    } catch (err) {
      if (writable) {
        try {
          await writable.abort();
        } catch (_) {}
      }
      const msg = (err && err.message) || '下载失败';
      task.fail('失败');
      FG.ui.toast(msg, true);
    }
  }

  FG.download = { run };
}
