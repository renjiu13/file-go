// 校验 page.js 模板串最终吐给浏览器的内联脚本能否编译。
// 模板串里反斜杠少写一层，正则就会静默换个意思、并让整页 JS 抛 SyntaxError，只有编译这一步能发现。
import { Script } from 'node:vm';
import { renderPage } from '../src/page/index.js';

const OPEN = '<script>';
const CLOSE = '</script>';
const html = renderPage();
const start = html.indexOf(OPEN);
const end = html.lastIndexOf(CLOSE);
if (start < 0 || end < start) {
  console.error('页面里找不到内联脚本');
  process.exit(1);
}

const js = html.slice(start + OPEN.length, end);
try {
  new Script(js, { filename: 'page-inline.js' });
} catch (err) {
  console.error(`内联脚本编译失败：${err.message}`);
  const at = err.stack.split('\n').slice(0, 4).join('\n');
  console.error(at);
  process.exit(1);
}
console.log(`内联脚本编译通过：${js.length} 字符，${js.split('\n').length} 行`);
