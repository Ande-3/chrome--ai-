/**
 * 侧边栏主逻辑 — UI 交互 + 会话管理
 */

import { MarkdownRenderer, escapeHtml } from './lib/markdown-renderer.js';

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
  defaultModel: '',       // 配置页中的默认模型
  modelList: null,        // 从 API 拉取的模型列表，null=未获取到
  hiddenModels: [],       // 用户隐藏的模型 ID（持久化）
  customModels: [],       // 本次会话手动添加的自定义模型
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
  btnPageContext: $('btnPageContext'),
  btnExportChat: $('btnExportChat'),
  btnCancel: $('btnCancel'),
  btnClearHistory: $('btnClearHistory'),
  btnCloseHistory: $('btnCloseHistory'),
  btnToggleSearch: $('btnToggleSearch'),
  searchSwitch: $('searchSwitch'),
  searchToolbar: $('searchToolbar'),
  modelSelector: $('modelSelector'),
  btnRefreshModels: $('btnRefreshModels'),
  statusBar: $('statusBar'),
  statusText: $('statusText'),
  historyPanel: $('historyPanel'),
  historyList: $('historyList'),
  configStatus: $('configStatus'),
  modelManager: $('modelManager'),
  mmList: $('mmList'),
  mmSave: $('mmSave'),
  mmReset: $('mmReset'),
  mmClose: $('mmClose'),
};

// ─── 初始化 ────────────────────────────────────────────────
/** 无法从 API 获取列表时的回退常用模型 */
const FALLBACK_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-haiku-4-20250514',
  'deepseek-chat',
  'deepseek-reasoner',
  'Qwen/Qwen2.5-7B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

async function init() {
  const config = await sendMessage({ type: 'get-config' });
  state.searchMode = config.general?.searchMode || false;
  state.hiddenModels = config.general?.hiddenModels || [];
  updateSearchToggleUI();
  updateConfigStatus(config);

  // 初始化模型选择器
  initModelSelector(config.llm.model);

  // 加载历史会话
  state.sessions = await sendMessage({ type: 'get-sessions' });
  renderHistory();

  bindEvents();
  chrome.runtime.onMessage.addListener(handleWorkerMessage);
  chrome.storage.onChanged.addListener(handleStorageChanged);

  els.inputBox.focus();
  console.log('AI 侧边栏助手已启动');
}

/** 配置在设置页被修改时，同步默认模型标签 */
function handleStorageChanged(changes, area) {
  if (area !== 'local' || !changes.config) return;
  const cfg = changes.config.newValue;
  state.defaultModel = cfg?.llm?.model || state.defaultModel;
  state.hiddenModels = cfg?.general?.hiddenModels || [];
  buildModelOptions(state.defaultModel, state.modelList || FALLBACK_MODELS);
  restoreSelection(state.selectedModel);
}

function initModelSelector(defaultModel) {
  state.defaultModel = defaultModel;
  bindModelSelectorEvents(defaultModel);
  refreshModelList();
}

/** 重建模型下拉框：默认模型 + 模型列表 + 自定义 */
function buildModelOptions(defaultModel, models) {
  els.modelSelector.innerHTML = '';

  const addOption = (value, label) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    els.modelSelector.appendChild(opt);
  };

  addOption('', `⚙️ ${defaultModel || '默认模型'}`);

  for (const m of models) {
    if (state.hiddenModels.includes(m)) continue;
    addOption(m, m);
  }

  addOption('__custom__', '✏️ 自定义...');
  addOption('__manage__', '🗂 管理模型列表...');

  const keep = state.selectedModel && Array.from(els.modelSelector.options).some((o) => o.value === state.selectedModel);
  els.modelSelector.value = keep ? state.selectedModel : '';
}

