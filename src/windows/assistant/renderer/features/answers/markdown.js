// Small markdown renderer for streamed answers. Everything is HTML-escaped
// first, so model output can never inject markup.

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(escapedText) {
  return escapedText
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

function renderTextBlock(text) {
  const html = [];
  let listType = null;
  let paragraph = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    if (heading) {
      flushParagraph();
      closeList();
      html.push(`<h4>${renderInline(escapeHtml(heading[2]))}</h4>`);
      continue;
    }

    if (bullet || numbered) {
      flushParagraph();
      const nextType = bullet ? 'ul' : 'ol';
      if (listType !== nextType) {
        closeList();
        html.push(`<${nextType}>`);
        listType = nextType;
      }
      html.push(`<li>${renderInline(escapeHtml((bullet || numbered)[1]))}</li>`);
      continue;
    }

    closeList();
    paragraph.push(renderInline(escapeHtml(line.trim())));
  }

  flushParagraph();
  closeList();
  return html.join('');
}

export function renderMarkdown(source) {
  const text = String(source ?? '');
  const parts = text.split('```');
  const html = [];

  // Odd-numbered parts are inside a code fence. While an answer is still
  // streaming the last fence may be unclosed; it is rendered as code too.
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const newlineIndex = part.indexOf('\n');
      const code = newlineIndex === -1 ? '' : part.slice(newlineIndex + 1);
      html.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
      return;
    }

    if (part.trim()) {
      html.push(renderTextBlock(part));
    }
  });

  return html.join('');
}
