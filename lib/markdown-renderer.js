/**
 * 轻量级 Markdown 渲染器 — 将 Markdown 文本转为 HTML
 * 纯客户端，无依赖。支持常用 GFM 语法。
 */

export class MarkdownRenderer {
  /**
   * 将 Markdown 文本渲染为 HTML 字符串
   */
  render(md) {
    if (!md) return '';
    let html = md;

    // 转义 HTML 特殊字符（代码块和行内代码除外）
    html = this._escapeHtml(html);

    // 处理代码块 (```)
    html = this._renderCodeBlocks(html);

    // 处理行内代码 (`code`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 处理标题 (### 到 #)
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 处理水平线
    html = html.replace(/^---+/gm, '<hr>');

    // 处理引用块
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // 处理无序列表
    html = html.replace(/^[\s]*[-*+] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    // 处理有序列表
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // 处理加粗和斜体（先处理加粗避免交叉）
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 处理链接 [text](url)
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );

    // 处理图片 ![alt](url)
    html = html.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" style="max-width:100%">'
    );

    // 处理表格 (简单支持)
    html = this._renderTables(html);

    // 处理段落 — 非标题/列表/引用/代码块/空行的文本行变为 <p>
    const lines = html.split('\n');
    const result = [];
    let inBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        inBlock = false;
        continue;
      }

      if (line.startsWith('<h') || line.startsWith('<li') || line.startsWith('<blockquote') ||
          line.startsWith('<pre') || line.startsWith('<ul') || line.startsWith('<ol') ||
          line.startsWith('<hr') || line.startsWith('<table') || line.startsWith('<img') ||
          line.startsWith('<p>') || line.endsWith('</p>') ||
          line.startsWith('<tr') || line.startsWith('<td') || line.startsWith('<th') ||
          line === '</ul>' || line === '</ol>' || line === '</blockquote>') {
        result.push(lines[i]);
        inBlock = false;
        continue;
      }

      if (!inBlock) {
        result.push('<p>' + line + '</p>');
      } else {
        result.push(line);
      }
    }

    html = result.join('\n');

    // 清理多余的嵌套
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/<\/ol>\s*<ol>/g, '');
    html = html.replace(/<\/blockquote>\s*<blockquote>/g, '<br>');

    return html || '<p style="color:#888">(空回复)</p>';
  }

  _escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _renderCodeBlocks(text) {
    return text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const langClass = lang ? ` class="lang-${lang}"` : '';
      const escaped = code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      return `<pre><code${langClass}>${escaped}</code></pre>`;
    });
  }

  _renderTables(text) {
    // 简单表格: 至少有两行, 第二行是分隔符
    const lines = text.split('\n');
    let inTable = false;
    let tableLines = [];
    const result = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('|') && line.split('|').length >= 3) {
        const cells = line.split('|').filter(c => c.trim());
        const isSeparator = cells.every(c => /^[\s:-]+$/.test(c.trim()));

        if (isSeparator) {
          // 第二行分隔符, 忽略
          inTable = true;
          continue;
        }

        if (!inTable && tableLines.length === 0) {
          tableLines.push(cells);
        } else if (inTable) {
          tableLines.push(cells);
        }
      } else {
        if (tableLines.length > 1) {
          result.push(this._buildTable(tableLines));
        }
        tableLines = [];
        inTable = false;
        result.push(line);
      }
    }

    if (tableLines.length > 1) {
      result.push(this._buildTable(tableLines));
    }

    return result.join('\n');
  }

  _buildTable(rows) {
    let html = '<table>';
    html += '<thead><tr>';
    for (const cell of rows[0]) {
      html += `<th>${cell.trim()}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let i = 1; i < rows.length; i++) {
      html += '<tr>';
      for (const cell of rows[i]) {
        html += `<td>${cell.trim()}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }
}