/** 绑定模型切换事件（含自定义模型输入） */
function bindModelSelectorEvents(defaultModel) {
  els.modelSelector.addEventListener('change', () => {
    const val = els.modelSelector.value;
    if (val === '__manage__') {
      els.modelSelector.value = state.selectedModel || '';
      openModelManager();
      return;
    }
    if (val === '__custom__') {
      const custom = prompt('输入模型名称：', state.selectedModel || defaultModel);
      if (custom && custom.trim()) {
        state.selectedModel = custom.trim();
        if (!state.customModels.includes(custom.trim())) {
          state.customModels.push(custom.trim());
        }
        // 添加自定义选项（如果不在列表中）
        const existing = Array.from(els.modelSelector.options).find((o) => o.value === custom.trim());
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

/** 从 API 拉取可用模型列表并刷新下拉框 */
async function refreshModelList() {
  const select = els.modelSelector;
  const btn = els.btnRefreshModels;
  const previous = state.selectedModel;

  select.disabled = true;
  btn.disabled = true;
  btn.textContent = '⏳';
  select.title = '正在获取模型列表...';

  try {
    const config = await sendMessage({ type: 'get-config' });
    if (!config.llm.apiKey) {
      select.title = '未配置 API Key，使用常用模型列表（点击 ↻ 重试）';
      buildModelOptions(state.defaultModel, FALLBACK_MODELS);
      restoreSelection(previous);
      return;
    }

    const result = await sendMessage({ type: 'list-models' });
    const models = Array.isArray(result?.models) ? result.models : null;

    if (models && models.length > 0) {
      state.modelList = models;
      buildModelOptions(state.defaultModel, models);
      select.title = `已从 API 获取 ${models.length} 个模型`;
    } else {
      state.modelList = null;
      buildModelOptions(state.defaultModel, FALLBACK_MODELS);
      select.title = '无法获取模型列表（接口可能不支持），已回退到常用模型，点击 ↻ 重试';
    }
    restoreSelection(previous);
  } catch (err) {
    console.warn('刷新模型列表失败:', err);
    state.modelList = null;
    buildModelOptions(state.defaultModel, FALLBACK_MODELS);
    restoreSelection(previous);
    select.title = '获取模型列表失败，已回退到常用模型';
  } finally {
    select.disabled = false;
    btn.disabled = false;
    btn.textContent = '↻';
  }
}

function restoreSelection(previous) {
  if (previous && Array.from(els.modelSelector.options).some((o) => o.value === previous)) {
    els.modelSelector.value = previous;
  } else {
    els.modelSelector.value = state.selectedModel || '';
  }
}

// ─── 模型列表管理 ──────────────────────────────────────────
function openModelManager() {
  renderModelManager();
  els.modelManager.classList.remove('hidden');
}

function closeModelManager() {
  els.modelManager.classList.add('hidden');
}

function renderModelManager() {
  els.mmList.innerHTML = '';
  const allModels = state.modelList || FALLBACK_MODELS;

  if (allModels.length > 0) {
    const section = document.createElement('div');
    section.className = 'mm-section-title';
    section.textContent = state.modelList ? 'API 模型' : '常用模型（未能从 API 获取）';
    els.mmList.appendChild(section);

    for (const m of allModels) {
      const label = document.createElement('label');
      label.className = 'mm-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'mm-check';
      cb.dataset.model = m;
      cb.checked = !state.hiddenModels.includes(m);
      label.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = m;
      label.appendChild(span);
      els.mmList.appendChild(label);
    }
  }

  if (state.customModels.length > 0) {
    const section = document.createElement('div');
    section.className = 'mm-section-title';
    section.textContent = '自定义模型（本次会话）';
    els.mmList.appendChild(section);

    state.customModels.forEach((m, idx) => {
      const label = document.createElement('label');
      label.className = 'mm-item mm-item-custom';
      const span = document.createElement('span');
      span.textContent = m;
      label.appendChild(span);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'mm-del-custom';
      del.title = '删除（仅当前会话）';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        state.customModels.splice(idx, 1);
        if (state.selectedModel === m) state.selectedModel = '';
        renderModelManager();
        buildModelOptions(state.defaultModel, state.modelList || FALLBACK_MODELS);
      });
      label.appendChild(del);
      els.mmList.appendChild(label);
    });
  }

  if (allModels.length === 0 && state.customModels.length === 0) {
    els.mmList.innerHTML = '<div class="mm-empty">暂无模型</div>';
  }
}

async function saveModelManager() {
  const hidden = [];
  els.mmList.querySelectorAll('.mm-check').forEach((cb) => {
    if (!cb.checked) hidden.push(cb.dataset.model);
  });
  state.hiddenModels = hidden;
  if (state.selectedModel && hidden.includes(state.selectedModel)) {
    state.selectedModel = '';
  }
  await persistHiddenModels(hidden);
  buildModelOptions(state.defaultModel, state.modelList || FALLBACK_MODELS);
  closeModelManager();
  showToast(hidden.length > 0 ? `✅ 已隐藏 ${hidden.length} 个模型` : '✅ 模型列表已保存');
}

async function resetModelManager() {
  state.hiddenModels = [];
  await persistHiddenModels([]);
  buildModelOptions(state.defaultModel, state.modelList || FALLBACK_MODELS);
  closeModelManager();
  showToast('✅ 已恢复全部模型');
}

async function persistHiddenModels(hidden) {
  const config = await sendMessage({ type: 'get-config' });
  config.general.hiddenModels = hidden;
  await sendMessage({ type: 'save-config', config });
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
  els.btnPageContext.addEventListener('click', loadPageContext);
  els.btnExportChat.addEventListener('click', exportChat);
  els.btnRefreshModels.addEventListener('click', refreshModelList);
  els.mmSave.addEventListener('click', saveModelManager);
  els.mmReset.addEventListener('click', resetModelManager);
  els.mmClose.addEventListener('click', closeModelManager);
  els.modelManager.addEventListener('click', (e) => {
    if (e.target === els.modelManager) closeModelManager();
  });

  els.btnCancel.addEventListener('click', cancelRequest);

  els.btnToggleSearch.addEventListener('click', () => {
    state.searchMode = !state.searchMode;
    updateSearchToggleUI();
  });

  // 代码复制（事件委托）
  els.messagesContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.code-copy');
    if (btn) {
      copyCode(btn);
      return;
    }
    const copyBtn = e.target.closest('.copy-msg-btn');
    if (copyBtn) {
      copyMessage(copyBtn);
    }
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
  const contextCount = config.general?.maxContextMessages || 20;

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
        messages: buildContextMessages(contextCount),
        streamId,
        model: state.selectedModel || undefined,
      });
    } else {
      await sendMessage({
        type: 'chat',
        messages: buildContextMessages(contextCount),
        streamId,
        model: state.selectedModel || undefined,
      });
    }
  } catch (err) {
    console.error('发送消息失败:', err);
  }
}

