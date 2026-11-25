// 临时诊断：用最小 DOM 桩在 node:vm 里执行页面内联脚本，验证初始化与列表渲染。
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const base = 'http://127.0.0.1:8791';
const html = await (await fetch(base + '/')).text();
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) throw new Error('no inline script');

class El {
  constructor(id = '') {
    this.id = id;
    this.tagName = 'DIV';
    this.children = [];
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this.value = '';
    this.files = null;
    this._listeners = {};
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      toggle: (c, on) => (on === undefined ? (this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c)) : on ? this._classes.add(c) : this._classes.delete(c)),
      contains: (c) => this._classes.has(c),
    };
  }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  remove() {}
  setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  click() {}
  focus() {}
  scrollIntoView() {}
}

const ids = ['status', 'modal', 'modalTitle', 'modalBody', 'modalActions', 'list', 'breadcrumb', 'selInfo', 'btnMkdir', 'btnUpload', 'btnTrash', 'btnRefresh', 'fileInput', 'search', 'sort', 'uploads', 'ctx-menu'];
const els = new Map(ids.map((id) => [id, new El(id)]));
els.get('sort').value = 'name';
els.get('fileInput').tagName = 'INPUT';
els.get('search').tagName = 'INPUT';

const documentStub = {
  getElementById: (id) => els.get(id) || null,
  createElement: (tag) => { const e = new El(); e.tagName = tag.toUpperCase(); return e; },
  addEventListener() {},
  body: new El('body'),
};

const locationStub = { hash: '', origin: base, href: base + '/' };
const windowStub = { addEventListener() {}, location: locationStub };
const historyStub = { replaceState() {}, pushState() {} };

const errors = [];
process.on('unhandledRejection', (e) => errors.push(e));
process.on('uncaughtException', (e) => errors.push(e));

const context = vm.createContext({
  document: documentStub,
  window: windowStub,
  location: locationStub,
  history: historyStub,
  navigator: {},
  crypto: webcrypto,
  URL,
  URLSearchParams,
  Blob,
  FormData,
  Headers,
  Request,
  Response,
  ReadableStream,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  console,
  fetch: (path, init) => fetch(new URL(String(path), base), init),
});
vm.runInContext(m[1], context, { filename: 'inline.js' });

await new Promise((r) => setTimeout(r, 1500));
console.log('errors:', errors.map((e) => e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)));
console.log('status:', JSON.stringify(els.get('status').textContent));
console.log('breadcrumb:', JSON.stringify(els.get('breadcrumb').innerHTML));
console.log('list len:', els.get('list').innerHTML.length);
console.log('list head:', els.get('list').innerHTML.slice(0, 220));
