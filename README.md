
# File-Go! 📁

一个基于 **Cloudflare Workers** + **Cloudflare D1 (SQLite)** + **Telegram Bot API** 构建的极简文件存储与分享仓库。

前端采用纯黑白灰的极简设计，后端利用 Telegram 频道作为免费且无限容量的对象存储，并通过 Cloudflare 的边缘网络提供全球加速的流式直链下载。

## ✨ 核心特性

- **极简 UI**：纯黑白灰配色，无冗余元素，支持全端响应式。
- **双通道上传**：支持网页直接上传，也支持通过 Telegram 机器人（Webhook）接收文件转存。
- **批量上传**：一次可选择多个文件，按顺序逐个上传，带实时进度与成功 / 跳过 / 失败汇总。
- **流式直链**：隐藏 Bot Token，支持 HTTP Range 请求（视频可自由拖动进度条、支持断点续传）。
- **目录管理**：支持新建文件夹、上传、下载/预览、移动、复制文件及目录。
- **列表顺序**：文件夹在前、文件按上传时间倒序，由服务端排好，页面暂无排序切换。
- **贴近 Windows 的文件操作**：
  - 列表不放复选框，选择靠点击单选、Ctrl 加选、Shift 区间选、Ctrl+A 全选；右键菜单作用于整组选中项，批量执行后汇总成功 / 跳过 / 失败。单击只选中不跳转，进入目录或打开文件用双击（或选中后按 Enter）。
  - 键盘操作：↑ / ↓ 移动焦点、Shift+↑ / ↓ 扩展选择、Enter 打开、F2 重命名、Delete 放入回收站、Backspace 返回上一级、Esc 取消选择；地址栏反映当前路径，浏览器的前进 / 后退直接跟着目录走。
  - 命名沿用 Windows 规则：禁止 `< > : " / \ | ? *`、控制字符、结尾的点或空格，以及 `CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9` 等保留名；同名判定大小写不敏感（`a.txt` 与 `A.TXT` 视为同一个名字）。规则只约束新上传与新命名，历史数据保持原样。
  - 右键**重命名**为行内编辑，默认只选中主名（扩展名不动），Enter 提交、Esc 取消。
  - 同名冲突弹窗提供**替换 / 保留两者 / 跳过**，批量时勾选"应用到全部"后续不再逐项询问；"保留两者"沿用 `名称 (1).ext` 的编号方式。
  - 上传文件名先按同一套规则清洗（非法字符替换为 `_`），再自动避让同名项。
- **回收站独立视图**：顶栏“回收站”按钮切换，条目按删除日期（北京时间，如 `20261122`）分组，只提供**恢复**、不提供彻底删除；恢复回原目录，同名时走冲突弹窗。
- **自定义右键菜单**：屏蔽浏览器默认右键，提供更顺手的文件操作体验。
- **强一致性**：使用 Cloudflare D1 数据库，告别 KV 的最终一致性延迟和全表扫描性能问题。

## 🛠️ 技术栈

- **运行时**：Cloudflare Workers
- **数据库**：Cloudflare D1 (SQLite)
- **存储**：Telegram 私有频道 (通过 Bot API)
- **前端**：原生 HTML + CSS + Vanilla JavaScript

## 📁 项目结构

```text
src/
  index.js           路由表：路径 → 处理函数，本身不含业务
  page/              单页前端，由服务端直接吐出，无构建步骤
    index.js         HTML 骨架，拼接下面两部分
    style.js         CSS
    app.js           内联交互脚本（模板字符串，反斜杠要写两层）
  routes/            HTTP 接口层，只做参数校验与结果封装
    common.js        请求体解析、回收站归档日期、冲突策略透传
    list.js          /api/list、/api/tree
    items.js         /api/mkdir、/api/delete、/api/rename、/api/move、/api/copy
    trash.js         /api/trash、/api/restore
    batch.js         四个 /api/batch-* 批量接口
    upload.js        /api/upload 网页上传
    webhook.js       /webhook Telegram 机器人入库
    file.js          /file/:id 流式下载与 Range 预览
  db/                D1 数据层，唯一写 SQL 的地方
    schema.js        建表与旧库字段兼容
    ids.js           短 ID 生成
    files.js         files 表读写与上传幂等账本
    dirs.js          dirs 表、目录列表、整棵子树搬迁
    naming.js        同名冲突检测与「保留两者」命名
    trash.js         软删除、回收站列表、恢复
    relocate.js      重命名 / 移动 / 复制
    batch.js         批量操作的逐项执行与汇总
    idem.js          Telegram update_id 去重
  telegram.js        Bot API 调用
  utils.js           常量与路径 / 命名 / MIME 工具
test/                断言脚本，node 直接跑，不依赖测试框架
  helpers/           假 D1（node:sqlite）、断言计数、数据层命名空间
scripts/
  dev-harness.mjs    本地夹具：假 D1 + 假 Telegram，把 Worker 跑在 127.0.0.1:8791
  check-inline.mjs   编译 page/app.js 吐出的内联脚本，兜住模板串转义错误
```

