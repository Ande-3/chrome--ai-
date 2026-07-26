/**
 * 搜索 API 客户端 — 支持多种搜索源
 *
 * 支持的 provider:
 *   tavily  - 专为 AI 设计的搜索 API (推荐)
 *   serpapi - Google 搜索结果
 *   bing    - Bing Search API
 *   google  - Google Custom Search
 */

const PROVIDERS = {
  tavily: {
    name: 'Tavily',
    endpoint: 'https://api.tavily.com/search',
    async fetch(apiKey, { query, count }) {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: count || 5,
          include_answer: false,
        }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Tavily 搜索失败 (${res.status}): ${err}`);
      }
      const data = await res.json();
      return (data.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content || r.snippet || '',
      }));
    },
  },

  serpapi: {
    name: 'SerpAPI',
    endpoint: 'https://serpapi.com/search',
    async fetch(apiKey, { query, count }) {
      const params = new URLSearchParams({
        q: query,
        api_key: apiKey,
        num: String(count || 5),
        engine: 'google',
      });
      const res = await fetch(`${this.endpoint}?${params}`);
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`SerpAPI 搜索失败 (${res.status}): ${err}`);
      }
      const data = await res.json();
      return (data.organic_results || []).map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet || '',
      }));
    },
  },

  bing: {
    name: 'Bing Search',
    endpoint: 'https://api.bing.microsoft.com/v7.0/search',
    async fetch(apiKey, { query, count }) {
      const params = new URLSearchParams({
        q: query,
        count: String(count || 5),
        mkt: 'zh-CN',
      });
      const res = await fetch(`${this.endpoint}?${params}`, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Bing 搜索失败 (${res.status}): ${err}`);
      }
      const data = await res.json();
      return (data.webPages?.value || []).map((r) => ({
        title: r.name,
        url: r.url,
        snippet: r.snippet || '',
      }));
    },
  },

  google: {
    name: 'Google Custom Search',
    endpoint: 'https://www.googleapis.com/customsearch/v1',
    async fetch(apiKey, { query, count, cx }) {
      // Google 需要 cx (Search Engine ID)，从 apiKey 中解析: "key|cx"
      const [key, cxId] = apiKey.split('|');
      if (!cxId) throw new Error('Google Custom Search 需要 API Key 格式: API_KEY|CX_ID');
      const params = new URLSearchParams({
        key: key,
        cx: cxId,
        q: query,
        num: String(Math.min(count || 5, 10)),
      });
      const res = await fetch(`${this.endpoint}?${params}`);
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Google 搜索失败 (${res.status}): ${err}`);
      }
      const data = await res.json();
      return (data.items || []).map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet || '',
      }));
    },
  },
};

export class SearchClient {
  constructor(config) {
    // 兼容新旧两种格式
    if (config.sources) {
      this.sources = config.sources.filter(s => s.enabled && s.apiKey);
      this.count = config.count || 'auto';
    } else {
      this.sources = config.provider && config.apiKey
        ? [{ provider: config.provider, apiKey: config.apiKey }]
        : [];
      this.count = config.count || 'auto';
    }
    this.countNum = this.count === 'auto' ? 8 : (parseInt(this.count) || 5);
  }

  /**
   * 执行搜索 — 自动使用第一个启用的搜索源，失败时尝试下一个
   * @param {string} query
   * @param {object} [options]
   * @param {number} [options.count]
   * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
   */
  async search(query, options = {}) {
    if (this.sources.length === 0) {
      throw new Error('未配置搜索源，请在设置页添加搜索服务');
    }

    const count = options.count || this.countNum;

    // 依次尝试启用的搜索源
    const errors = [];
    for (const source of this.sources) {
      const provider = PROVIDERS[source.provider];
      if (!provider) {
        errors.push(`不支持的搜索源: ${source.provider}`);
        continue;
      }
      try {
        return await provider.fetch(source.apiKey, { query, count });
      } catch (err) {
        errors.push(`${provider.name}: ${err.message}`);
        // 继续尝试下一个
      }
    }

    // 所有源都失败了
    throw new Error('搜索失败:\n' + errors.join('\n'));
  }

  /** 检查是否至少有一个搜索源已配置 */
  isConfigured() {
    return this.sources.length > 0;
  }

  /** 获取已启用的搜索源名称列表 */
  getProviderNames() {
    return this.sources.map(s => PROVIDERS[s.provider]?.name || s.provider);
  }

  /** 获取本次搜索实际使用的数量 */
  getEffectiveCount() {
    return this.countNum;
  }
}

/** 获取支持的搜索源列表 */
export function getAvailableProviders() {
  return Object.entries(PROVIDERS).map(([key, val]) => ({
    id: key,
    name: val.name,
  }));
}
