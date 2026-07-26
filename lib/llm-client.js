/**
 * LLM API 客户端 — 支持任何 OpenAI 协议兼容的端点
 *
 * 支持:
 *   - OpenAI       https://api.openai.com/v1
 *   - Anthropic    https://api.anthropic.com/v1  (通过 Anthropic 的 OpenAI 兼容层)
 *   - Ollama       http://localhost:11434/v1
 *   - DeepSeek     https://api.deepseek.com/v1
 *   - 其他兼容 OpenAI 协议的 API
 */

export class LLMClient {
  constructor(config) {
    this.baseURL = config.baseURL.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 4096;
  }

  /**
   * 发送流式聊天请求
   * @param {object} params
   * @param {Array} params.messages - 消息数组 [{role, content}]
   * @param {function} params.onChunk - 每收到一个文本块的回调 (text: string) => void
   * @param {AbortSignal} params.signal - 可选的中止信号
   * @param {string} params.model - 覆盖默认模型
   * @param {number} params.temperature - 覆盖默认 temperature
   * @param {string} params.systemPrompt - 可选的 system prompt
   * @returns {Promise<string>} 完整回复文本
   */
  async chat({ messages, onChunk, signal, model, temperature, systemPrompt }) {
    if (!this.apiKey) {
      throw new Error('API Key 未配置，请在设置页填写');
    }

    const msgs = [...messages];
    if (systemPrompt) {
      msgs.unshift({ role: 'system', content: systemPrompt });
    }

    const url = `${this.baseURL}/chat/completions`;
    const body = {
      model: model || this.model,
      messages: msgs,
      temperature: temperature ?? this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API 请求失败 (${response.status}): ${errText || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              fullContent += content;
              chunkCount++;
              if (onChunk && chunkCount % 2 === 0) {
                // 每 2 个 chunk 回调一次，避免高频刷新
                onChunk(fullContent);
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      // 处理 buffer 中剩余的数据
      if (buffer.trim()) {
        const data = buffer.trim().slice(6);
        if (data && data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) fullContent += content;
          } catch {}
        }
      }

      // 最终回调
      if (onChunk) onChunk(fullContent);
      return fullContent;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('请求已取消');
      }
      throw err;
    }
  }

  /**
   * 非流式请求（适用于简单场景）
   */
  async chatSync({ messages, systemPrompt }) {
    if (!this.apiKey) throw new Error('API Key 未配置');

    const msgs = [...messages];
    if (systemPrompt) msgs.unshift({ role: 'system', content: systemPrompt });

    const url = `${this.baseURL}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: msgs,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API 请求失败 (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }
}
