/**
 * 侧边栏主逻辑 — UI 交互 + 会话管理
 */

import { MarkdownRenderer } from './lib/markdown-renderer.js';

// ─── 状态 ─────────────────────────────────────────────────
const state = {
  messages: [],           // 当前会话的消息 [{role, content}]
  currentSessionId: null, // 当前会话 ID
  sessions: [],           // 所有历史会话 [{id, title, messages, createdAt, updatedAt}]
  isStreaming: false,
  streamId: null,
  currentRequestId: null,
  searchMode: false,
  selectedModel: '',      // 侧边栏手动选择的模型，空=用配置里的
};

const md = new MarkdownRenderer();

// ─── DOM 引用 ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  chatArea: $('chatArea'),
  messagesContainer: $('messagesContainer'),
  welcome: $('welcome'),
  inputBox: $('inputBox'),
  btnSend: $('btnSend'),
  btnNewChat: $('btnNewChat'),
  btnSettings: $('btnSettings'),
  btnHistory: $('btnHistory'),
  btnCancel: $('btnCancel'),
  btnClearHistory: $('btnClearHistory'),
  btnCloseHistory: $('btnCloseHistory'),
  btnToggleSearch: $('btnToggleSearch'),
  searchSwitch: $('searchSwitch'),
  searchToolbar: $('searchToolbar'),
  modelSelector: $('modelSelector'),
  statusBar: $('statusBar'),
  statusText: $('statusText'),
  historyPanel: $('historyPanel'),
  historyList: $('historyList'),
  configStatus: $('configStatus'),
};

// ─── 初始化 ────────────────────────────────────────────────
/** 常用模型列表（侧边栏快速切换） */
const COMMON_MODELS = [
  '',                    // 空=使用配置中的模型
  'gpt-4o',
  'gpt-4o-mini',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-20250514',
  'deepseek-chat',
  'deepseek-reasoner',
  'Qwen/Qwen2.5-7B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'gemini-2.0-flash',
  'custom',
];

async function init() {
  const config = await sendMessage({ type: 'get-config' });
  state.searchMode = config.general?.searchMode || false;
  updateSearchToggleUI();
  updateConfigStatus(config);

  // 初始化模型选择器
  initModelSelector(config.llm.model);

  // 加载历史会话
  state.sessions = await sendMessage({ type: 'get-sessions' });
  renderHistory();

  bindEvents();
  chrome.runtime.onMessage.addListener(handleWorkerMessage);

  els.inputBox.focus();
  console.log('AI 侧边栏助手已启动');
}

function initModelSelector(defaultModel) {
  els.modelSelector.innerHTML = '';
  for (const m of COMMON_MODELS) {
    const opt = document.createElement('option');
    if (m === '') {
      opt.value = '';
      opt.textContent = `⚙️ ${defaultModel || '默认模型'}`;
    } else if (m === 'custom') {
      opt.value = '__custom__';
      opt.textContent = '✏️ 自定义...';
    } else {
      opt.value = m;
      opt.textContent = m;
    }
    els.modelSelector.appendChild(opt);
  }
  els.modelSelector.value = state.selectedModel || '';

  els.modelSelector.addEventListener('change', () => {
    const val = els.modelSelector.value;
    if (val === '__custom__') {
      const custom = prompt('输入模型名称：', state.selectedModel || defaultModel);
      if (custom && custom.trim()) {
        state.selectedModel = custom.trim();
        // 添加自定义选项（如果不在列表中）
        const existing = els.modelSelector.querySelector(`option[value="${custom.trim()}"]`);
        if (!existing) {
          const opt = document.createElement('option');
          opt.value = custom.trim();
          opt.textContent = custom.trim();
          els.modelSelector.insertBefore(opt, els.modelSelector.lastElementChild);
        }
        els.modelSelector.value = custom.trim();
      } else {
        els.modelSelector.value = state.selectedModel || '';
      }
    } else {
      state.selectedModel = val;
    }
  });
}

