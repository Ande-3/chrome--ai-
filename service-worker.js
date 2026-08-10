/**
 * Service Worker — 后台核心
 *
 * 职责:
 *   - 管理侧边栏生命周期
 *   - 转发 LLM / 搜索请求
 *   - 处理右键菜单
 *   - 维护搜索增强模式
 */

import Storage from './lib/storage.js';
import { LLMClient } from './lib/llm-client.js';
import { SearchClient } from './lib/search-client.js';

// 运行中的请求控制器 (用于取消)
const activeControllers = new Map();
const CONTEXT_MENU_ID = 'ask-ai-sidebar';

// ─── 初始化 ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  await initPanelBehavior();

  // 初始化默认配置
  const config = await Storage.getAll();
  if (!config.llm.apiKey && !config.search.apiKey) {
    chrome.runtime.openOptionsPage();
  }

  await updateContextMenu(config.general.contextMenu !== false);
});

chrome.runtime.onStartup.addListener(() => {
  initPanelBehavior();
});

async function initPanelBehavior() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn('setPanelBehavior 失败，将使用 action.onClicked 兜底:', err);
  }
}

/** 根据设置创建 / 移除右键菜单 */
async function updateContextMenu(enabled) {
  try {
    await chrome.contextMenus.removeAll();
  } catch {
    // 菜单不存在时忽略
  }
  if (!enabled) return;
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: '询问 AI 侧边栏',
    contexts: ['selection'],
  });
}

// ─── 快捷键 → 打开侧边栏 ───────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-sidepanel') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.sidePanel.open({ windowId: tab?.windowId });
  }
});

// ─── 右键菜单 ───────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID && info.selectionText) {
    chrome.sidePanel.open({ windowId: tab?.windowId });
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'context-selection',
        text: info.selectionText,
        url: tab?.url || '',
        title: tab?.title || '',
      }).catch(() => {});
    }, 500);
  }
});

// ─── 点击扩展图标 → 打开侧边栏 ────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// ─── 消息处理 ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleAsync = async () => {
    try {
      switch (message.type) {
        // LLM / 搜索
        case 'chat':
          return await handleChat(message, sender);
        case 'search':
          return await handleSearch(message);
        case 'search-and-chat':
          return await handleSearchAndChat(message, sender);
        case 'cancel-request':
          return handleCancel(message);

        // 配置
        case 'get-config':
          return await Storage.getAll();
        case 'save-config':
          {
            const saved = await Storage.save(message.config);
            await updateContextMenu(saved.general.contextMenu !== false);
            return saved;
          }
        case 'test-connection':
          {
            const client = new LLMClient(message.config);
            const reply = await client.testConnection();
            return { success: true, reply };
          }
        case 'list-models':
          {
            const config = await Storage.getAll();
            const llmConfig = { ...config.llm };
            if (message?.model) llmConfig.model = message.model;
            const client = new LLMClient(llmConfig);
            const models = await client.listModels();
            return { success: true, models };
          }

        // 会话管理
        case 'get-sessions':
          return await Storage.getSessions();
        case 'save-session':
          return await Storage.saveSession(message.session);
        case 'delete-session':
          return await Storage.deleteSession(message.sessionId);
        case 'rename-session':
          return await Storage.renameSession(message.sessionId, message.title);
        case 'clear-sessions':
          await Storage.clearSessions();
          return { success: true };

        // 页面上下文
        case 'get-page-context':
          return await handleGetPageContext(sender);

        default:
          throw new Error(`未知消息类型: ${message.type}`);
      }
    } catch (err) {
      console.error('Service Worker 错误:', err);
      return { error: err.message };
    }
  };

  handleAsync().then(sendResponse);
  return true;
});

// ─── LLM 对话 ───────────────────────────────────────────────

async function handleChat(message, sender) {
  const config = await Storage.getAll();
  // 侧边栏可以传 model 覆盖配置
  const llmConfig = { ...config.llm };
  if (message.model) llmConfig.model = message.model;
  const client = new LLMClient(llmConfig);

  const requestId = crypto.randomUUID();
  const abortController = new AbortController();
  const streamId = message.streamId || requestId;
  activeControllers.set(requestId, abortController);
  activeControllers.set(streamId, abortController);
  let fullContent = '';

  try {
    fullContent = await client.chat({
      messages: message.messages || [],
      systemPrompt: config.general.systemPrompt,
      signal: abortController.signal,
      onChunk: (content) => {
        chrome.runtime.sendMessage({
          type: 'chat-chunk',
          streamId,
          content,
          done: false,
        }).catch(() => {});
      },
    });

    chrome.runtime.sendMessage({
      type: 'chat-chunk',
      streamId,
      content: fullContent,
      done: true,
    }).catch(() => {});

    return { success: true, content: fullContent, streamId };
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'chat-chunk',
      streamId,
      error: err.message,
      done: true,
    }).catch(() => {});
    throw err;
  } finally {
    activeControllers.delete(requestId);
    activeControllers.delete(streamId);
  }
}

