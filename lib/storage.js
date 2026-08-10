/**
 * chrome.storage 封装 — 统一的存储读写接口
 */

const Storage = {
  /** 默认配置 */
  DEFAULTS: {
    llm: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      protocol: 'auto',       // 'auto' | 'openai' | 'anthropic' | 'gemini'
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 4096,
    },
    search: {
      sources: [],    // [{ provider, apiKey, enabled }]
      count: 'auto',  // 'auto' | 1-10
    },
    general: {
      contextMenu: true,
      searchMode: false,
      systemPrompt: '你是一个有帮助的 AI 助手。请用中文回答。',
      maxContextMessages: 20, // 发送给 API 的最近消息条数
      hiddenModels: [],        // 在模型下拉框中隐藏的模型 ID
    },
  },

  /** 读取所有配置（兼容旧格式） */
  async getAll() {
    const result = await chrome.storage.local.get('config');
    let config = result.config || {};

    // 兼容旧格式：将单 search.provider/apiKey 转为 sources 数组
    if (config.search && config.search.provider && !config.search.sources) {
      if (config.search.provider) {
        config.search.sources = [{
          provider: config.search.provider,
          apiKey: config.search.apiKey || '',
          enabled: true,
        }];
      }
      // 清理旧字段
      delete config.search.provider;
      delete config.search.apiKey;
    }

    return {
      llm: { ...this.DEFAULTS.llm, ...(config.llm || {}) },
      search: { ...this.DEFAULTS.search, ...(config.search || {}) },
      general: { ...this.DEFAULTS.general, ...(config.general || {}) },
    };
  },

  /** 保存全部配置 — 直接写入，不合并旧数据 */
  async save(config) {
    // 清理旧格式残留字段，保证数据干净
    const clean = {
      llm: { ...this.DEFAULTS.llm, ...config.llm },
      search: { ...this.DEFAULTS.search, ...config.search },
      general: { ...this.DEFAULTS.general, ...config.general },
    };
    if (!Array.isArray(clean.search.sources)) clean.search.sources = [];
    if (!Array.isArray(clean.general.hiddenModels)) clean.general.hiddenModels = [];
    clean.general.maxContextMessages = Math.max(
      2, Math.min(parseInt(clean.general.maxContextMessages) || 20, 100)
    );
    delete clean.search.provider;
    delete clean.search.apiKey;

    await chrome.storage.local.set({ config: clean });
    return clean;
  },

  /** 保存部分配置 */
  async savePartial(path, values) {
    const config = await this.getAll();
    const section = config[path];
    if (section) {
      Object.assign(section, values);
    }
    await chrome.storage.local.set({ config });
    return config;
  },

  /** 获取第一个启用的搜索源 */
  async getFirstEnabledSource() {
    const config = await this.getAll();
    const sources = config.search.sources || [];
    return sources.find(s => s.enabled) || null;
  },

  // ─── 会话管理 ──────────────────────────────────────────

  async getSessions() {
    const result = await chrome.storage.local.get('sessions');
    const sessions = result.sessions || [];
    return sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  async saveSession(session) {
    const sessions = await this.getSessions();
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      sessions[idx] = { ...sessions[idx], ...session, updatedAt: Date.now() };
    } else {
      sessions.unshift({ ...session, updatedAt: Date.now() });
    }
    const trimmed = sessions.slice(0, 50);
    await chrome.storage.local.set({ sessions: trimmed });
    return trimmed;
  },

  async deleteSession(id) {
    const sessions = await this.getSessions();
    const filtered = sessions.filter((s) => s.id !== id);
    await chrome.storage.local.set({ sessions: filtered });
    return filtered;
  },

  async clearSessions() {
    await chrome.storage.local.remove('sessions');
  },

  /** 重命名会话标题 */
  async renameSession(id, title) {
    const sessions = await this.getSessions();
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx >= 0) {
      sessions[idx].title = title;
      sessions[idx].updatedAt = Date.now();
      await chrome.storage.local.set({ sessions });
    }
    return sessions;
  },

  onChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.config) {
        callback(changes.config.newValue);
      }
    });
  },
};

export default Storage;
