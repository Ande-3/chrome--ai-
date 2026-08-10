/**
 * LLM API 客户端 — 支持三种协议
 *
 * 1. openai     — 任何 OpenAI 协议兼容端点 (chat/completions)
 * 2. anthropic  — Anthropic 原生 Messages API (x-api-key)
 * 3. gemini     — Google Gemini 原生 API (generativelanguage.googleapis.com)
 *
 * protocol 设为 'auto' 时根据 baseURL 自动识别。
 */

const PROVIDER_HINTS = [
  { id: 'anthropic', match: /anthropic\.com/i },
  { id: 'gemini', match: /generativelanguage\.googleapis\.com/i },
];

export class LLMClient {
  constructor(config) {
    this.baseURL = (config.baseURL || '').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.model = config.model || '';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 4096;
    this.protocol = this._resolveProtocol(config.protocol);
  }

  _resolveProtocol(protocol) {
    if (protocol && protocol !== 'auto') return protocol;
    for (const hint of PROVIDER_HINTS) {
      if (hint.match.test(this.baseURL)) return hint.id;
    }
    return 'openai';
  }

  /** 归一化 baseURL：OpenAI 需要以 /v1 结尾（兼容层），Anthropic/Gemini 独立处理 */
  _endpoint(path) {
    let base = this.baseURL;
    if (this.protocol === 'openai' && !/\/v\d+$/i.test(base)) {
      base = `${base}/v1`;
    }
    if (this.protocol === 'anthropic' && /\/v\d+$/i.test(base)) {
      return `${base}${path.replace(/^\/v\d+/, '')}`;
    }
    return `${base}${path}`;
  }

  /**
   * 发送流式聊天请求
   * @param {object} params
   * @param {Array} params.messages - 消息数组 [{role, content}]
   * @param {function} params.onChunk - 每次内容增量回调 (fullText: string) => void
   * @param {AbortSignal} params.signal - 中止信号
   * @param {string} params.model - 覆盖默认模型
   * @param {number} params.temperature - 覆盖默认 temperature
   * @param {string} params.systemPrompt - 可选的 system prompt
   * @returns {Promise<string>} 完整回复文本
   */
  async chat({ messages, onChunk, signal, model, temperature, systemPrompt }) {
    if (!this.apiKey) {
      throw new Error('API Key 未配置，请在设置页填写');
    }

    const msgs = [...(messages || [])];
    const emit = this._makeEmitter(onChunk);

    if (this.protocol === 'anthropic') {
      return this._chatAnthropic({ msgs, systemPrompt, model, temperature, signal, emit });
    }
    if (this.protocol === 'gemini') {
      return this._chatGemini({ msgs, systemPrompt, model, temperature, signal, emit });
    }
    return this._chatOpenAI({ msgs, systemPrompt, model, temperature, signal, emit });
  }

  /**
   * 非流式请求（用于测试连接等简单场景）
   */
  async chatSync({ messages, systemPrompt }) {
    if (!this.apiKey) throw new Error('API Key 未配置');
    const msgs = [...(messages || [])];
    const model = this.model;

    if (this.protocol === 'anthropic') {
      return this._syncAnthropic({ msgs, systemPrompt, model });
    }
    if (this.protocol === 'gemini') {
      return this._syncGemini({ msgs, systemPrompt, model });
    }
    return this._syncOpenAI({ msgs, systemPrompt, model });
  }

  /** 测试连接：发送一条最小请求并返回回复 */
  async testConnection() {
    const reply = await this.chatSync({
      messages: [{ role: 'user', content: 'ping' }],
      systemPrompt: '你是一个连接测试助手，只回复 pong。',
    });
    return String(reply || '').trim() || '(空回复)';
  }

  /**
   * 获取可用模型列表
   * @returns {Promise<string[]|null>} 模型 ID 数组；无法获取时返回 null
   */
  async listModels() {
    if (this.protocol === 'anthropic') return this._listAnthropic();
    if (this.protocol === 'gemini') return this._listGemini();
    return this._listOpenAI();
  }

