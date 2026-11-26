// 图标：列表行与目录树使用同一组 SVG，颜色跟随文字，不再用 emoji。
import { readFileSync, readdirSync } from 'node:fs';
import { iconsModule } from '../src/page/icons.js';
import { listingModule } from '../src/page/listing.js';
import { renderPage } from '../src/page/index.js';
import { createAssert } from './helpers/assert.mjs';

const t = createAssert();
const FG = {};
iconsModule(FG);
FG.state = { selected: new Set(), focusIdx: -1, trashMode: false };
listingModule(FG);

const folder = FG.icons.folder;
const file = FG.icons.file;

t.ok(folder.includes('<svg') && folder.includes('</svg>'), 'folder 是完整 svg');
t.ok(file.includes('<svg') && file.includes('</svg>'), 'file 是完整 svg');
t.ok(folder.includes('stroke="currentColor"'), 'folder 颜色跟随文字');
t.ok(file.includes('stroke="currentColor"'), 'file 颜色跟随文字');
t.ok(folder.includes('viewBox="0 0 24 24"'), 'folder viewBox');
t.ok(file.includes('viewBox="0 0 24 24"'), 'file viewBox');
t.ok(/width="16"\s+height="16"/.test(folder), 'folder 16px');
t.ok(/width="16"\s+height="16"/.test(file), 'file 16px');
t.ok(!/<svg[^>]*fill="(?!none)/.test(folder), 'folder 不填充内部');
t.eq(FG.icons.of('dir'), folder, 'of(dir) 取文件夹图标');
t.eq(FG.icons.of('file'), file, 'of(file) 取文件图标');
t.eq(FG.icons.of('other'), file, '未知类型回落文件图标');

const dirRow = FG.listing.rowHtml({ id: 'd1', kind: 'dir', name: 'docs', createdAt: 0, updatedAt: 0 }, 0);
const fileRow = FG.listing.rowHtml({ id: 'f1', kind: 'file', name: 'a.txt', size: 12, createdAt: 0 }, 1);
t.ok(dirRow.includes('<span class="ico">' + folder + '</span>'), '目录行用文件夹图标');
t.ok(fileRow.includes('<span class="ico">' + file + '</span>'), '文件行用文件图标');
t.ok(!/📁|📄/.test(dirRow + fileRow), '行内不再出现 emoji 图标');
t.ok(dirRow.includes('data-id="d1"'), '图标改动不影响行数据属性');

const page = renderPage();
t.ok(page.includes('iconsModule'), '页面脚本包含图标模块');
t.ok(page.includes('FG.icons.of('), '页面脚本按 kind 取图标');
t.ok(page.includes('stroke-width="1.8"'), '页面脚本内联 svg 轮廓');
t.ok(!/📁|📄/.test(page), '页面不再含 emoji 图标');

// 目录树（选择目录弹窗）同样带图标。
const uiSource = readFileSync(new URL('../src/page/ui.js', import.meta.url), 'utf8');
t.ok(uiSource.includes("FG.icons.folder"), '目录树使用 FG.icons.folder');
t.ok(!/row\.textContent = d\.path/.test(uiSource), '目录树不再用纯文本节点');
t.ok(readFileSync(new URL('../src/page/style.js', import.meta.url), 'utf8').includes('.tree-label'), '目录树标签有截断样式');

// 全部页面模块都不应再出现 emoji 图标。
const dir = new URL('../src/page/', import.meta.url);
const offenders = readdirSync(dir)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => /📁|📄/.test(readFileSync(new URL(f, dir), 'utf8')));
t.eq(offenders, [], '页面模块无 emoji 图标残留');

t.done();
