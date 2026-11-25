# File-Go! 📁

一个基于 **Cloudflare Workers** + **D1 (SQLite)** + **Telegram Bot API** 的分片文件存储与分享仓库：文件切成 16 MiB 的分片存进 Telegram 频道，Worker 只做流式中继和元数据权威写入，切片、哈希、并发与校验全部交给浏览器。

## ✨ 核心特性

- **16 MiB 分片存储**：每个分片单独作为一条 Telegram 消息保存，文件大小不再受 Bot API 单文件 20 MB 下载上限约束（网页端可上传到 1 TiB）。
- **浏览器分片上传**：`crypto.subtle.digest` 逐片算 SHA-256，3 路并发、指数退避重试；断点续传状态存 IndexedDB，刷新后只补缺失分片。
- **下载分段 + 逐片校验**：按 manifest 逐片拉取、校验大小与 SHA-256，通过 File System Access API 流式写盘，整文件不进浏览器内存。
- **Range 直链**：`/file/:id` 支持 `bytes=a-b`、`bytes=a-`、`bytes=-n`，视频可直接拖动进度条。
- **50 子请求预算内截断**：一次响应最多转发 42 个 Telegram 子请求，超出时返回 `206` 并只承诺已发送的区间，浏览器自动续传下一段。
- **元数据零 Telegram 开销**：新建/重命名/移动/复制/删除/恢复只改 D1；复制文件只新增 `file_parts` 引用，不重传 Telegram。
- **Bot 直接入库**：Webhook 收到的文件已在 Telegram 上，直接建节点，不下载不重传（受 `getFile` 限制，Bot 入口 20 MB 上限）。
- **回收站**：删除目录时整棵子树共享同一个 `trash_id`；恢复只允许恢复顶层项，自动处理重名。
- **Windows 式操作**：点击/Ctrl/Shift 选择、右键菜单、F2 重命名、Delete 删除、Enter 打开、地址栏反映目录、浏览器前进后退跟随目录。
- **命名规则**：禁止 `< > : " / \ | ? *`、控制字符、结尾点或空格，以及 `CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`；同名按大小写不敏感判定；冲突弹窗支持替换 / 保留两者 / 跳过。
- **Cron 清理**：每 5 分钟删除待清理的 Telegram 消息（每次 ≤40）并回收过期上传会话（每次 ≤20），控制子请求预算。

## 🛠️ 技术栈

- **运行时**：Cloudflare Workers（免费版即可）
- **数据库**：Cloudflare D1 (SQLite)
- **存储**：Telegram 私有频道（Bot API）
- **前端**：原生 HTML + CSS + Vanilla JavaScript，无构建步骤

## 📁 项目结构

```text
src/
  index.js            路由分发、Webhook 密钥、Cron 入口
  range.js            Range 解析、分片映射、42 子请求预算
  path-cache.js       tg_file_id → file_path 缓存（内存 + Cache API，45 分钟）
  telegram.js         Bot API：流式 multipart 上传、Range 下载、删消息
  cron.js             消费 pending_deletes + 过期上传会话
  utils.js            命名/路径/MIME/JSON 工具
  db/
    schema.js         建表、索引、旧库迁移
    ids.js            16 位 base62 ID
    nodes.js          nodes 表：目录列表、路径解析、重命名/移动/复制/回收站
    parts.js          file_parts 表 + pending_deletes 队列
    naming.js         冲突检测与「保留两者」命名
    idem.js           Telegram update_id 去重
  routes/
    common.js         请求体解析、冲突策略、no-store
    list.js           /api/list、/api/tree
    items.js          /api/mkdir、rename、move、copy、delete、restore
    trash.js          /api/trash
    batch.js          /api/batch（单次最多 8 项）
    upload.js         /api/upload/init、part、complete、abort、status
    file.js           /api/files/:id/manifest、/file/:id Range 下载
    webhook.js        Telegram Bot 入库
  page/               单页前端，由服务端吐出一个内联脚本
    index.js          拼接 HTML 与各模块
    style.js          CSS
    naming.js         与服务端一致的命名规则
    ui.js             toast / modal / prompt / 冲突弹窗 / 目录选择器 / 上传进度
    listing.js        列表渲染、排序、搜索、框选
    trash.js          回收站视图
    selection.js      键盘选择
    upload.js         切片、哈希、并发、IndexedDB 续传
    download.js       manifest、逐片校验、流式写盘
    contextmenu.js    自定义右键菜单
    app.js            路由、状态、API 封装与入口
test/                 断言脚本，node 直接跑，不依赖测试框架
  helpers/            假 D1（node:sqlite）、假 Telegram、断言计数
  fixtures/           命名规则共享向量
  *.test.mjs          共 458 条断言
scripts/
  dev-harness.mjs     假 D1 + 假 Telegram，Worker 跑在 127.0.0.1:8791
  check-inline.mjs    编译页面内联脚本，兜住语法/转义错误
```

