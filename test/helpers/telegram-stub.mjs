// 假 Telegram Bot API：记录调用、吃掉流式 multipart、按 file_id 回放字节。
// 测试里的 worker 和真实运行时一样走 globalThis.fetch，所以这里直接替换它。
const TG_API = 'https://api.telegram.org';

function findBytes(haystack, needle, from = 0) {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function installTelegram(options = {}) {
  const enc = new TextEncoder();
  const state = {
    calls: {},
    files: new Map(),          // file_id -> Uint8Array
    messages: [],              // sendMessage 文本
    downloads: 0,
    lastRange: null,
    ignoreRange: !!options.ignoreRange,
    contentLengthMismatch: false,
    failures: [],              // {method, status, description, retryAfter, times}
  };
  const realFetch = globalThis.fetch;

  async function readBody(init) {
    if (!init || init.body == null) return new Uint8Array(0);
    return new Uint8Array(await new Response(init.body).arrayBuffer());
  }

  function takeFailure(method) {
    const f = state.failures.find((x) => x.method === method && x.times > 0);
    if (!f) return null;
    f.times--;
    return f;
  }

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith(TG_API + '/')) return realFetch(url, init);
    const headers = new Headers(init.headers || {});

    if (u.includes('/file/bot')) {
      const id = decodeURIComponent(u.split('/').pop());
      state.downloads++;
      const fail = takeFailure('download');
      if (fail) return new Response('nope', { status: fail.status });
      const bytes = state.files.get(id);
      if (!bytes) return new Response('missing', { status: 404 });
      const range = headers.get('range');
      state.lastRange = range;
      if (!range || state.ignoreRange) {
        return new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.length) } });
      }
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), bytes.length - 1);
      const body = bytes.slice(start, end + 1);
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Content-Length': String(body.length),
        },
      });
    }

    const method = u.split('/').pop().split('?')[0];
    state.calls[method] = (state.calls[method] || 0) + 1;
    const fail = takeFailure(method);
    if (fail) {
      const data = { ok: false, error_code: fail.status, description: fail.description || 'stub failure' };
      if (fail.retryAfter) data.parameters = { retry_after: fail.retryAfter };
      return Response.json(data, { status: fail.status });
    }

    if (method === 'sendDocument') {
      const boundary = (/boundary=([^;]+)/.exec(headers.get('content-type') || '') || [])[1];
      const buf = await readBody(init);
      const declared = headers.get('content-length');
      if (declared != null && Number(declared) !== buf.length) state.contentLengthMismatch = true;
      const docAt = findBytes(buf, enc.encode('name="document"'));
      const dataStart = docAt < 0 ? -1 : findBytes(buf, enc.encode('\r\n\r\n'), docAt);
      const dataEnd = findBytes(buf, enc.encode(`\r\n--${boundary}--`));
      const bytes = dataStart < 0 || dataEnd < 0 ? new Uint8Array(0) : buf.slice(dataStart + 4, dataEnd);
      const id = 'file_' + (state.files.size + 1) + '_' + Math.random().toString(36).slice(2, 8);
      state.files.set(id, bytes);
      return Response.json({ ok: true, result: { message_id: 1000 + state.files.size, document: { file_id: id } } });
    }
    if (method === 'getFile') {
      const body = init.body ? JSON.parse(await new Response(init.body).text()) : {};
      if (!state.files.has(body.file_id)) return Response.json({ ok: false, error_code: 400, description: 'bad file id' }, { status: 400 });
      return Response.json({ ok: true, result: { file_path: `parts/${body.file_id}` } });
    }
    if (method === 'sendMessage') {
      const body = init.body ? JSON.parse(await new Response(init.body).text()) : {};
      state.messages.push(body.text);
      return Response.json({ ok: true, result: { message_id: 900 + state.messages.length } });
    }
    if (method === 'deleteMessage') return Response.json({ ok: true, result: true });
    return Response.json({ ok: true, result: true });
  };

  return {
    state,
    addFile(id, bytes) { state.files.set(id, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); },
    failNext(method, status, opts = {}) {
      state.failures.push({ method, status, description: opts.description, retryAfter: opts.retryAfter, times: opts.times || 1 });
    },
    restore() { globalThis.fetch = realFetch; },
  };
}