function buildContextMessages(count = 20) {
  return state.messages.slice(-Math.max(2, count));
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

  if (role === 'ai' && !isPlaceholder) {
    addMessageActions(div);
  }

  els.messagesContainer.appendChild(div);
  scrollToBottom();
  return div;
}

/** 给 AI 消息追加操作条（复制 / 重新生成） */
function addMessageActions(msgEl) {
  const old = msgEl.querySelector('.message-actions');
  if (old) old.remove();

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-action-btn copy-msg-btn';
  copyBtn.title = '复制回复';
  copyBtn.textContent = '📋 复制';
  actions.appendChild(copyBtn);

  const regenBtn = document.createElement('button');
  regenBtn.className = 'msg-action-btn regenerate-btn';
  regenBtn.title = '重新生成回答';
  regenBtn.textContent = '🔄 重新生成';
  regenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    regenerateLast();
  });
  actions.appendChild(regenBtn);

  msgEl.appendChild(actions);
}

// ─── 更新消息内容（流式） ───────────────────────────────
let pendingRenderId = null;
let latestStreamContent = '';

function updateMessage(content, isFinal = false) {
  const messages = els.messagesContainer.querySelectorAll('.message.ai');
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return;

  const bubble = lastMsg.querySelector('.message-bubble');
  if (!bubble) return;

  latestStreamContent = content;

  const apply = () => {
    bubble.innerHTML = md.render(latestStreamContent);
  };

  if (isFinal) {
    lastMsg.classList.remove('streaming');
    if (pendingRenderId) {
      cancelAnimationFrame(pendingRenderId);
      pendingRenderId = null;
    }
    apply();
    scrollToBottom(true);
  } else {
    lastMsg.classList.add('streaming');
    if (!pendingRenderId) {
      pendingRenderId = requestAnimationFrame(() => {
        pendingRenderId = null;
        apply();
        scrollToBottom();
      });
    }
  }

  if (isFinal) {
    state.isStreaming = false;
    state.streamId = null;
    els.btnSend.disabled = false;
    els.statusBar.classList.add('hidden');

    state.messages.push({ role: 'assistant', content });
    addMessageActions(lastMsg);
    // 每条回复收到后自动保存会话
    saveCurrentSession();
  }
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
          bubble.innerHTML = `<div class="error-message">❌ ${escapeHtml(msg.error)}</div>`;
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
        const items = msg.results.map((r, i) => {
          const url = safeExternalUrl(r.url);
          const title = escapeHtml(r.title || `来源 ${i + 1}`);
          return url
            ? `<div class="search-source-item"><span>[${i + 1}]</span><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></div>`
            : `<div class="search-source-item"><span>[${i + 1}]</span>${title}</div>`;
        }).join('');
        const sources = document.createElement('details');
        sources.className = 'search-sources';
        sources.innerHTML = `
          <summary>📎 来源 (${msg.results.length})</summary>
          ${items}
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
  const config = await sendMessage({ type: 'get-config' });
  const contextCount = config.general?.maxContextMessages || 20;

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
        messages: buildContextMessages(contextCount),
        streamId,
        model: state.selectedModel || undefined,
      });
    } else {
      await sendMessage({
        type: 'chat',
        messages: buildContextMessages(contextCount),
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

    const delBtn = document.createElement('button');
    delBtn.className = 'history-item-del';
    delBtn.title = '删除此会话';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('删除这条对话记录？')) return;
      await sendMessage({ type: 'delete-session', sessionId: session.id });
      state.sessions = await sendMessage({ type: 'get-sessions' });
      renderHistory();
    });
    item.appendChild(delBtn);

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
function scrollToBottom(force = false) {
  const el = els.chatArea;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (force || nearBottom) {
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }
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
  const sources = config.search?.sources || [];
  const enabledSources = sources.filter((s) => s.enabled);
  const hasSearch = enabledSources.length > 0;
  const searchProvider = enabledSources.map((s) => s.name || s.provider).join(', ') || '未设置';

  let html = '';
  if (!hasLLM) {
    html += '<p>⚠️ 未配置 LLM API Key</p>';
  } else {
    html += `<p>✅ LLM: ${escapeHtml(config.llm.model || '已配置')}</p>`;
  }
  if (state.searchMode && !hasSearch) {
    html += `<p>⚠️ 搜索模式已开启，但未配置搜索 API</p>`;
  }
  if (hasSearch) {
    html += `<p>📡 搜索: ${escapeHtml(searchProvider)}</p>`;
  }
  els.configStatus.innerHTML = html;
}

// ─── 读取当前网页上下文 ────────────────────────────────────
async function loadPageContext() {
  const ctx = await sendMessage({ type: 'get-page-context' }).catch(() => null);
  if (!ctx) {
    showError('无法读取页面信息');
    return;
  }
  const parts = [];
  if (ctx.title && ctx.url) {
    parts.push(`当前页面: [${ctx.title}](${ctx.url})`);
  } else if (ctx.url) {
    parts.push(`当前页面: ${ctx.url}`);
  }
  if (ctx.selection) {
    parts.push(`页面选中内容:\n> ${ctx.selection}`);
  }
  if (parts.length === 0) {
    showError('当前页面没有可读取的内容（请在网页中选中文字）');
    return;
  }
  const text = parts.join('\n\n');
  els.inputBox.value = els.inputBox.value.trim()
    ? `${text}\n\n${els.inputBox.value.trim()}`
    : text;
  autoResizeInput();
  els.inputBox.focus();
  showToast('📄 已读取当前网页');
}

// ─── 导出当前对话 (Markdown) ───────────────────────────────
function exportChat() {
  if (state.messages.length === 0) {
    showError('当前没有可导出的对话');
    return;
  }
  const firstUser = state.messages.find((m) => m.role === 'user');
  const title = firstUser ? firstUser.content.slice(0, 40) : 'AI 对话';
  const lines = [
    `# ${title}`,
    '',
    `> 导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
  ];
  for (const msg of state.messages) {
    const who = msg.role === 'user' ? '👤 用户' : '🤖 AI';
    lines.push(`## ${who}`, '', msg.content, '');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-sidebar-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ 对话已导出为 Markdown');
}

// ─── 复制 ──────────────────────────────────────────────────
async function copyCode(btn) {
  const pre = btn.closest('pre');
  const code = pre?.querySelector('code');
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code.textContent);
    flashCopy(btn, '✅ 已复制');
  } catch {
    flashCopy(btn, '❌ 复制失败');
  }
}

async function copyMessage(btn) {
  const msgEl = btn.closest('.message');
  const bubble = msgEl?.querySelector('.message-bubble');
  if (!bubble) return;
  try {
    await navigator.clipboard.writeText(bubble.textContent.trim());
    flashCopy(btn, '✅ 已复制');
  } catch {
    flashCopy(btn, '❌ 复制失败');
  }
}

function flashCopy(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = old;
    btn.disabled = false;
  }, 1200);
}

/** 搜索结果链接白名单 */
function safeExternalUrl(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}

// ─── 轻量 Toast ────────────────────────────────────────────
let toastTimer = null;
function showToast(message) {
  let el = document.getElementById('miniToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'miniToast';
    el.className = 'mini-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
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
