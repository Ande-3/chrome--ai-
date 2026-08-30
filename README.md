># 🤖 AI 侧边栏助手

一个 Chrome 扩展，在任何网页的侧边栏中提供一个 AI 助手。支持 **OpenAI / Claude / Gemini** 多协议 API 和联网搜索增强（RAG）。

> 当前版本：**v2.3.0**（基于 v1.0.0 升级：多协议、安全加固、新功能、模型自动识别、双主题）

##预览
<img width="2533" height="1278" alt="屏幕截图 2026-08-10 180349" src="https://github.com/user-attachments/assets/45913d51-b37e-40a8-a143-408d17d6818b" />




## 功能

- **双主题切换** — 深色 / 浅色两种主题，侧边栏顶栏 🌙/☀️ 一键切换，设置页可选默认主题
- **输入框可调高度** — 拖动输入区上方手柄，自由调整输入框高度（自动记住偏好）
- **侧边栏聊天** — 按 `Alt+A` 快捷键或点击工具栏图标随时打开
- **多协议支持**：
  - OpenAI 协议兼容（OpenAI、DeepSeek、Ollama、SiliconFlow、Kimi 等）
  - Anthropic 原生协议（Claude Messages API）
  - Gemini 原生协议（Google AI Studio）
  - 设置页支持**自动识别协议**，无需手动切换
- **模型自动识别** — 侧边栏模型下拉框根据已配置的 API 自动拉取可用模型，获取失败自动回退常用列表，↻ 可随时刷新；下拉框底部「🗂 管理模型列表」可隐藏/恢复模型
- **联网搜索增强** — 自动搜索互联网再回答（RAG 模式），多搜索源自动容错
- **流式输出** — 实时显示回复，带节流渲染和闪烁光标
- **页面上下文** — 一键把当前网页标题、链接、选中文字填入输入框
- **右键菜单** — 选中任意文字，右键快速发送到侧边栏
- **对话历史** — 自动保存（最多 50 条），支持单条删除
- **导出对话** — 一键导出当前会话为 Markdown 文件
- **复制能力** — AI 回复一键复制，代码块内置「复制」按钮
- **连接测试** — 设置页直接测试 API 是否可用
- **完全本地** — API Key 仅存储在本地浏览器中，不经过任何第三方服务器

## 安装

1. 打开 Chrome/Edge 浏览器，进入扩展管理页面
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`

2. 开启 **开发者模式**（右上角开关）

3. 点击 **加载已解压的扩展**，选择本项目文件夹
   - 升级版目录：`D:\download\codex\项目\ai-sidebar`

4. 点击扩展栏中的图标，或按 `Alt+A` 快捷键打开侧边栏

> 快捷键可在 `chrome://extensions/shortcuts` 中自定义。

## 配置

点击侧边栏顶部的 ⚙️ 按钮，进入设置页：

### LLM 配置

| 字段 | 说明 |
|------|------|
| 快速选择 | 一键填入常用服务商地址与模型 |
| API Base URL | API 端点地址 |
| 协议类型 | 自动识别 / OpenAI 兼容 / Anthropic 原生 / Gemini 原生 |
| API Key | 你的 API 密钥 |
| 模型名称 | 使用的模型（如 gpt-4o-mini、claude-sonnet-4-20250514、gemini-2.5-flash） |
| Temperature | 生成温度（0-2） |
| Max Tokens | 最大输出长度 |
| System Prompt | 系统提示词，定义 AI 的行为 |

### 常用 API 配置参考

| 服务 | Base URL | 协议 | 示例模型 |
|------|----------|------|----------|
| OpenAI | `https://api.openai.com/v1` | 自动 | `gpt-4o-mini`, `gpt-4.1` |
| Anthropic Claude | `https://api.anthropic.com` | 自动/Anthropic | `claude-sonnet-4-20250514` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | 自动/Gemini | `gemini-2.5-flash` |
| DeepSeek | `https://api.deepseek.com/v1` | 自动 | `deepseek-chat` |
| 本地 Ollama | `http://localhost:11434/v1` | 自动 | `qwen2.5:7b` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | 自动 | `Qwen/Qwen2.5-7B-Instruct` |