// ─── 搜索 ──────────────────────────────────────────────────

async function handleSearch(message) {
  const config = await Storage.getAll();
  const client = new SearchClient(config.search);
  const results = await client.search(message.query, { count: message.count });
  const names = client.getProviderNames();
  return { success: true, results, providers: names };
}

// ─── 搜索 + LLM (RAG 增强) ────────────────────────────────

async function handleSearchAndChat(message, sender) {
  const config = await Storage.getAll();
  const searchClient = new SearchClient(config.search);

  // model 覆盖
  const llmConfig = { ...config.llm };
  if (message.model) llmConfig.model = message.model;
  const llmClient = new LLMClient(llmConfig);

  const requestId = crypto.randomUUID();
  const abortController = new AbortController();
  const streamId = message.streamId || requestId;
  activeControllers.set(requestId, abortController);
  activeControllers.set(streamId, abortController);

  let searchResults;
  try {
    // count='auto' 时传 undefined 让 SearchClient 自己决定
    const count = config.search.count === 'auto' ? undefined : config.search.count;
    searchResults = await searchClient.search(message.query, { count });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'chat-chunk', streamId, error: `搜索失败: ${err.message}`, done: true,
    }).catch(() => {});
    throw err;
  }

  if (!searchResults || searchResults.length === 0) {
    activeControllers.delete(requestId);
    activeControllers.delete(streamId);
    return handleChat({ messages: message.messages, streamId }, sender);
  }

  const searchContext = searchResults.map((r, i) =>
    `[${i + 1}] ${r.title}\n    链接: ${r.url}\n    摘要: ${r.snippet}`
  ).join('\n\n');

  const enrichedMessages = [
    ...(message.messages || []),
    {
      role: 'user',
      content: `请基于以下搜索结果回答问题。\n\n搜索结果：\n${searchContext}\n\n用户问题：${message.query}\n\n请用中文回答，并在引用处标注来源序号，如 [1][2]。`,
    },
  ];

  let fullContent = '';

  try {
    fullContent = await llmClient.chat({
      messages: enrichedMessages,
      signal: abortController.signal,
      onChunk: (content) => {
        chrome.runtime.sendMessage({
          type: 'chat-chunk', streamId, content, done: false,
        }).catch(() => {});
      },
    });

    chrome.runtime.sendMessage({
      type: 'search-results', streamId, results: searchResults,
    }).catch(() => {});

    chrome.runtime.sendMessage({
      type: 'chat-chunk', streamId, content: fullContent, done: true,
    }).catch(() => {});

    return { success: true, content: fullContent, streamId, searchResults };
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'chat-chunk', streamId, error: err.message, done: true,
    }).catch(() => {});
    throw err;
  } finally {
    activeControllers.delete(requestId);
    activeControllers.delete(streamId);
  }
}

// ─── 取消请求 ──────────────────────────────────────────────

function handleCancel(message) {
  const controller = activeControllers.get(message.requestId) || activeControllers.get(message.streamId);
  if (controller) {
    controller.abort();
    activeControllers.delete(message.requestId);
    activeControllers.delete(message.streamId);
    return { success: true };
  }
  return { success: false, reason: '未找到对应请求' };
}

// ─── 读取当前页面上下文 ────────────────────────────────────

async function handleGetPageContext(sender) {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) {
      // 侧边栏消息不带 sender.tab，需要主动查询窗口的活动标签页
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (!tab?.id) return { url: '', title: '', selection: '' };
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'get-selection' }).catch(() => null);
      return {
        url: tab.url || '',
        title: tab.title || '',
        selection: reply?.text || '',
      };
    }
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'get-selection' }).catch(() => null);
    return {
      url: sender.tab.url || '',
      title: sender.tab.title || '',
      selection: reply?.text || '',
    };
  } catch (err) {
    return { url: '', title: '', selection: '', error: err.message };
  }
}