  async _listOpenAI() {
    const response = await this._fetch(`${this._endpoint('/models')}`, {
      headers: this._headers(),
    });
    const data = await this._readJSON(response);
    const models = data?.data || data?.models || [];
    return models.map((m) => m.id || m.name).filter(Boolean);
  }

  async _listGemini() {
    const url = `${this._endpoint('/models')}?key=${encodeURIComponent(this.apiKey)}`;
    const response = await this._fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await this._readJSON(response);
    const models = data?.models || [];
    return models
      .filter((m) => (m.supportedGenerationMethods || []).some((s) => s.includes('generateContent')))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
  }

  async _listAnthropic() {
    // Anthropic 官方暂无公开的模型列表接口；尝试兼容端点，失败返回 null 由调用方回退
    try {
      const response = await this._fetch(`${this._endpoint('/v1/models')}`, {
        headers: this._anthropicHeaders(),
      });
      const data = await this._readJSON(response);
      const models = data?.data || [];
      return models.map((m) => m.id || m.name).filter(Boolean);
    } catch {
      return null;
    }
  }

  // ─── OpenAI 协议 ───────────────────────────────────────

  async _chatOpenAI({ msgs, systemPrompt, model, temperature, signal, emit }) {
    if (systemPrompt) msgs.unshift({ role: 'system', content: systemPrompt });

    const response = await this._fetch(`${this._endpoint('/chat/completions')}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        model: model || this.model,
        messages: msgs,
        temperature: temperature ?? this.temperature,
        max_tokens: this.maxTokens,
        stream: true,
      }),
      signal,
    });

    let fullContent = '';
    await this._readSSE(response, signal, (json) => {
      const content = json?.choices?.[0]?.delta?.content || '';
      if (content) {
        fullContent += content;
        emit(fullContent);
      }
    });
    emit(fullContent);
    return fullContent;
  }

  async _syncOpenAI({ msgs, systemPrompt, model }) {
    if (systemPrompt) msgs.unshift({ role: 'system', content: systemPrompt });
    const response = await this._fetch(`${this._endpoint('/chat/completions')}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        model: model || this.model,
        messages: msgs,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: false,
      }),
    });
    const data = await this._readJSON(response);
    return data.choices?.[0]?.message?.content || '';
  }

  // ─── Anthropic 原生协议 ────────────────────────────────

  async _chatAnthropic({ msgs, systemPrompt, model, temperature, signal, emit }) {
    const { messages, system } = this._prepareAnthropic(msgs, systemPrompt);
    const response = await this._fetch(`${this._endpoint('/v1/messages')}`, {
      method: 'POST',
      headers: this._anthropicHeaders(),
      body: JSON.stringify({
        model: model || this.model,
        max_tokens: this.maxTokens,
        temperature: temperature ?? this.temperature,
        stream: true,
        ...(system ? { system } : {}),
        messages,
      }),
      signal,
    });

    let fullContent = '';
    await this._readSSE(response, signal, (json) => {
      if (json?.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta.text) {
        fullContent += json.delta.text;
        emit(fullContent);
      } else if (json?.type === 'error') {
        throw new Error(json.error?.message || 'Anthropic 流式错误');
      }
    });
    emit(fullContent);
    return fullContent;
  }

  async _syncAnthropic({ msgs, systemPrompt, model }) {
    const { messages, system } = this._prepareAnthropic(msgs, systemPrompt);
    const response = await this._fetch(`${this._endpoint('/v1/messages')}`, {
      method: 'POST',
      headers: this._anthropicHeaders(),
      body: JSON.stringify({
        model: model || this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: false,
        ...(system ? { system } : {}),
        messages,
      }),
    });
    const data = await this._readJSON(response);
    return (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('') || '';
  }

  /** Anthropic 要求 system 单独传、角色交替、且首条必须是 user */
  _prepareAnthropic(msgs, systemPrompt) {
    let system = systemPrompt || '';
    const messages = [];
    for (const msg of msgs) {
      if (msg.role === 'system') {
        system = system ? `${system}\n\n${msg.content}` : msg.content;
        continue;
      }
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      const last = messages[messages.length - 1];
      if (last && last.role === role) {
        last.content += `\n\n${msg.content}`;
      } else {
        messages.push({ role, content: msg.content });
      }
    }
    // 去掉开头的 assistant 消息，确保首条为 user
    while (messages.length > 0 && messages[0].role === 'assistant') {
      messages.shift();
    }
    if (messages.length === 0) {
      messages.push({ role: 'user', content: '你好' });
    }
    return { messages, system };
  }

  _anthropicHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  // ─── Gemini 原生协议 ───────────────────────────────────

  async _chatGemini({ msgs, systemPrompt, model, temperature, signal, emit }) {
    const modelName = model || this.model || 'gemini-2.0-flash';
    const url = `${this._endpoint(`/models/${modelName}:streamGenerateContent`)}?alt=sse&key=${encodeURIComponent(this.apiKey)}`;
    const response = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this._geminiBody(msgs, systemPrompt, temperature)),
      signal,
    });

    let fullContent = '';
    await this._readSSE(response, signal, (json) => {
      if (json?.error) {
        throw new Error(json.error.message || JSON.stringify(json.error).slice(0, 300));
      }
      const candidates = Array.isArray(json) ? (json[json.length - 1] || {}).candidates : json?.candidates;
      const text = candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (text) {
        fullContent += text;
        emit(fullContent);
      }
    });
    emit(fullContent);
    return fullContent;
  }

  async _syncGemini({ msgs, systemPrompt, model }) {
    const modelName = model || this.model || 'gemini-2.0-flash';
    const url = `${this._endpoint(`/models/${modelName}:generateContent`)}?key=${encodeURIComponent(this.apiKey)}`;
    const response = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this._geminiBody(msgs, systemPrompt)),
    });
    const data = await this._readJSON(response);
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  }

  _geminiBody(msgs, systemPrompt, temperature) {
    const contents = msgs.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));
    const body = {
      contents,
      generationConfig: {
        temperature: temperature ?? this.temperature,
        maxOutputTokens: this.maxTokens,
      },
    };
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }
    return body;
  }

  // ─── 通用工具 ──────────────────────────────────────────

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  async _fetch(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('请求已取消');
      throw new Error(`网络请求失败: ${err.message}`);
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const detail = errText ? errText.slice(0, 500) : response.statusText;
      throw new Error(`API 请求失败 (${response.status}): ${detail}`);
    }
    return response;
  }

  async _readJSON(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`响应解析失败: ${text.slice(0, 300)}`);
    }
  }

  /** 通用 SSE 流读取：每行 `data: ...` 解析为 JSON 后回调 */
  async _readSSE(response, signal, onData) {
    if (!response.body) {
      throw new Error('当前浏览器不支持流式响应');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            onData(JSON.parse(payload));
          } catch {
            // 忽略无法解析的行
          }
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('请求已取消');
      if (err?.message?.includes('Anthropic')) throw err;
      throw err;
    }
  }

  /** 节流回调：最多每 50ms 通知一次，最终一定会推送完整内容 */
  _makeEmitter(onChunk) {
    if (typeof onChunk !== 'function') return () => {};
    let last = 0;
    let timer = null;
    let pending = '';

    const flush = () => {
      timer = null;
      if (pending !== '') {
        const text = pending;
        pending = '';
        onChunk(text);
      }
    };

    return (text) => {
      pending = text;
      const now = Date.now();
      if (!timer && now - last >= 50) {
        last = now;
        flush();
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          flush();
        }, 50);
      }
    };
  }
}
