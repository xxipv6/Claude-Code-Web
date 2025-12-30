# Claude Code Standalone

> 独立运行的 Claude Code AI 编程助手

脱离 VSCode，完全独立运行的 Claude Code 版本。支持所有 VSCode 插件功能，包括流式输出、工具调用、会话管理等。

## 特性

✨ **核心功能**
- 🚀 流式输出 - 实时显示 AI 回复，带光标动画
- 🛠️ 工具调用 - 完整支持 Bash、Read、Write、Edit 等工具
- 💬 会话管理 - 支持多会话切换、历史记录
- 📦 打断机制 - AI 输出时可随时打断
- ⏸️ 停止按钮 - 手动停止任务执行
- 🔄 后台运行 - 关闭浏览器后任务继续执行

⚡ **性能优化**
- 📄 分页加载 - 只加载最近 50 条消息
- 🎯 虚拟滚动 - 按需加载历史消息
- ⚡ 秒开响应 - 即使 1000+ 消息也丝滑
- 💾 内存缓存 - 会话数据内存缓存

🎨 **VSCode 风格**
- 📋 工具卡片 - 完美复刻 VSCode 样式
- 🌈 语法高亮 - 代码块高亮显示
- 📊 代码差异 - Git diff 风格展示
- 💬 消息气泡 - 用户/AI 消息区分

## 快速开始

### 1. 系统要求

