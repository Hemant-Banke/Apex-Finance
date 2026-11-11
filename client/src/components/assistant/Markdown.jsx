import { Fragment } from 'react';

/**
 * Markdown — the subset the assistant writes (headings, lists, tables, emphasis, code, links),
 * rendered as React elements. Never as HTML, so model text cannot inject markup.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text, keyBase = 'i') {
  const parts = String(text).split(INLINE);
  return parts.map((p, i) => {
    const key = `${keyBase}${i}`;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={key} style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{inline(p.slice(2, -2), key)}</strong>;
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={key} className="md-code">{p.slice(1, -1)}</code>;
    if ((p.startsWith('*') && p.endsWith('*') && p.length > 2) || (p.startsWith('_') && p.endsWith('_') && p.length > 2)) return <em key={key}>{inline(p.slice(1, -1), key)}</em>;
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const safe = /^https?:\/\//i.test(link[2]);
      return safe
        ? <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer" className="md-link">{link[1]}</a>
        : <Fragment key={key}>{link[1]}</Fragment>;
    }
    return <Fragment key={key}>{p}</Fragment>;
  });
}

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
const LIST = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;

function parse(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.trim().startsWith('```')) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push({ t: 'code', body: body.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map(c => (c.endsWith(':') ? 'right' : 'left'));
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ t: 'table', head, align, rows });
      continue;
    }

    if (LIST.test(line)) {
      const items = [];
      const ordered = /^\s*\d/.test(line);
      while (i < lines.length && (LIST.test(lines[i]) || (lines[i].startsWith('  ') && lines[i].trim() && items.length))) {
        const m = lines[i].match(LIST);
        if (m) items.push({ depth: m[1].length >= 2 ? 1 : 0, text: m[3] });
        else items[items.length - 1].text += ` ${lines[i].trim()}`;
        i++;
      }
      blocks.push({ t: 'list', ordered, items });
      continue;
    }

    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])
      && !lines[i].trim().startsWith('```') && !isTableRow(lines[i])) para.push(lines[i++]);
    blocks.push({ t: 'p', text: para.join('\n') });
  }
  return blocks;
}

// Right-aligned columns hold figures, so they take the ledger face.
const figureLike = (s) => /^[\s+−\-–₹$€£]*[\d,.]+\s*(%|pp|L|Cr|K|x)?$/.test(String(s).replace(/\*\*/g, ''));

export default function Markdown({ text }) {
  return (
    <div className="md">
      {parse(text).map((b, k) => {
        if (b.t === 'h') return <p key={k} className={b.level <= 2 ? 'md-h2' : 'md-h3'}>{inline(b.text, `h${k}`)}</p>;
        if (b.t === 'hr') return <hr key={k} className="md-hr" />;
        if (b.t === 'code') return <pre key={k} className="md-pre"><code>{b.body}</code></pre>;
        if (b.t === 'p') return <p key={k}>{b.text.split('\n').map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `p${k}-${j}`)}</Fragment>)}</p>;
        if (b.t === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag key={k} className={b.ordered ? 'md-ol' : 'md-ul'}>
              {b.items.map((it, j) => <li key={j} style={it.depth ? { marginLeft: 18 } : undefined}>{inline(it.text, `l${k}-${j}`)}</li>)}
            </Tag>
          );
        }
        const numeric = b.head.map((_, j) => b.rows.length > 0 && b.rows.filter(r => figureLike(r[j] ?? '')).length * 2 >= b.rows.length);
        return (
          <div key={k} className="md-table-wrap">
            <table className="md-table">
              <thead><tr>{b.head.map((c, j) => <th key={j} style={{ textAlign: numeric[j] ? 'right' : b.align[j] }}>{inline(c, `th${k}-${j}`)}</th>)}</tr></thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>
                    {b.head.map((_, j) => (
                      <td key={j} className={numeric[j] ? 'figure' : undefined} style={{ textAlign: numeric[j] ? 'right' : b.align[j] }}>
                        {inline(r[j] ?? '', `td${k}-${ri}-${j}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