// ─── 事件绑定 ──────────────────────────────────────────────
function bindEvents() {
  // 发送：Enter 发送，Ctrl+Enter 换行
  els.btnSend.addEventListener('click', () => handleUserMessage());
  els.inputBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Enter → 换行
        return;
      }
      e.preventDefault();
      handleUserMessage();
    }
  });

  els.inputBox.addEventListener('input', autoResizeInput);

  els.btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  els.btnNewChat.addEventListener('click', newSession);

  els.btnHistory.addEventListener('click', toggleHistory);
  els.btnCloseHistory.addEventListener('click', toggleHistory);
  els.btnClearHistory.addEventListener('click', clearHistory);

  els.btnCancel.addEventListener('click', cancelRequest);

  els.btnToggleSearch.addEventListener('click', () => {
    state.searchMode = !state.searchMode;
    updateSearchToggleUI();
  });
}

// ─── 处理用户发送 ──────────────────────────────────────────
async function handleUserMessage() {
  const text = els.inputBox.value.trim();
  if (!text || state.isStreaming) return;

  const config = await sendMessage({ type: 'get-config' });
  if (!config.llm.apiKey) {
    showError('请先在设置页配置 API Key');
    return;
  }

  // 第一条消息 → 自动创建会话
  if (!state.currentSessionId) {
    state.currentSessionId = 'session-' + Date.now();
  }

  // 清空输入
  els.inputBox.value = '';
  autoResizeInput();

  // 隐藏欢迎页
  els.welcome.style.display = 'none';
  els.welcome.classList.add('hidden');

  // 添加用户消息
  addMessage('user', text);
  state.messages.push({ role: 'user', content: text });

  const aiMsgEl = addMessage('ai', '', true);
  const streamId = 'stream-' + Date.now();

  state.isStreaming = true;
  state.streamId = streamId;
  els.btnSend.disabled = true;
  els.statusBar.classList.remove('hidden');
  els.statusText.textContent = state.searchMode ? '🔍 搜索中... 请稍候' : '🤖 AI 思考中...';

  try {
    if (state.searchMode) {
      await sendMessage({
        type: 'search-and-chat',
        query: text,
        messages: buildContextMessages(),
        streamId,
        model: state.selectedModel || undefined,
      });
    } else {
      await sendMessage({
        type: 'chat',
        messages: buildContextMessages(),
        streamId,
        model: state.selectedModel || undefined,
      });
    }
  } catch (err) {
    console.error('发送消息失败:', err);
  }
}

function buildContextMessages() {
  return state.messages.slice(-20);
}

// ─── 保存当前会话到存储 ──────────────────────────────────
async function saveCurrentSession() {
  if (!state.currentSessionId || state.messages.length === 0) return;

  // 取第一条用户消息作标题
  const firstUser = state.messages.find((m) => m.role === 'user');
  const title = firstUser ? firstUser.content.slice(0, 50) : '新会话';

  const session = {
    id: state.currentSessionId,
    title,
    messages: [...state.messages],
    createdAt: state.sessionCreatedAt || Date.now(),
    updatedAt: Date.now(),
  };

  state.sessions = await sendMessage({ type: 'save-session', session });
  renderHistory();
}

// ─── 添加消息到界面 ──────────────────────────────────────
function addMessage(role, content, isPlaceholder = false) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (isPlaceholder) {
    bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  } else {
    bubble.innerHTML = md.render(content);
  }

  div.appendChild(role === 'user' ? bubble : avatar);
  div.appendChild(role === 'user' ? avatar : bubble);

  els.messagesContainer.appendChild(div);
  scrollToBottom();
  return div;
}

// ─── 更新消息内容（流式） ───────────────────────────────
function updateMessage(content, isFinal = false) {
  const messages = els.messagesContainer.querySelectorAll('.message.ai');
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return;

  const bubble = lastMsg.querySelector('.message-bubble');
  if (!bubble) return;

  bubble.innerHTML = md.render(content);
  scrollToBottom();

  if (isFinal) {
    state.isStreaming = false;
    state.streamId = null;
    els.btnSend.disabled = false;
    els.statusBar.classList.add('hidden');

    state.messages.push({ role: 'assistant', content });
    // 每条回复收到后自动保存会话
    saveCurrentSession();

    // 追加重新生成按钮
    addRegenerateButton(lastMsg);
  }
}

// ─── 追加重新生成按钮 ──────────────────────────────────────
function addRegenerateButton(msgEl) {
  // 移除旧的（如果有）
  const old = msgEl.querySelector('.regenerate-btn');
  if (old) old.remove();

  const btn = document.createElement('button');
  btn.className = 'regenerate-btn';
  btn.title = '重新生成回答';
  btn.innerHTML = '🔄 重新生成';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    regenerateLast();
  });
  msgEl.appendChild(btn);
}

