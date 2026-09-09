'use client';
// RENDU MARKDOWN MINIMAL des rapports du desk (09/09/2026). Pas de dépendance : les rapports viennent de nos
// propres agents (titres, gras, listes, tableaux, filets), jamais de HTML, et un rendu sans innerHTML ne peut
// rien injecter. Ce qui n'est pas reconnu s'affiche en paragraphe simple.
import type { CSSProperties, ReactNode } from 'react';

const H: Record<number, CSSProperties> = {
  1: { fontSize: 15, fontWeight: 800, margin: '14px 0 6px', color: 'var(--text)' },
  2: { fontSize: 14, fontWeight: 800, margin: '14px 0 6px', color: 'var(--text)' },
  3: { fontSize: 12.5, fontWeight: 800, margin: '12px 0 4px', color: 'var(--cyan)', letterSpacing: 0.3 },
  4: { fontSize: 12, fontWeight: 800, margin: '10px 0 4px', color: 'var(--muted)' },
};
const P: CSSProperties = { margin: '0 0 8px', fontSize: 12.5, lineHeight: 1.6, color: 'var(--muted)' };

/** Gras / italique / code en ligne → spans. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<b key={k++} style={{ color: 'var(--text)' }}>{t.slice(2, -2)}</b>);
    else if (t.startsWith('`')) out.push(<code key={k++} className="mono" style={{ fontSize: 11.5 }}>{t.slice(1, -1)}</code>);
    else out.push(<i key={k++}>{t.slice(1, -1)}</i>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function DeskMarkdown({ text }: { text: string }) {
  // les débats commencent par « Bull Analyst: » / « Bear Analyst: » — on garde, c'est la voix de l'agent
  const lines = text.replace(/\r/g, '').split('\n');
  const nodes: ReactNode[] = [];
  let i = 0; let k = 0;
  const flushPara = (buf: string[]) => { if (buf.length) nodes.push(<p key={k++} style={P}>{inline(buf.join(' '))}</p>); };
  let para: string[] = [];
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { flushPara(para); para = []; i++; continue; }
    if (/^-{3,}$|^\*{3,}$/.test(line)) { flushPara(para); para = []; nodes.push(<hr key={k++} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '10px 0' }} />); i++; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushPara(para); para = []; const lvl = Math.min(4, h[1].length); nodes.push(<div key={k++} style={H[lvl]}>{inline(h[2].replace(/\*\*/g, ''))}</div>); i++; continue; }
    if (/^\|/.test(line)) {
      flushPara(para); para = [];
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      nodes.push(
        <div key={k++} style={{ overflowX: 'auto', margin: '6px 0 10px' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: '100%' }}>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', color: ri === 0 ? 'var(--text)' : 'var(--muted)', fontWeight: ri === 0 ? 800 : 500, whiteSpace: 'nowrap' }}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const li = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara(para); para = [];
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        items.push(m[2]); i++;
      }
      nodes.push(<ul key={k++} style={{ margin: '0 0 8px', paddingLeft: 18 }}>{items.map((it, j) => <li key={j} style={{ ...P, margin: '0 0 4px' }}>{inline(it)}</li>)}</ul>);
      continue;
    }
    para.push(line); i++;
  }
  flushPara(para);
  return <div>{nodes}</div>;
}