## 🧪 本地开发与测试

```bash
npm test          # 命名 / Range / 数据层 / 上传 / 下载 / 元数据 / Webhook / Cron，共 458 条断言
npm run check     # 编译页面内联脚本
npm run harness   # 本地夹具：http://127.0.0.1:8791（含多分片文件 multi.txt）
npm run dev       # wrangler dev（需要 .dev.vars 提供 BOT_TOKEN / CHAT_ID）
npm run deploy    # 上线
```

`wrangler.toml` 已包含每 5 分钟的 Cron 触发：

```toml
[triggers]
crons = ["*/5 * * * *"]
```

## 🚀 部署

1. 在 BotFather 创建 Bot，拿到 `BOT_TOKEN`；建一个私有频道并把 Bot 设为管理员，拿到 `CHAT_ID`（`-100` 开头）。
2. 创建 D1 数据库，把 `database_id` 填进 `wrangler.toml`。
3. 注入密钥：

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put CHAT_ID
# 可选：Webhook 共享密钥，设置后 Telegram 请求必须带 X-Telegram-Bot-Api-Secret-Token
npx wrangler secret put WEBHOOK_SECRET
```

4. `npx wrangler deploy`。首次请求会自动建表并迁移旧库（见下）。
5. 绑定 Webhook（有密钥时加 `secret_token`）：

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<Worker 地址>/webhook&secret_token=<WEBHOOK_SECRET>
```

## 🔁 旧库迁移

首次 `initSchema` 会把旧的 `files` / `dirs` 表迁移进 `nodes` / `file_parts`：

- 只迁移**未删除**的旧数据；旧回收站内容保留在原表，不再出现在新界面。
- 每个旧文件变成单分片节点：`chunk_size = size`、`chunk_count = 1`，并写入一条 `file_parts`（`message_id`、`sha256` 为 `NULL`）。
- 旧文件 id 若符合 10–16 位字母数字则原样保留，旧链接继续可用。
- 迁移标记写在 `meta` 表（`legacy_migrated_v1`），迁移失败不会留下标记，下次请求重试。
- 迁移后代码不再区分新旧路径。

## ⚠️ 注意事项

- **20 MB 硬限制只针对 Bot 入口**：网页上传走分片，不受此限；但 Bot 收到的文件受 `getFile` 20 MB 限制，超过会回复提示改用网页端。
- **地址栏直链大文件会被截断**：免费版单次调用 50 个子请求，`/file/:id` 一次最多转发 42 片（16 MiB × 42 ≈ 672 MiB，含缓存未命中的 `getFile` 时更少）。这是设计内的行为，不是 bug；网页内下载按钮会自动分段续传，视频播放每次只取小段，不受影响。
- **不做整文件哈希**：`crypto.subtle.digest` 不支持流式哈希，逐片校验已能发现传输错误。
- **目录同名不支持替换**：目录冲突只提供「保留两者 / 跳过」。
- **回收站只恢复顶层项**：删除目录后整棵子树共享 `trash_id`，恢复目录会一起恢复；子项不能单独恢复。
- **孤儿分片清理不保证 100%**：`deleteMessage` 受 Bot 权限与消息时效限制，删不掉的消息仍会从 D1 队列移除，接受少量残留。
- **D1 免费额度**：每日 10 万行写入 / 500 万行读取，个人使用足够；单次调用最多 50 次查询，所以批量操作上限 8 项。
