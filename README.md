# 🤖 AI 侧边栏助手

一个 Chrome 扩展，在任何网页的侧边栏中提供一个 AI 助手。支持多模型 API（OpenAI 协议兼容）和搜索增强（RAG）功能。

## 功能

- **侧边栏聊天** — 在任意网页按快捷键打开侧边栏，随时提问
- **多模型支持** — 兼容任何 OpenAI 协议的 API（OpenAI、Claude、DeepSeek、Ollama、SiliconFlow 等）
- **搜索增强** — 开启后自动搜索互联网，基于搜索结果回答问题（RAG 模式）
- **流式输出** — 逐字显示回复，无需等待完整响应
- **右键菜单** — 选中任意文字，右键快速发送到侧边栏
- **对话历史** — 自动保存，随时回顾之前对话
- **完全本地** — API Key 仅存储在本地浏览器中，不经过任何第三方服务器

## 安装

1. 打开 Chrome/Edge 浏览器，进入扩展管理页面
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`

2. 开启 **开发者模式**（右上角开关）

3. 点击 **加载已解压的扩展**，选择本项目文件夹 `D:\download\ai-sidebar`

4. 点击扩展栏中的图标，或按快捷键打开侧边栏

## 配置

点击侧边栏顶部的 ⚙️ 按钮，进入设置页：

### LLM 配置

| 字段 | 说明 |
|------|------|
| API Base URL | API 端点地址（任何 OpenAI 协议兼容的服务） |
| API Key | 你的 API 密钥 |
| 模型名称 | 使用的模型（如 gpt-4o-mini, claude-sonnet-4-20250514） |
| Temperature | 生成温度（0-2） |
| Max Tokens | 最大输出长度 |
| System Prompt | 系统提示词，定义 AI 的行为 |

### 常用 API 配置参考

| 服务 | Base URL | 示例模型 |
|------|----------|----------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini`, `gpt-4o` |
| Anthropic Claude | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen2.5:7b`, `llama3.1:8b` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |

### 搜索配置

| 搜索源 | API 地址 | 免费额度 |
|--------|----------|----------|
| Tavily（推荐） | https://app.tavily.com | 1000 次/月 |
| SerpAPI | https://serpapi.com | 100 次/月 |
| Bing Search | Azure Portal | 免费层级 |
| Google Custom Search | Google Cloud | 100 次/天 |

## 使用方法

### 基本对话
1. 点击浏览器工具栏的 AI 图标打开侧边栏
2. 在输入框输入问题，按 Enter 发送
3. AI 会流式输出回复

### 搜索增强模式
1. 点击侧边栏顶部的 🔍 按钮开启搜索模式
2. 输入需要最新信息的问题
3. 扩展会自动搜索互联网，然后让 AI 基于搜索结果回答

### 右键快速提问
1. 在任意网页选中文字
2. 右键 → "询问 AI 侧边栏"
3. 选中文本会自动填入输入框

## 技术架构

```
ai-sidebar/
├── manifest.json           # Chrome 扩展清单
├── sidepanel.html          # 侧边栏界面
├── sidepanel.css           # 侧边栏样式
├── sidepanel.js            # 侧边栏逻辑
├── service-worker.js       # 后台核心 (API 调度)
├── options.html            # 设置页面
├── options.js              # 设置逻辑
├── content-script.js       # 页面脚本
├── lib/
│   ├── storage.js          # 存储封装
│   ├── llm-client.js       # LLM API 客户端 (OpenAI 协议)
│   ├── search-client.js    # 搜索 API 客户端
│   └── markdown-renderer.js# Markdown 渲染器
└── icons/                  # 扩展图标
```

## 开发

本项目是纯前端 Chrome 扩展，无需构建工具。修改后刷新扩展即可生效。

```bash
# 克隆后直接加载到 Chrome 即可
# 无需 npm install，无需构建
```

## 安全说明

- API Key 存储在 `chrome.storage.local` 中，仅本地浏览器可访问
- 所有 API 请求直接从浏览器发出，不经过第三方代理
- 源代码完全可见，可自行审计
