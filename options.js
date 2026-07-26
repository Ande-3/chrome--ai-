/**
 * 设置页面逻辑 — 多搜索源 + Auto Count
 */

const $ = (id) => document.getElementById(id);

const fields = {
  llmPreset: $('llmPreset'),
  llmBaseURL: $('llmBaseURL'),
  llmApiKey: $('llmApiKey'),
  llmModel: $('llmModel'),
  llmMaxTokens: $('llmMaxTokens'),
  llmTemperature: $('llmTemperature'),
  tempValue: $('tempValue'),
  systemPrompt: $('systemPrompt'),
  searchSourcesList: $('searchSourcesList'),
  searchCount: $('searchCount'),
  btnAddSource: $('btnAddSource'),
  contextMenu: $('contextMenu'),
  defaultSearchMode: $('defaultSearchMode'),
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
  openai:    { baseURL: 'https://api.openai.com/v1',               model: 'gpt-4o-mini' },
  claude:    { baseURL: 'https://api.anthropic.com/v1',            model: 'claude-sonnet-4-20250514' },
  deepseek:  { baseURL: 'https://api.deepseek.com/v1',            model: 'deepseek-chat' },
  ollama:    { baseURL: 'http://localhost:11434/v1',               model: 'qwen2.5:7b' },
  siliconflow: { baseURL: 'https://api.siliconflow.cn/v1',        model: 'Qwen/Qwen2.5-7B-Instruct' },
};

const PROVIDER_META = {
  tavily:  { name: 'Tavily',          keyLabel: 'API Key',         keyPlaceholder: '在 https://app.tavily.com 获取' },
  serpapi: { name: 'SerpAPI',         keyLabel: 'API Key',         keyPlaceholder: '在 https://serpapi.com 获取' },
  bing:    { name: 'Bing Search',     keyLabel: 'Subscription Key',keyPlaceholder: '在 Azure Portal 获取' },
  google:  { name: 'Google Custom Search', keyLabel: 'API Key|CX ID', keyPlaceholder: '格式: API_KEY|CX_ID' },
};

// ─── 初始化 ────────────────────────────────────────────────
async function init() {
  const config = await getConfig();

  fields.llmBaseURL.value = config.llm.baseURL || '';
  fields.llmApiKey.value = config.llm.apiKey || '';
  fields.llmModel.value = config.llm.model || '';
  fields.llmMaxTokens.value = config.llm.maxTokens || 4096;
  fields.llmTemperature.value = config.llm.temperature ?? 0.7;
  fields.tempValue.textContent = config.llm.temperature ?? 0.7;
  fields.systemPrompt.value = config.general.systemPrompt || '';

  fields.contextMenu.checked = config.general.contextMenu !== false;
  fields.defaultSearchMode.checked = config.general.searchMode || false;

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
        </select>
        <label><input type="checkbox" class="src-enabled" data-idx="${idx}" ${source.enabled !== false ? 'checked' : ''}> 启用</label>
        <button type="button" class="btn btn-danger btn-sm src-remove" data-idx="${idx}">✕</button>
      </div>
      <div class="field" style="margin-bottom:6px">
        <label>显示名称</label>
        <input type="text" class="src-name" data-idx="${idx}" placeholder="给这个搜索源起个名字">
      </div>
      <div class="field" style="margin-bottom:0">
        <label class="src-key-label">${PROVIDER_META[source.provider]?.keyLabel || 'API Key'}</label>
        <input type="password" class="src-apikey" data-idx="${idx}" placeholder="${PROVIDER_META[source.provider]?.keyPlaceholder || '输入 API Key'}" autocomplete="off">
      </div>
    `;
    card.querySelector('.src-provider').value = source.provider || '';
    card.querySelector('.src-name').value = source.name || '';
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
    const enabled = card.querySelector('.src-enabled').checked;
    if (provider) {
      sources.push({ provider, apiKey, enabled, name });
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
}

// ─── 保存设置 ──────────────────────────────────────────────
async function saveSettings() {
  const sources = collectSources();

  const config = {
    llm: {
      baseURL: fields.llmBaseURL.value.trim() || 'https://api.openai.com/v1',
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
