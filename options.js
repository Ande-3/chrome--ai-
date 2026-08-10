/**
 * 设置页面逻辑 — 多搜索源 + Auto Count
 */

const $ = (id) => document.getElementById(id);

const fields = {
  llmPreset: $('llmPreset'),
  llmBaseURL: $('llmBaseURL'),
  llmProtocol: $('llmProtocol'),
  llmApiKey: $('llmApiKey'),
  llmModel: $('llmModel'),
  llmMaxTokens: $('llmMaxTokens'),
  llmTemperature: $('llmTemperature'),
  tempValue: $('tempValue'),
  systemPrompt: $('systemPrompt'),
  btnTestConnection: $('btnTestConnection'),
  testResult: $('testResult'),
  searchSourcesList: $('searchSourcesList'),
  searchCount: $('searchCount'),
  btnAddSource: $('btnAddSource'),
  contextMenu: $('contextMenu'),
  defaultSearchMode: $('defaultSearchMode'),
  maxContextMessages: $('maxContextMessages'),
  btnReset: $('btnReset'),
  settingsForm: $('settingsForm'),
  toast: $('toast'),
  btnExport: $('btnExport'),
  btnImport: $('btnImport'),
  importFile: $('importFile'),
  rawStorageDump: $('rawStorageDump'),
  btnRefreshDump: $('btnRefreshDump'),
};

const PRESETS = {
  openai:      { baseURL: 'https://api.openai.com/v1',                           model: 'gpt-4o-mini',              protocol: 'openai' },
  claude:      { baseURL: 'https://api.anthropic.com',                           model: 'claude-sonnet-4-20250514', protocol: 'anthropic' },
  deepseek:    { baseURL: 'https://api.deepseek.com/v1',                         model: 'deepseek-chat',            protocol: 'openai' },
  ollama:      { baseURL: 'http://localhost:11434/v1',                           model: 'qwen2.5:7b',               protocol: 'openai' },
  siliconflow: { baseURL: 'https://api.siliconflow.cn/v1',                       model: 'Qwen/Qwen2.5-7B-Instruct', protocol: 'openai' },
  gemini:      { baseURL: 'https://generativelanguage.googleapis.com/v1beta',    model: 'gemini-2.5-flash',         protocol: 'gemini' },
};

const PROVIDER_META = {
  tavily:  { name: 'Tavily',          keyLabel: 'API Key',         keyPlaceholder: '在 https://app.tavily.com 获取' },
  serpapi: { name: 'SerpAPI',         keyLabel: 'API Key',         keyPlaceholder: '在 https://serpapi.com 获取' },
  bing:    { name: 'Bing Search',     keyLabel: 'Subscription Key',keyPlaceholder: '在 Azure Portal 获取' },
  google:  { name: 'Google Custom Search', keyLabel: 'API Key|CX ID', keyPlaceholder: '格式: API_KEY|CX_ID' },
  brave:   { name: 'Brave Search',    keyLabel: 'API Key',         keyPlaceholder: '在 https://brave.com/search/api/ 获取' },
  searxng: { name: 'SearXNG',         keyLabel: 'API Key (可选)',  keyPlaceholder: '自建实例通常无需 Key' },
};

