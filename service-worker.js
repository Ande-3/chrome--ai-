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

// ─── 初始化 ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  // 初始化默认配置
  const config = await Storage.getAll();
  if (!config.llm.apiKey && !config.search.apiKey) {
    chrome.runtime.openOptionsPage();
  }

  chrome.contextMenus.create({
    id: 'ask-ai-sidebar',
    title: '询问 AI 侧边栏',
    contexts: ['selection'],
  });
});

// ─── 右键菜单 ───────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ask-ai-sidebar' && info.selectionText) {
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
          return await Storage.save(message.config);

        // 会话管理
        case 'get-sessions':
          return await Storage.getSessions();
        case 'save-session':
          return await Storage.saveSession(message.session);
        case 'delete-session':
          return await Storage.deleteSession(message.sessionId);
        case 'clear-sessions':
          await Storage.clearSessions();
          return { success: true };

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
  activeControllers.set(requestId, abortController);

  const streamId = message.streamId || requestId;
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
  activeControllers.set(requestId, abortController);
  const streamId = message.streamId || requestId;

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
  }
}

// ─── 取消请求 ──────────────────────────────────────────────

function handleCancel(message) {
  const controller = activeControllers.get(message.requestId);
  if (controller) {
    controller.abort();
    activeControllers.delete(message.requestId);
    return { success: true };
  }
  return { success: false, reason: '未找到对应请求' };
}
