/**
 * 轻量级 Markdown 渲染器 — 将 Markdown 文本转为 HTML
 * 纯客户端，无依赖。支持常用 GFM 语法。
 *
 * 安全设计：
 *   - 所有文本先转义 HTML 特殊字符（含引号）
 *   - 链接 / 图片 URL 经过 scheme 白名单校验，阻止 javascript: 等危险链接
 *   - 行内代码使用占位符隔离，避免被链接/加粗规则污染
 */

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class MarkdownRenderer {
  /**
   * 将 Markdown 文本渲染为 HTML 字符串
   */
  render(md) {
    if (!md) return '';
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      // 代码块
      const fence = trimmed.match(/^```(\w*)\s*$/);
      if (fence) {
        const lang = fence[1];
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        i++; // 跳过结束标记
        out.push(this._codeBlock(code.join('\n'), lang));
        continue;
      }

      if (!trimmed) {
        i++;
        continue;
      }

      // 标题
      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${this._inline(heading[2])}</h${level}>`);
        i++;
        continue;
      }

      // 水平线
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // 表格（表头 + 分隔行）
      if (this._isTableRow(trimmed) && i + 1 < lines.length && this._isTableSeparator(lines[i + 1])) {
        const rows = [this._tableCells(trimmed)];
        i += 2;
        while (i < lines.length && this._isTableRow(lines[i]) && !this._isTableSeparator(lines[i])) {
          rows.push(this._tableCells(lines[i]));
          i++;
        }
        out.push(this._buildTable(rows));
        continue;
      }

      // 引用块
      if (trimmed.startsWith('>')) {
        const quote = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quote.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${this._inline(quote.join('\n'))}</blockquote>`);
        continue;
      }

      // 列表
      const listMatch = trimmed.match(/^([-*+]|\d+\.)\s+(.+)$/);
      if (listMatch) {
        const ordered = /^\d+\./.test(listMatch[1]);
        const items = [];
        while (i < lines.length) {
          const cur = lines[i].trim();
          const m = cur.match(/^([-*+]|\d+\.)\s+(.+)$/);
          if (!m) break;
          if ((/^\d+\./.test(m[1])) !== ordered) break;
          items.push(m[2]);
          i++;
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>` +
          items.map((t) => {
            const task = t.match(/^\[([ xX])\]\s+(.+)$/);
            if (task) {
              const checked = /[xX]/.test(task[1]);
              return `<li><input type="checkbox" class="task-checkbox" disabled ${checked ? 'checked' : ''}> ${this._inline(task[2])}</li>`;
            }
            return `<li>${this._inline(t)}</li>`;
          }).join('') +
          `</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }

      // 普通段落（合并连续文本行）
      const para = [trimmed];
      i++;
      while (i < lines.length && this._isParagraphLine(lines[i])) {
        para.push(lines[i].trim());
        i++;
      }
      out.push(`<p>${this._inline(para.join(' '))}</p>`);
    }

    return out.join('\n') || '<p style="color:#888">(空回复)</p>';
  }

  _isParagraphLine(line) {
    const t = line.trim();
    if (!t) return false;
    if (/^(#{1,6})\s/.test(t)) return false;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return false;
    if (/^```/.test(t)) return false;
    if (t.startsWith('>')) return false;
    if (/^([-*+]|\d+\.)\s+/.test(t)) return false;
    if (this._isTableSeparator(t)) return false;
    return true;
  }

  /**
   * 行内格式化（先转义，再按安全顺序处理）
   */
  _inline(text) {
    let html = escapeHtml(text);
    const codeMap = new Map();
    let codeIdx = 0;

    // 行内代码先隔离
    html = html.replace(/`([^`\n]+)`/g, (m, c) => {
      const key = `\u0000IC${codeIdx++}\u0000`;
      codeMap.set(key, `<code>${c}</code>`);
      return key;
    });

    // 图片（必须在链接之前，且 URL 校验）
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
      const safe = this._sanitizeUrl(src, true);
      return safe
        ? `<img src="${safe}" alt="${alt}" loading="lazy" style="max-width:100%">`
        : '';
    });

    // 链接（URL 校验）
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      const safe = this._sanitizeUrl(url);
      return safe
        ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`
        : text;
    });

    // 裸链接自动识别（排除已在 href 属性中的）
    html = html.replace(
      /(?<!=")(?<!>)(https?:\/\/[^\s<>"')\]）]+)/g,
      (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`
    );

    // 删除线 → 加粗 → 斜体
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(?!\*)(.+?)\*/g, '<em>$1</em>');

    // 恢复行内代码
    html = html.replace(/\u0000IC\d+\u0000/g, (m) => codeMap.get(m) || '');
    return html;
  }

  /** URL 白名单校验：http/https/mailto/tel、相对路径、锚点、data:image */
  _sanitizeUrl(url, isImage = false) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    if (isImage && lower.startsWith('data:image/')) return trimmed;
    if (/^(https?:|mailto:|tel:)/i.test(lower)) return trimmed;
    if (lower.startsWith('//')) return trimmed;
    if (/^[#/.\\]/.test(trimmed)) return trimmed;
    return '';
  }

  _codeBlock(code, lang) {
    const escaped = escapeHtml(code);
    const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : '';
    return `<pre class="code-block"><button type="button" class="code-copy" title="复制代码">⧉ 复制</button><code${langClass}>${escaped}</code></pre>`;
  }

  _isTableRow(line) {
    return line.includes('|') && line.split('|').filter((c) => c.trim()).length >= 2;
  }

  _isTableSeparator(line) {
    if (!this._isTableRow(line)) return false;
    return line.split('|')
      .map((c) => c.trim())
      .filter(Boolean)
      .every((c) => /^:?-{2,}:?$/.test(c));
  }

  _tableCells(line) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells[0] === '') cells.shift();
    if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    return cells;
  }

  _buildTable(rows) {
    let html = '<table><thead><tr>';
    for (const cell of rows[0]) html += `<th>${this._inline(cell)}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 1; r < rows.length; r++) {
      html += '<tr>';
      for (const cell of rows[r]) html += `<td>${this._inline(cell)}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }
}