function esc(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── 初始化 ────────────────────────────────────────────────
async function init() {
  const config = await getConfig();

  fields.llmBaseURL.value = config.llm.baseURL || '';
  fields.llmProtocol.value = config.llm.protocol || 'auto';
  fields.llmApiKey.value = config.llm.apiKey || '';
  fields.llmModel.value = config.llm.model || '';
  fields.llmMaxTokens.value = config.llm.maxTokens || 4096;
  fields.llmTemperature.value = config.llm.temperature ?? 0.7;
  fields.tempValue.textContent = config.llm.temperature ?? 0.7;
  fields.systemPrompt.value = config.general.systemPrompt || '';

  fields.contextMenu.checked = config.general.contextMenu !== false;
  fields.defaultSearchMode.checked = config.general.searchMode || false;
  fields.maxContextMessages.value = config.general.maxContextMessages || 20;

  // 搜索次数
  const count = config.search.count;
  fields.searchCount.value = count === 'auto' || !count ? 'auto' : String(count);

  // 多搜索源
  renderSourceCards(config.search.sources || []);

  // 刷新原始数据展示
  refreshRawDump();

  matchPreset();
  bindEvents();
}

// ─── 渲染搜索源卡片 ────────────────────────────────────────
function renderSourceCards(sources) {
  fields.searchSourcesList.innerHTML = '';
  if (!sources || sources.length === 0) {
    fields.searchSourcesList.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;padding:8px;">暂无搜索源，点击下方按钮添加</div>';
    return;
  }
  sources.forEach((source, idx) => {
    const card = document.createElement('div');
    card.className = 'source-card';
    card.innerHTML = `
      <div class="source-header">
        <select class="src-provider" data-idx="${idx}">
          <option value="">— 选择搜索源 —</option>
          <option value="tavily">Tavily</option>
          <option value="serpapi">SerpAPI</option>
          <option value="bing">Bing Search</option>
          <option value="google">Google Custom Search</option>
          <option value="brave">Brave Search</option>
          <option value="searxng">SearXNG (自建)</option>
        </select>
        <label><input type="checkbox" class="src-enabled" data-idx="${idx}" ${source.enabled !== false ? 'checked' : ''}> 启用</label>
        <button type="button" class="btn btn-danger btn-sm src-remove" data-idx="${idx}">✕</button>
      </div>
      <div class="field" style="margin-bottom:6px">
        <label>显示名称</label>
        <input type="text" class="src-name" data-idx="${idx}" placeholder="给这个搜索源起个名字" value="${esc(source.name)}">
      </div>
      <div class="field src-baseurl-field" style="margin-bottom:6px;display:${source.provider === 'searxng' ? 'block' : 'none'}">
        <label>实例地址 (Base URL)</label>
        <input type="url" class="src-baseurl" data-idx="${idx}" placeholder="http://localhost:8080" value="${esc(source.baseURL || '')}">
      </div>
      <div class="field" style="margin-bottom:0">
        <label class="src-key-label">${PROVIDER_META[source.provider]?.keyLabel || 'API Key'}</label>
        <input type="password" class="src-apikey" data-idx="${idx}" placeholder="${PROVIDER_META[source.provider]?.keyPlaceholder || '输入 API Key'}" autocomplete="off" value="${esc(source.apiKey)}">
      </div>
    `;
    card.querySelector('.src-provider').value = source.provider || '';
    card.querySelector('.src-name').value = source.name || '';
    card.querySelector('.src-baseurl').value = source.baseURL || '';
    card.querySelector('.src-apikey').value = source.apiKey || '';
    fields.searchSourcesList.appendChild(card);
  });

  // 绑定卡片事件
  document.querySelectorAll('.src-provider').forEach(el => {
    el.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const provider = e.target.value;
      const card = e.target.closest('.source-card');
      const keyInput = card.querySelector('.src-apikey');
      const keyLabel = card.querySelector('.src-key-label');
      const meta = PROVIDER_META[provider];
      if (meta) {
        keyLabel.textContent = meta.keyLabel;
        keyInput.placeholder = meta.keyPlaceholder;
      }
      // 显示/隐藏 SearXNG 的实例地址输入框
      card.querySelector('.src-baseurl-field').style.display = provider === 'searxng' ? 'block' : 'none';
    });
  });

  document.querySelectorAll('.src-remove').forEach(el => {
    el.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const sources = collectSources();
      sources.splice(idx, 1);
      renderSourceCards(sources);
    });
  });
}

// ─── 收集当前 UI 中的搜索源 ──────────────────────────────
function collectSources() {
  const sources = [];
  document.querySelectorAll('.source-card').forEach(card => {
    const provider = card.querySelector('.src-provider').value;
    const apiKey = card.querySelector('.src-apikey').value.trim();
    const name = card.querySelector('.src-name').value.trim();
    const baseURL = card.querySelector('.src-baseurl').value.trim();
    const enabled = card.querySelector('.src-enabled').checked;
    if (provider) {
      sources.push({ provider, apiKey, enabled, name, baseURL });
    }
  });
  return sources;
}

// ─── 事件绑定 ──────────────────────────────────────────────
function bindEvents() {
  fields.llmPreset.addEventListener('change', (e) => {
    const preset = PRESETS[e.target.value];
    if (!preset) return;
    fields.llmBaseURL.value = preset.baseURL;
    fields.llmModel.value = preset.model;
    if (preset.protocol) fields.llmProtocol.value = preset.protocol;
  });

  fields.llmTemperature.addEventListener('input', (e) => {
    fields.tempValue.textContent = e.target.value;
  });

  // 添加搜索源
  fields.btnAddSource.addEventListener('click', () => {
    const sources = collectSources();
    sources.push({ provider: 'tavily', apiKey: '', enabled: true });
    renderSourceCards(sources);
  });

  fields.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettings();
  });

  fields.btnReset.addEventListener('click', async () => {
    if (!confirm('重置所有设置为默认值？')) return;
    await chrome.storage.local.remove('config');
    showToast('已重置');
    init();
  });

  // 导出导入 & 诊断
  fields.btnRefreshDump.addEventListener('click', () => refreshRawDump());
  fields.btnExport.addEventListener('click', exportConfig);
  fields.btnImport.addEventListener('click', () => fields.importFile.click());
  fields.importFile.addEventListener('change', importConfig);
  fields.btnTestConnection.addEventListener('click', testConnection);
}

