
# File-Go! 📁

一个基于 **Cloudflare Workers** + **Cloudflare D1 (SQLite)** + **Telegram Bot API** 构建的极简文件存储与分享仓库。

前端采用纯黑白灰的极简设计，后端利用 Telegram 频道作为免费且无限容量的对象存储，并通过 Cloudflare 的边缘网络提供全球加速的流式直链下载。

## ✨ 核心特性

- **极简 UI**：纯黑白灰配色，无冗余元素，支持全端响应式。
- **双通道上传**：支持网页直接上传，也支持通过 Telegram 机器人（Webhook）接收文件转存。
- **流式直链**：隐藏 Bot Token，支持 HTTP Range 请求（视频可自由拖动进度条、支持断点续传）。
- **目录管理**：支持新建文件夹、上传、下载/预览、移动、复制文件及目录。
- **回收站机制**：软删除设计，按北京时间日期（如 `20261026`）自动归档，支持一键恢复。
- **自定义右键菜单**：屏蔽浏览器默认右键，提供更顺手的文件操作体验。
- **强一致性**：使用 Cloudflare D1 数据库，告别 KV 的最终一致性延迟和全表扫描性能问题。

## 🛠️ 技术栈

- **运行时**：Cloudflare Workers
- **数据库**：Cloudflare D1 (SQLite)
- **存储**：Telegram 私有频道 (通过 Bot API)
- **前端**：原生 HTML + CSS + Vanilla JavaScript

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
*提示：数据库表结构（files, dirs, idem）会在首次访问时通过 `initSchema` 自动创建，无需手动导入 SQL。*

### 5. 绑定 Telegram Webhook
部署成功后，你会得到一个 Worker 链接（如 `https://file-go.xxx.workers.dev`）。
在浏览器中访问以下链接以激活机器人：
```text
https://api.telegram.org/bot<你的BOT_TOKEN>/setWebhook?url=<你的Worker链接>/webhook
```
看到 `{"ok":true,"result":true,"description":"Webhook was set"}` 即代表成功。

## ⚠️ 注意事项

- **文件大小限制**：受限于 Telegram Bot API 的 `getFile` 方法，**下载**大小严格限制在 **20MB** 以内。网页上传也已强制限制为 20MB。
- **孤儿文件**：由于网络波动，可能出现 Telegram 文件上传成功但 D1 数据库写入失败的情况。目前属于小概率事件，后续可加入定时清理任务或幂等重试机制。
- **Cloudflare 额度**：D1 免费版每日 500 万行读取、10 万行写入，对于个人或小团队分享完全够用。

