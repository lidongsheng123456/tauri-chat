# LanChat — 内置 AI 的局域网聊天工具

> 零服务器、零审查、零成本。局域网即时通讯 + DeepSeek AI 助手 + 14 项智能工具 + MCP 协议服务。

---

## AI 能力

LanChat 内置 DeepSeek AI 助手，不只是简单问答，而是具备 **14 项工具调用能力** 的智能体，能真正帮你完成工作。

### 工具矩阵

| 类别 | 工具 | 说明 |
|------|------|------|
| **Web** | `browse_website` | 抓取并解析网页，返回标题、正文、链接 |
| | `fetch_url_raw` | 获取 URL 原始内容（API / JSON） |
| | `web_search` | 互联网搜索（DuckDuckGo），获取实时信息 |
| | `extract_webpage_images` | 提取网页中所有图片 URL 和描述 |
| **文件系统** | `read_file` | 读取文件内容，查看代码 / 配置 |
| | `write_file` | 创建或覆盖文件，写脚本 / 改 bug |
| | `list_directory` | 列出目录结构 |
| | `create_directory` | 创建目录（递归） |
| | `delete_path` | 删除文件或目录 |
| | `search_files` | 按关键词递归搜索文件 |
| **实用工具** | `get_current_datetime` | 获取当前日期时间、时区 |
| | `encode_decode` | Base64 / URL / Hex 编解码 |
| | `get_ip_geolocation` | IP 地理位置查询 |
| | `text_stats` | 文本字符数 / 词数 / 行数统计 |

### 工作流示例

```
你: 帮我看看 D:\project\src\main.rs 有没有 bug

AI: [调用 read_file] → 读取代码 → 分析逻辑 → 指出问题 → [调用 write_file] → 直接修复
```

```
你: 搜一下 Rust 最新的 async 最佳实践

AI: [调用 web_search] → 获取结果 → [调用 browse_website] → 深入阅读 → 总结要点
```

```
你: 把 D:\data 目录整理一下，按日期分类

AI: [调用 list_directory] → 分析结构 → [调用 create_directory] → 建立分类目录 → 给出操作建议
```

- 支持 **多轮工具调用**（最多 5 轮），AI 会根据上一步结果自动决定下一步
- 支持 **上下文连续对话**，保留最近 20 条消息作为上下文
- 工具调用过程中前端会显示实时状态提示（浏览中… / 搜索中… / 读取文件…）

### MCP 服务

内置 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器（端口 9121），14 项工具全部通过 JSON-RPC 2.0 标准接口暴露，可被任何支持 MCP 的 AI 客户端调用。

```bash
# 测试 MCP 服务
curl -X POST http://localhost:9121/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## 聊天功能

| 功能 | 说明 |
|------|------|
| 即时消息 | 公共频道 + 私聊，WebSocket 实时收发 |
| 文件共享 | 拖拽发送，无大小限制，局域网满速传输 |
| 图片 / 视频 | 原图原画质，支持在线预览和全屏查看 |
| 传输指示器 | 全局浮动进度面板，上传 / 下载状态跨页面持久显示 |
| 远程下载 | 跨设备文件下载，自动绕过系统代理 |
| 自动发现 | 打开即可看到同一网络内所有在线用户 |

### 为什么不用微信？

| 对比项 | 微信 / 钉钉 | LanChat |
|--------|-------------|---------|
| 封号风险 | 有 | **无**（没有平台就没有封号） |
| 隐私保护 | 消息经过平台服务器 | **纯局域网传输**，数据不离开本地 |
| 文件限制 | 200MB / 压缩画质 | **无限制 / 原图原画质** |
| 传输速度 | 1-10 MB/s | **100-1000 MB/s**（局域网） |
| 需要外网 | 是 | **否** |
| 需要注册 | 是 | **否** |
| AI 工具 | 无 | **14 项智能工具** |
| 部署成本 | 免费 / 付费 | **免费开源** |

---

## 技术架构

```
┌──────────────────────────────────────────────────────────────┐
│                      LanChat v2.0                            │
│                                                              │
│  ┌─────────────────┐       ┌─────────────────────────────┐  │
│  │  React 19 前端   │◄─────►│  Tauri 2 (Rust) 后端        │  │
│  │  TypeScript      │       │                             │  │
│  │                  │       │  commands/    ← Controller   │  │
│  │  components/     │       │   ai_cmd / file / network   │  │
│  │  hooks/          │       │                             │  │
│  │  styles/         │       │  services/    ← Service     │  │
│  │  config.ts       │       │   ai/    chat_service       │  │
│  │                  │       │          tool_registry      │  │
│  │                  │       │          utility_tools       │  │
│  │                  │       │   web/   scraper / search   │  │
│  │                  │       │   file/  download / tools   │  │
│  │                  │       │   mcp_server                │  │
│  │                  │       │   network_service           │  │
│  │                  │       │                             │  │
│  │                  │       │  models/      ← Model       │  │
│  │                  │       │  server/      ← Infra       │  │
│  │                  │       │  utils/       ← Utils       │  │
│  │                  │       │  config.rs    ← Config      │  │
│  └─────────────────┘       └─────────────────────────────┘  │
└──────┬──────────────────────────────┬───────────────────┬────┘
       │ WebSocket + HTTP            │ JSON-RPC 2.0      │
       ▼                             ▼                   ▼