// ─── 处理 Service Worker 消息 ────────────────────────────
function handleWorkerMessage(msg) {
  if (msg.type === 'chat-chunk') {
    if (msg.error) {
      state.isStreaming = false;
      els.btnSend.disabled = false;
      els.statusBar.classList.add('hidden');

      const messages = els.messagesContainer.querySelectorAll('.message.ai');
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        const bubble = lastMsg.querySelector('.message-bubble');
        if (bubble) {
          bubble.innerHTML = `<div class="error-message">❌ ${msg.error}</div>`;
        }
      }
      return;
    }

    els.statusText.textContent = '🤖 生成回复中...';
    updateMessage(msg.content, msg.done);

    if (msg.done) {
      state.isStreaming = false;
      state.streamId = null;
      els.btnSend.disabled = false;
      els.statusBar.classList.add('hidden');
    }
  }

  if (msg.type === 'search-results') {
    if (msg.results && msg.results.length > 0) {
      const messages = els.messagesContainer.querySelectorAll('.message.ai');
      const lastMsg = messages[messages.length - 1];
      if (lastMsg) {
        const sources = document.createElement('details');
        sources.className = 'search-sources';
        sources.innerHTML = `
          <summary>📎 来源 (${msg.results.length})</summary>
          ${msg.results.map((r, i) =>
            `<div class="search-source-item">
              <span>[${i + 1}]</span>
              <a href="${r.url}" target="_blank" rel="noopener">${r.title}</a>
            </div>`
          ).join('')}
        `;
        lastMsg.appendChild(sources);
      }
    }
    els.statusText.textContent = '🤖 正在根据搜索结果生成回答...';
  }

  if (msg.type === 'context-selection') {
    els.inputBox.value = msg.text;
    autoResizeInput();
    els.inputBox.focus();
  }
}

// ─── 取消请求 ──────────────────────────────────────────────
function cancelRequest() {
  if (state.streamId) {
    sendMessage({ type: 'cancel-request', requestId: state.streamId });
    state.isStreaming = false;
    state.streamId = null;
    els.btnSend.disabled = false;
    els.statusBar.classList.add('hidden');
  }
}

// ─── 重新生成 AI 回答 ────────────────────────────────────
async function regenerateLast() {
  if (state.isStreaming || state.messages.length < 2) return;

  // 找到界面中最后一条 AI 消息
  const aiMessages = els.messagesContainer.querySelectorAll('.message.ai');
  const lastAiMsg = aiMessages[aiMessages.length - 1];
  if (!lastAiMsg) return;

  // 从 state 中移除最后一条 assistant 消息
  let lastAsstIdx = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'assistant') {
      lastAsstIdx = i;
      break;
    }
  }
  if (lastAsstIdx < 0) return;
  state.messages.splice(lastAsstIdx, 1);

  // 把气泡换成加载状态
  const bubble = lastAiMsg.querySelector('.message-bubble');
  if (bubble) {
    bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  }

  // 移除旧的重生成按钮
  const oldBtn = lastAiMsg.querySelector('.regenerate-btn');
  if (oldBtn) oldBtn.remove();

  // 找到最后一条用户消息（用于搜索模式）
  let lastUserContent = '';
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'user') {
      lastUserContent = state.messages[i].content;
      break;
    }
  }

  // 重新发送请求
  const streamId = 'stream-' + Date.now();
  state.isStreaming = true;
  state.streamId = streamId;
  els.btnSend.disabled = true;
  els.statusBar.classList.remove('hidden');
  els.statusText.textContent = state.searchMode ? '🔍 重新搜索中...' : '🤖 重新生成中...';

  try {
    if (state.searchMode && lastUserContent) {
      await sendMessage({
        type: 'search-and-chat',
        query: lastUserContent,
        messages: buildContextMessages(),
        streamId,
        model: state.selectedModel || undefined,
      });
    } else {
      await sendMessage({
        type: 'chat',
        messages: buildContextMessages(),
        streamId,
        model: state.selectedModel || undefined,
      });
    }
  } catch (err) {
    console.error('重新生成失败:', err);
  }
}