## 🧪 本地开发与测试

```bash
npm test          # 数据层 + Windows 语义 + 上传幂等 + 路由透传，共 201 条断言
npm run check     # 编译页面内联脚本；反斜杠少写一层会让整页 JS 静默报废，靠这步拦住
npm run harness   # 起本地夹具，浏览器打开 http://127.0.0.1:8791
npm run dev       # wrangler dev（需要 .dev.vars 提供 BOT_TOKEN）
npm run deploy    # 上线
```

## 🚀 快速部署指南

### 1. 准备工作
1. 在 Telegram 找 `@BotFather` 创建 Bot，获取 `BOT_TOKEN`。
2. 创建一个 Telegram **私有频道**，将 Bot 设为管理员，获取频道 ID（以 `-100` 开头）。
3. 注册 [Cloudflare](https://dash.cloudflare.com/) 账号。

### 2. 配置数据库 (D1)
1. 在 Cloudflare 控制台 -> **Workers & Pages** -> **D1 SQL Database**，创建一个数据库（如 `file-go-db`）。
2. 复制数据库的 **Database ID**，修改项目中的 `wrangler.toml`：
```toml
[[d1_databases]]
binding = "DB"
database_name = "file-go-db"
database_id = "你复制的真实数据库ID"
```

### 3. 设置环境变量
在本地终端（项目根目录）执行以下命令，注入机密变量：
```bash
npx wrangler secret put BOT_TOKEN
# 粘贴你的 TG Bot Token 并回车

npx wrangler secret put CHAT_ID
# 粘贴你的 TG 频道 ID 并回车
```

### 4. 部署上线
执行部署命令：
```bash
npx wrangler deploy
```
*提示：数据库表结构（files, dirs, idem, upload_ledger）会在首次访问时通过 `initSchema` 自动创建，无需手动导入 SQL。*

### 5. 绑定 Telegram Webhook
部署成功后，你会得到一个 Worker 链接（如 `https://file-go.xxx.workers.dev`）。
在浏览器中访问以下链接以激活机器人：
```text
https://api.telegram.org/bot<你的BOT_TOKEN>/setWebhook?url=<你的Worker链接>/webhook
```
看到 `{"ok":true,"result":true,"description":"Webhook was set"}` 即代表成功。

## ⚠️ 注意事项

- **文件大小限制**：受限于 Telegram Bot API 的 `getFile` 方法，**下载**大小严格限制在 **20MB** 以内。网页上传也已强制限制为 20MB。
- **文件夹同名不支持替换**：被删除的目录仍占用 `dirs` 表的路径主键，服务端无法安全合并两个同名目录，因此目录的同名冲突只提供“保留两者”和“跳过”，弹窗里的“替换”会置灰。
- **回收站走独立接口**：回收站视图读 `/api/trash`（按删除日期分组），普通目录列表读 `/api/list`，两者互不混用。被删目录里的孙级条目要先恢复父目录才看得见。`/api/list` 不再附带软删除条目，回收站数据只从 `/api/trash` 取。
- **孤儿文件**：由于网络波动，可能出现 Telegram 文件上传成功但 D1 数据库写入失败的情况。目前属于小概率事件，后续可加入定时清理任务或幂等重试机制。
- **Cloudflare 额度**：D1 免费版每日 500 万行读取、10 万行写入，对于个人或小团队分享完全够用。