> Anthropic / Gemini 走原生协议，不再依赖 OpenAI 兼容层；Ollama 等本地服务需 Chrome 允许访问本地端口（在扩展详情页打开「允许访问文件网址/本地端口」）。

### 搜索配置

| 搜索源 | API 地址 | 免费额度 |
|--------|----------|----------|
| Tavily（推荐） | https://app.tavily.com | 1000 次/月 |
| SerpAPI | https://serpapi.com | 100 次/月 |
| Bing Search | Azure Portal | 免费层级 |
| Google Custom Search | Google Cloud | 100 次/天 |
| Brave Search | https://brave.com/search/api/ | 2000 次/月 |
| SearXNG（自建） | 自己的实例地址 | 免费 |

可添加多个搜索源，请求时按顺序尝试，失败自动切换到下一个。

## 使用方法

### 基本对话
1. 点击浏览器工具栏的 AI 图标（或按 `Alt+A`）打开侧边栏
2. 在输入框输入问题，按 Enter 发送
3. AI 会流式输出回复

### 搜索增强模式
1. 点击侧边栏顶部的 🔍 按钮开启搜索模式
2. 输入需要最新信息的问题
3. 扩展会自动搜索互联网，然后让 AI 基于搜索结果回答

### 读取网页上下文
1. 在网页中选中需要的文字（可选）
2. 点击侧边栏顶部的 📄 按钮
3. 当前页面标题、链接、选中文字会自动填入输入框

### 右键快速提问
1. 在任意网页选中文字
2. 右键 → "询问 AI 侧边栏"
3. 选中文本会自动填入输入框

### 切换主题
- 点击侧边栏顶栏的 🌙/☀️ 按钮，在深色 / 浅色主题间一键切换
- 在设置页「通用设置」中可设置默认主题，切换时即时预览

### 调整输入框大小
- 将鼠标移到输入区上方的小横杠，上下拖动即可调整输入框高度（60–400px）
- 调整后的高度会自动保存，下次打开保持

## 技术架构

```
ai-sidebar/
├── manifest.json           # Chrome 扩展清单（含快捷键、host 权限）
├── sidepanel.html          # 侧边栏界面
├── sidepanel.css           # 侧边栏样式
├── sidepanel.js            # 侧边栏逻辑
├── service-worker.js       # 后台核心 (API 调度 / 快捷键 / 页面上下文)
├── options.html            # 设置页面
├── options.js              # 设置逻辑（含连接测试）
├── content-script.js       # 页面脚本
├── lib/
│   ├── storage.js          # 存储封装
│   ├── llm-client.js       # LLM 客户端（OpenAI / Anthropic / Gemini）
│   ├── search-client.js    # 搜索 API 客户端（6 种搜索源）
│   └── markdown-renderer.js# Markdown 渲染器（XSS 安全）
└── icons/                  # 扩展图标
```

## v2.0.0 升级内容

- 支持 Anthropic / Gemini **原生协议**（自动识别），新增连接测试
- 修复：取消请求不生效、缺少 host_permissions 导致 API 请求被拦截、右键菜单开关不生效
- 安全加固：修复 Markdown 渲染与搜索结果展示中的 XSS 漏洞，链接 URL 白名单校验
- 新功能：快捷键开关、页面上下文、导出对话、回复/代码一键复制、Brave/SearXNG 搜索源、单条删除历史
- 体验优化：流式输出节流渲染、上下文条数可调、会话上限提升至 50

详见 [CHANGELOG.md](CHANGELOG.md)。

## 开发

本项目是纯前端 Chrome 扩展，无需构建工具。修改后到 `chrome://extensions/` 点击扩展卡片上的「刷新」即可生效。

```bash
# 无需 npm install，无需构建
```

## 安全说明

- API Key 存储在 `chrome.storage.local` 中，仅本地浏览器可访问
- 所有 API 请求直接从浏览器发出，不经过第三方代理
- Markdown 渲染经过转义与 URL 白名单校验，搜索结果链接同样受限
- 源代码完全可见，可自行审计