- **Node.js** 18+ ([下载](https://nodejs.org/))
- **操作系统**: Linux / macOS / Windows
- **浏览器**: Chrome / Edge / Firefox (现代浏览器)

### 2. 配置

首次运行会自动创建 `config.json`：

```json
{
  "claudeBinary": "./bin/claude",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key-here",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
  },
  "server": {
    "port": 3002,
    "host": "0.0.0.0"
  }
}
```

**配置说明：**
- `claudeBinary`: Claude 二进制文件路径（相对或绝对路径）
  - Linux/macOS: `./bin/claude` 或 `/absolute/path/to/claude`
  - Windows: `./bin/claude.exe` 或 `C:/path/to/claude.exe`
  - 支持环境变量: `CLAUDEDE_BINARY=/path/to/claude node server/index.js`
- `ANTHROPIC_AUTH_TOKEN`: Anthropic API Key（必需）
- `ANTHROPIC_BASE_URL`: API 地址（可选，支持代理）
  - 官方: `https://api.anthropic.com`
  - 智谱 AI: `https://open.bigmodel.cn/api/anthropic`

### 3. 启动

**Linux / macOS:**
```bash
chmod +x start.sh bin/claude
./start.sh
```

**Windows:**
```cmd
start.bat
```

手动启动：
```bash
node server/index.js
```

### 4. 访问

打开浏览器访问: **http://localhost:3002/chat.html**

## 目录结构

```
claude-standalone-release/
├── bin/                    # Claude 二进制文件
│   └── claude             # 207MB 主程序
├── server/                # 服务器代码
│   └── index.js          # Node.js 服务器
├── public/                # 前端文件
│   └── chat.html         # Web UI（单文件）
├── config/                # 配置模板
│   └── config.example.json
├── code/                  # 默认工作目录
│   └── README.md         # 工作目录说明
├── config.json            # 主配置文件（首次运行生成）
├── sessions.json          # 会话历史（自动生成）
├── projects.json          # 项目配置（自动生成）
├── start.sh              # Linux/macOS 启动脚本
├── start.bat             # Windows 启动脚本
└── README.md             # 本文档
```

## API 端点

### 会话管理
- `GET /api/sessions` - 获取所有会话
- `POST /api/sessions` - 创建新会话
- `GET /api/sessions/:id` - 获取会话详情（支持分页）
  - 参数: `?limit=50&offset=0`
- `DELETE /api/sessions/:id` - 删除会话

### 消息发送
- `POST /api/message` - 发送消息
  ```json
  {
    "sessionId": 1,
    "message": {
      "content": "your message"
    }
  }
  ```

### 任务控制
- `POST /api/sessions/:id/stop` - 停止任务

### SSE 流
- `GET /api/stream?session=:id` - 订阅实时消息

## 使用技巧

### 1. 项目管理
支持多项目管理，每个项目独立的工作目录和会话：
- **创建项目** - 点击顶部 "+" 按钮，选择项目目录
- **切换项目** - 使用顶部的项目选择器快速切换
- **项目隔离** - 每个项目的会话完全独立，互不干扰
- **默认工作目录** - 建议在 `code/` 目录下创建项目子目录

示例项目结构：
```
code/
├── my-app/          # 项目 1
├── website/         # 项目 2
└── scripts/         # 项目 3
```

### 2. 打断 AI 输出
AI 输出时随时可以：
- **输入新消息** - 自动打断并处理新消息
- **点击停止按钮** - 手动停止当前任务

### 3. 后台运行
关闭浏览器后任务继续运行，重新打开自动恢复并显示之前的输出。

### 4. 分页加载
只加载最近 50 条消息，点击"加载更多"查看历史。

### 5. 斜杠命令
支持 `/help`, `/commit`, `/test` 等快捷命令。

## 常见问题

### Q: 提示 "Claude binary not found"
**A:** 确保 `config.json` 中 `claudeBinary` 路径正确：
```bash
# Linux/macOS - 检查文件是否存在且有执行权限
ls -la ./bin/claude
chmod +x ./bin/claude

# Windows - 检查文件是否存在
dir bin\claude.exe
```

**不同平台的二进制文件：**
- Linux ARM64: `claude-linux-arm64`
- Linux x64: `claude-linux-x64`
- macOS ARM64: `claude-darwin-arm64`
- macOS x64: `claude-darwin-x64`
- Windows x64: `claude-windows-x64.exe`

将对应平台的二进制文件放到 `bin/` 目录，然后在 `config.json` 中配置：
```json
{
  "claudeBinary": "./bin/claude-linux-arm64"
}
```

### Q: 提示 "API Key 未配置"
**A:** 编辑 `config.json`，设置 `env.ANTHROPIC_AUTH_TOKEN`。

### Q: 发送消息后没响应
**A:** 检查：
1. API Key 是否正确
2. 网络连接是否正常
3. 浏览器控制台是否有错误

### Q: 关闭浏览器后任务停止了
**A:** 检查 `config.json` 中 `server.keepRunningInBackground` 是否为 `true`。

### Q: 切换会话很慢
**A:** 已优化分页加载，只加载最近 50 条。如果还是慢，检查 `sessions.json` 是否过大。

## 性能优化建议

### 1. 定期清理旧会话
```bash
# 删除所有会话
rm sessions.json
```

### 2. 调整分页大小
修改 `server/index.js` 中的 `limit` 默认值（当前 50）。

### 3. 使用更快的 API
智谱 AI 通常比官方 API 更快（国内用户）。

## 技术架构

```
┌─────────────┐
│   Browser   │  (chat.html)
└──────┬──────┘
       │ SSE / HTTP
       ↓
┌─────────────┐
│ Node.js     │  (server/index.js)
│  Server     │
└──────┬──────┘
       │ stdin/stdout
       ↓
┌─────────────┐
│  Claude     │  (bin/claude)
│   Binary    │  (207MB)
└─────────────┘
       │ HTTP
       ↓
┌─────────────┐
│  Anthropic  │  (API)
│   API       │
└─────────────┘
```

## 版本信息

- **Claude Binary**: v2.0.75 (从 VSCode 插件提取)
- **Node.js**: 18+ required
- **浏览器**: 现代浏览器（支持 ES6+）

## 许可证

本工具仅供学习使用。Claude 二进制文件版权归 Anthropic 所有。

## 相关链接

- [Claude Code VSCode 插件](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code)
- [Anthropic API 文档](https://docs.anthropic.com/)

## 贡献

欢迎提交 Issue 和 Pull Request！

---

**享受独立运行的 Claude Code！** 🎉
"# Claude-Code-Wen" 
