// 校验内联脚本：既要能编译，也不能引用「只有打包器才认识」的辅助函数。
// 页面模块靠 Function.toString() 拼进 HTML，而 wrangler 的 esbuild 默认 keep_names = true，
// 会把函数包成 __name(fn, "name")——定义留在 Worker 作用域，引用进了浏览器就是 ReferenceError，
// 整页 JS 静默报废。npm run harness 不打包，只有这里能拦住。
import { Script } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderPage } from '../src/page/index.js';

const OPEN = '<script>';
const CLOSE = '</script>';

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function inlineOf(html) {
  const start = html.indexOf(OPEN);
  const end = html.lastIndexOf(CLOSE);
  if (start < 0 || end < start) fail('页面里找不到内联脚本');
  return html.slice(start + OPEN.length, end);
}

// 反斜杠少写一层会让正则静默换个意思、并让整页 JS 抛 SyntaxError，只有编译这一步能发现。
function compile(js, label) {
  try {
    new Script(js, { filename: `page-inline-${label}.js` });
  } catch (err) {
    fail(`${label}：内联脚本编译失败 — ${err.message}\n${err.stack.split('\n').slice(0, 4).join('\n')}`);
  }
  return js;
}

// 打包器注入的 __ 前缀 helper：脚本里引用到，就必须能在脚本内部找到定义。
function missingHelpers(js) {
  const used = new Set();
  for (const m of js.matchAll(/\b(__[A-Za-z][A-Za-z0-9]*)\s*\(/g)) used.add(m[1]);
  const missing = [];
  for (const name of used) {
    if (!new RegExp(`\\b(?:var|let|const|function)\\s+${name}\\b`).test(js)) missing.push(name);
  }
  return missing;
}

async function bundleWithKeepNames() {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    fail('解析不到 esbuild，无法校验打包后的内联脚本（npm install 会带上它）');
  }
  const out = await esbuild.build({
    entryPoints: [path.resolve('src/page/index.js')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    keepNames: true,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-go-check-'));
  const file = path.join(dir, 'page-bundle.mjs');
  fs.writeFileSync(file, out.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  fs.rmSync(dir, { recursive: true, force: true });
  return inlineOf(mod.renderPage());
}

const plain = compile(inlineOf(renderPage()), 'plain');
const kept = compile(await bundleWithKeepNames(), 'keepNames');

const missing = missingHelpers(kept);
if (missing.length) {
  fail(
    `内联脚本引用了打包器注入的 ${missing.join(', ')}，浏览器里没有定义，整页 JS 会直接报错。\n` +
      '  要么在 src/page/index.js 的 buildApp() 里补上兜底定义，要么确认 wrangler.toml 的 keep_names = false。',
  );
}
if (!/__name/.test(kept)) {
  console.log('! keepNames 打包后没有出现 __name，这条校验暂时拦不到东西（esbuild 行为变了？）');
}

console.log(
  `内联脚本校验通过：未打包 ${plain.length} 字符/${plain.split('\n').length} 行，` +
    `keepNames 打包 ${kept.length} 字符/${kept.split('\n').length} 行，无未定义引用`,
);