// ─── 新会话 ──────────────────────────────────────────────
async function newSession() {
  if (state.messages.length > 0) {
    await saveCurrentSession();
  }
  // 重置当前会话
  state.messages = [];
  state.currentSessionId = null;
  state.sessionCreatedAt = null;
  els.messagesContainer.innerHTML = '';
  els.welcome.style.display = 'flex';
  els.welcome.classList.remove('hidden');
  els.inputBox.value = '';
  els.inputBox.focus();
  // 刷新会话列表
  state.sessions = await sendMessage({ type: 'get-sessions' });
  renderHistory();
}

// ─── 历史面板 ──────────────────────────────────────────────
function toggleHistory() {
  els.historyPanel.classList.toggle('hidden');
  if (!els.historyPanel.classList.contains('hidden')) {
    state.sessions = [...state.sessions]; // 触发重渲染
    renderHistory();
  }
}

function renderHistory() {
  if (!state.sessions || state.sessions.length === 0) {
    els.historyList.innerHTML = '<div class="history-empty">暂无对话记录</div>';
    return;
  }

  els.historyList.innerHTML = '';
  // 显示最近 10 个，已倒序
  for (const session of state.sessions) {
    const item = document.createElement('div');
    item.className = 'history-item';
    if (session.id === state.currentSessionId) {
      item.classList.add('active');
    }

    const titleText = document.createElement('span');
    titleText.className = 'history-item-title';
    titleText.textContent = session.title.slice(0, 40) + (session.title.length > 40 ? '...' : '');
    item.appendChild(titleText);

    const countBadge = document.createElement('span');
    countBadge.className = 'history-item-count';
    countBadge.textContent = `${Math.ceil(session.messages.length / 2)}轮`;
    item.appendChild(countBadge);

    item.addEventListener('click', () => loadSession(session.id));
    els.historyList.appendChild(item);
  }
}

// ─── 加载历史会话 ──────────────────────────────────────────
async function loadSession(sessionId) {
  // 保存当前会话
  if (state.messages.length > 0) {
    await saveCurrentSession();
  }

  // 从 sessions 里找目标会话
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  // 切换到目标会话
  state.currentSessionId = session.id;
  state.sessionCreatedAt = session.createdAt;
  state.messages = [...session.messages];

  // 刷新界面
  els.messagesContainer.innerHTML = '';
  els.welcome.style.display = 'none';
  els.welcome.classList.add('hidden');
  for (const msg of state.messages) {
    addMessage(msg.role, msg.content);
  }

  // 高亮当前会话
  renderHistory();

  els.historyPanel.classList.add('hidden');
  els.inputBox.focus();
}

// ─── 清空所有会话 ──────────────────────────────────────────
async function clearHistory() {
  if (!confirm('确定清空所有历史会话？')) return;
  await sendMessage({ type: 'clear-sessions' });
  state.sessions = [];
  renderHistory();
  // 不清当前会话，只清历史列表
}

// ─── 工具函数 ──────────────────────────────────────────────
function scrollToBottom() {
  requestAnimationFrame(() => {
    els.chatArea.scrollTop = els.chatArea.scrollHeight;
  });
}

function autoResizeInput() {
  els.inputBox.style.height = 'auto';
  els.inputBox.style.height = Math.min(els.inputBox.scrollHeight, 120) + 'px';
}

function updateSearchToggleUI() {
  if (state.searchMode) {
    els.btnToggleSearch.classList.add('active');
    els.searchSwitch.textContent = '◉';
  } else {
    els.btnToggleSearch.classList.remove('active');
    els.searchSwitch.textContent = '○';
  }
}

function updateConfigStatus(config) {
  const hasLLM = !!config.llm.apiKey;
  const hasSearch = !!config.search.apiKey;
  const searchProvider = config.search.provider || '未设置';

  let html = '';
  if (!hasLLM) {
    html += '<p>⚠️ 未配置 LLM API Key</p>';
  } else {
    html += `<p>✅ LLM: ${config.llm.model || '已配置'}</p>`;
  }
  if (state.searchMode && !hasSearch) {
    html += `<p>⚠️ 搜索模式已开启，但未配置搜索 API</p>`;
  }
  if (hasSearch) {
    html += `<p>📡 搜索: ${searchProvider}</p>`;
  }
  els.configStatus.innerHTML = html;
}

function showError(msg) {
  const div = document.createElement('div');
  div.className = 'error-message';
  div.textContent = `❌ ${msg}`;
  div.style.padding = '8px';
  div.style.textAlign = 'center';
  els.messagesContainer.appendChild(div);
  scrollToBottom();
}

function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

document.addEventListener('DOMContentLoaded', init);