// ─── 保存设置 ──────────────────────────────────────────────
async function saveSettings() {
  const sources = collectSources();

  const config = {
    llm: {
      baseURL: fields.llmBaseURL.value.trim() || 'https://api.openai.com/v1',
      protocol: fields.llmProtocol.value || 'auto',
      apiKey: fields.llmApiKey.value.trim(),
      model: fields.llmModel.value.trim() || 'gpt-4o-mini',
      maxTokens: parseInt(fields.llmMaxTokens.value) || 4096,
      temperature: parseFloat(fields.llmTemperature.value) || 0.7,
    },
    search: {
      sources,
      count: fields.searchCount.value === 'auto' ? 'auto' : parseInt(fields.searchCount.value),
    },
    general: {
      contextMenu: fields.contextMenu.checked,
      searchMode: fields.defaultSearchMode.checked,
      systemPrompt: fields.systemPrompt.value.trim() || '你是一个有帮助的 AI 助手。请用中文回答。',
      maxContextMessages: parseInt(fields.maxContextMessages.value) || 20,
    },
  };

  const result = await sendMessage({ type: 'save-config', config });
  if (result && result.error) {
    showToast('❌ 保存失败: ' + result.error, true);
    return;
  }

  // 立即读回验证
  const verify = await sendMessage({ type: 'get-config' });
  const savedCount = (verify.search?.sources || []).length;
  if (savedCount !== sources.length) {
    showToast(`⚠️ 数据可能未保存成功 (预期 ${sources.length} 个源, 实际 ${savedCount} 个)`, true);
    return;
  }

  showToast('✅ 设置已保存');
}

// ─── 测试连接 ──────────────────────────────────────────────
async function testConnection() {
  fields.testResult.textContent = '⏳ 测试中，请稍候...';
  fields.testResult.style.color = 'var(--text-secondary)';
  fields.btnTestConnection.disabled = true;
  try {
    const llm = {
      baseURL: fields.llmBaseURL.value.trim(),
      protocol: fields.llmProtocol.value || 'auto',
      apiKey: fields.llmApiKey.value.trim(),
      model: fields.llmModel.value.trim(),
      temperature: parseFloat(fields.llmTemperature.value) || 0.7,
      maxTokens: parseInt(fields.llmMaxTokens.value) || 4096,
    };
    if (!llm.baseURL || !llm.apiKey) {
      throw new Error('请先填写 Base URL 和 API Key');
    }
    const result = await sendMessage({ type: 'test-connection', config: llm });
    if (result?.error) throw new Error(result.error);
    fields.testResult.textContent = `✅ 连接成功，模型回复：${String(result.reply || 'pong').slice(0, 120)}`;
    fields.testResult.style.color = 'var(--success)';
  } catch (err) {
    fields.testResult.textContent = `❌ 连接失败：${err.message}`;
    fields.testResult.style.color = 'var(--danger)';
  } finally {
    fields.btnTestConnection.disabled = false;
  }
}

// ─── 匹配预设 ──────────────────────────────────────────────
function matchPreset() {
  const baseURL = fields.llmBaseURL.value.replace(/\/+$/, '');
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (preset.baseURL === baseURL && preset.model === fields.llmModel.value) {
      fields.llmPreset.value = key;
      return;
    }
  }
  fields.llmPreset.value = '';
}

// ─── Toast ─────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  fields.toast.textContent = message;
  fields.toast.className = 'toast show' + (isError ? ' error' : '');
  toastTimer = setTimeout(() => fields.toast.classList.remove('show'), 2500);
}

function getConfig() { return sendMessage({ type: 'get-config' }); }
function sendMessage(msg) { return chrome.runtime.sendMessage(msg); }

// ─── 诊断：显示原始存储数据 ────────────────────────────
async function refreshRawDump() {
  try {
    const raw = await sendMessage({ type: 'get-config' });
    fields.rawStorageDump.textContent = JSON.stringify(raw, null, 2);
  } catch (err) {
    fields.rawStorageDump.textContent = '读取失败: ' + err.message;
  }
}

// ─── 导出配置 ───────────────────────────────────────────
async function exportConfig() {
  const raw = await sendMessage({ type: 'get-config' });
  const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-sidebar-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📤 配置已导出');
}

// ─── 导入配置 ───────────────────────────────────────────
async function importConfig(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const config = JSON.parse(text);
    await sendMessage({ type: 'save-config', config });
    showToast('📥 配置已导入，刷新页面');
    setTimeout(() => location.reload(), 500);
  } catch (err) {
    showToast('❌ 导入失败: ' + err.message, true);
  }
  fields.importFile.value = '';
}

document.addEventListener('DOMContentLoaded', init);