┌──────────────┐            ┌──────────────┐    ┌──────────────┐
│  局域网 LAN   │            │  MCP Server  │    │  DeepSeek AI │
│  :9120       │            │  :9121       │    │  (外网 API)   │
└──────────────┘            └──────────────┘    └──────────────┘
```

**后端分层架构**（Java 解耦思想）：

| 层级 | 目录 | 职责 |
|------|------|------|
| Controller | `commands/` | Tauri IPC 命令，纯委托调用 |
| Service | `services/ai/` | AI 对话、工具注册与调度 |
| | `services/web/` | 网页抓取、搜索引擎 |
| | `services/file/` | 文件下载、文件系统 CRUD |
| | `services/mcp_server.rs` | MCP 协议服务 |
| Model | `models/` | 数据结构定义 |
| Infra | `server/` | HTTP / WebSocket 路由和处理器 |
| Config | `config.rs` + `lanchat.config.json` | 统一配置中心 |

所有源文件均 **< 300 行**，最大文件 220 行。

---

## 配置

项目根目录 `lanchat.config.json` 集中管理所有配置，无需深入代码修改：

```json
{
  "server":    { "chat_port": 9120, "mcp_port": 9121 },
  "ai":        { "api_url": "https://api.deepseek.com/chat/completions",
                 "model": "deepseek-chat", "max_tokens": 4000, "max_tool_rounds": 5 },
  "scraper":   { "max_content_length": 50000, "request_timeout_secs": 30 },
  "chat":      { "max_message_history": 5000, "max_context_messages": 20 },
  "websocket": { "max_reconnect_delay_ms": 30000, "base_reconnect_delay_ms": 2000 }
}
```

---

## 快速开始

### 环境要求

- Node.js >= 18
- Rust >= 1.85
- Windows 10+ / macOS 10.15+ / Linux

### 开发运行

```bash
npm install

# 设置 DeepSeek API Key（AI 功能需要）
# Windows PowerShell:
$env:DEEPSEEK_API_KEY = "sk-你的Key"
# macOS / Linux:
export DEEPSEEK_API_KEY="sk-你的Key"

npm run tauri dev
```

### 打包分发

```bash
$env:DEEPSEEK_API_KEY = "sk-你的Key"
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/`：
- Windows: `.msi` / `.exe`
- macOS: `.dmg`
- Linux: `.deb` / `.AppImage`

> API Key 通过 `option_env!()` 在编译时嵌入 Rust 二进制文件，不会出现在前端代码或配置文件中。

### 使用方式

1. 启动应用 → 输入昵称 → 选择网卡 → 开启聊天空间
2. 其他设备：输入主机 IP → 加入聊天空间
3. 左侧选择联系人或公共频道开始聊天
4. 点击「AI 助手」进入 AI 对话

---

## 适用场景

- 企业内网通讯，替代有封号风险的微信工作群
- 涉密单位 / 工厂车间 / 科研实验室的隔离网络通讯
- 局域网内大文件传输（设计稿、视频素材、工程文件）
- 利用 AI 助手浏览网页、分析代码、管理文件
- 临时活动现场快速组网通讯

---

## 开源协议

MIT License

> **LanChat** — 你的网络，你的 AI，你做主。
