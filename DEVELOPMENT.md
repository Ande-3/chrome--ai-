# 🛠 AI 侧边栏助手 — 开发与发布流程

> 本文件是日常开发、Git 提交、发布到 GitHub 的完整操作手册，照着做即可。

## 一、环境准备

| 工具 | 用途 | 说明 |
|------|------|------|
| VSCode | 代码编辑器 | 建议安装中文语言包、GitLens、Markdown All in One、Prettier |
| Git | 版本管理 | 必须，用于提交和推送 |
| GitHub 账号 | 远程仓库 | 已绑定本机 SSH 密钥（账号 Ande-3） |
| Chrome / Edge | 扩展运行环境 | 需要 Chrome 114+ |

## 二、打开项目

1. 打开 VSCode
2. `文件 → 打开文件夹`，选择项目目录：
   `D:\download\codex\项目\ai-sidebar`
3. 左侧文件树即可看到全部源码

## 三、日常开发循环

本项目是纯前端 Chrome 扩展，**没有构建步骤**，改完刷新即生效。

```
修改代码 → 保存 (Ctrl+S) → chrome://extensions 点「刷新」→ 测试 → 循环
```

### 常用入口

- 扩展管理页：`chrome://extensions/`（Edge：`edge://extensions/`）
- 侧边栏打开：点工具栏图标，或按 `Alt+A`
- 快捷键自定义：`chrome://extensions/shortcuts`
- 调试输出：侧边栏右键 → 检查（F12），`console.log` 会显示在 Console 面板

### 代码结构速览

| 文件 | 职责 |
|------|------|
| `manifest.json` | 扩展清单：权限、快捷键、版本号 |
| `sidepanel.html/css/js` | 侧边栏界面与逻辑 |
| `options.html/js` | 设置页（API 配置、测试连接、搜索源） |
| `service-worker.js` | 后台：API 调度、快捷键、页面上下文 |
| `lib/llm-client.js` | LLM 客户端（OpenAI / Anthropic / Gemini） |
| `lib/search-client.js` | 搜索源（6 种） |
| `lib/markdown-renderer.js` | Markdown 渲染（已做 XSS 加固） |
| `lib/storage.js` | chrome.storage 封装、配置迁移 |

## 四、Git 提交与推送

### 用 VSCode 界面（推荐新手）

1. `Ctrl+Shift+G` 打开「源代码管理」面板
2. 改动的文件会列在「更改」里：
   - 点文件旁的 `+` 暂存
   - 顶部输入提交信息，如 `修复取消请求不生效的问题`
   - 点 ✓ 完成提交
3. 点「同步更改」或推送图标，推到 GitHub

### 用终端命令

```bash
git add -A
git commit -m "提交说明"
git push origin main
```

### 查看状态 / 历史

```bash
git status          # 当前改动
git log --oneline   # 提交历史
git diff            # 查看未提交的改动
```

## 五、发布到 GitHub

项目已关联远程仓库：

```bash
git remote -v
# origin  git@github.com:Ande-3/chrome--ai-.git
```

### 日常更新（推送新提交）

```bash
git add -A
git commit -m "更新内容"
git push origin main
```

### 整体替换远程内容（重大改版时）

```bash
git add -A
git commit -m "全新版本"
git push --force-with-lease origin main
```

⚠️ 警告：
- `--force` 会覆盖远程历史，推送前**先备份**
- 推荐备份方式：`git tag 版本号` 打标签，或复制整个文件夹
- 优先用 `--force-with-lease` 而不是 `--force`，它更安全（远程有别人新提交时会拒绝）

## 六、用 AI 辅助开发

### Codex 扩展（效果最好）

在 VSCode 侧边栏开对话，示例提示词：

> 升级这个 Chrome 扩展：先读一遍所有源码，然后修复取消请求失效和缺少 host_permissions 的问题，给 Markdown 渲染做 XSS 加固，支持 Gemini 原生协议，让模型下拉框自动从 API 拉取模型列表，改完用 git 提交并推送到 GitHub。

### GitHub Copilot Chat

适合单点问题，如：
- 「这段代码有什么 bug？」
- 「给这个函数加个超时取消」
- 「解释一下 service-worker.js 的消息流程」

改完仍需自己在源代码管理面板提交推送。

### 建议工作流

1. AI 负责读代码、改代码
2. 你在「源代码管理」面板**先看 diff**，确认没有乱改
3. 自己提交、推送

## 七、常见问题

| 问题 | 解决方法 |
|------|----------|
| API 请求报 CORS/拦截 | 检查 manifest 是否保留 `host_permissions` |
| 本地 Ollama 连不上 | 扩展详情页开启「允许访问本地端口」 |
| 模型下拉框为空 | 点 ↻ 刷新；该 API 无列表接口则手动输入模型名 |
| 快捷键失效 | `chrome://extensions/shortcuts` 重新设置 |
| 配置乱了 | 设置页「重置为默认」；数据在 chrome.storage.local |
| 推送被拒（non-fast-forward） | 远程有新提交：`git pull --rebase` 后再推；确需覆盖则 `--force-with-lease` |

## 八、发布前检查清单

- [ ] `manifest.json` 版本号已更新
- [ ] 在 Chrome 里刷新扩展并完整测试（发送、流式、取消、搜索、模型切换）
- [ ] 更新 `README.md` 和 `CHANGELOG.md`
- [ ] 更新发布声明（如 `发布声明.md`）
- [ ] 提交并推送，确认 GitHub 页面代码是最新
