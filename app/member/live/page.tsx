'use client';
// ALGORIA DESK (09/09/2026, décision Mathieu) — le bouton central n'ouvre plus « juste un graphique » mais le
// desk d'analystes. Retour Mathieu du 10/09 : « c'est une encyclopédie, personne ne va lire ça ». Donc trois
// étages, du plus simple au plus fouillé :
//   THE BRIEF  — le graphique, la note, et le desk en langage courant (un titre, trois phrases, ce que la note
//                veut dire, deux prix, ce qui ferait changer d'avis). C'est ce que tout le monde voit en arrivant.
//   DEEP DIVE  — chaque voix du desk (analystes, débat, trader, risque, gérant), repliée, une ligne de résumé
//                par voix ; on ouvre seulement ce qu'on veut lire.
//   CALLS      — ce que le desk a dit les jours précédents et ce que le prix a fait ensuite, bon ou mauvais.
// Le desk est de la MATIÈRE À LIRE, pas une promesse : aucun chiffre de performance ici.
// Ouvert à tout compte connecté (c'est l'accroche du produit).
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Chart } from '@/components/Chart';
import { DeskMarkdown } from '@/components/DeskMarkdown';
import { usePrice } from '@/lib/cockpit/useRealtime';
import { useMe, LoadFailed } from '../ui';

const SYMS = [
  { key: 'XAUUSD', short: 'GOLD', dp: 2 },
  { key: 'BTCUSD', short: 'BTC', dp: 1 },
];

interface Brief {
  headline?: string; story?: string[]; call?: string;
  levels?: { floor?: number | null; ceiling?: number | null };
  flip?: { up?: string; down?: string };
  voices?: Record<string, string>;
}
interface Run { id: string; market: string; run_date: string; rating: string; price: number | null; summary: string | null; decision_md: string | null; brief: Brief | null; duration_s: number | null; agents: string[]; price_1d: number | null; price_3d: number | null; price_7d: number | null; created_at: string }
interface Report { agent: string; team: string; content_md: string }
interface HistoryRow { run_date: string; rating: string; price: number | null; price_1d: number | null; price_3d: number | null; price_7d: number | null }

// la note sur cinq niveaux → mot, couleur, glyphe. REVIEW = le gérant n'a pas rendu de note lisible (rare) : on le dit.
const RATING: Record<string, { word: string; color: string; glyph: string; hint: string }> = {
  Buy: { word: 'BUY', color: 'var(--up)', glyph: '▲▲', hint: 'The desk leans clearly long.' },
  Overweight: { word: 'OVERWEIGHT', color: 'var(--up)', glyph: '▲', hint: 'The desk leans long, with reservations.' },
  Hold: { word: 'HOLD', color: 'var(--gold)', glyph: '◆', hint: 'No edge either way today. Wait.' },
  Underweight: { word: 'UNDERWEIGHT', color: 'var(--down)', glyph: '▼', hint: 'The desk leans short, with reservations.' },
  Sell: { word: 'SELL', color: 'var(--down)', glyph: '▼▼', hint: 'The desk leans clearly short.' },
  REVIEW: { word: 'NO CALL', color: 'var(--dim)', glyph: '?', hint: 'The manager did not reach a readable decision today.' },
};
const rating = (r: string | undefined) => RATING[r ?? ''] ?? RATING.REVIEW;

type TabKey = 'brief' | 'deep' | 'calls';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'brief', label: 'THE BRIEF' }, { key: 'deep', label: 'DEEP DIVE' }, { key: 'calls', label: 'CALLS' },
];
const AGENT_LABEL: Record<string, string> = {
  market: 'Technical analyst', news: 'News & macro analyst', sentiment: 'Sentiment analyst', fundamentals: 'Fundamentals analyst',
  bull: 'The bull case', bear: 'The bear case', research_manager: 'Research manager', trader: 'The trader',
  risk_aggressive: 'Risk — aggressive', risk_conservative: 'Risk — conservative', risk_neutral: 'Risk — neutral', portfolio_manager: 'Portfolio manager',
};
// le plongeon, dans l'ordre où le desk travaille : le verdict d'abord (c'est ce qu'on cherche), puis les voix
const GROUPS: Array<{ title: string; agents: string[] }> = [
  { title: 'THE VERDICT', agents: ['portfolio_manager'] },
  { title: 'THE ANALYSTS', agents: ['market', 'news', 'fundamentals', 'sentiment'] },
  { title: 'THE DEBATE', agents: ['bull', 'bear', 'research_manager'] },
  { title: 'THE TRADER', agents: ['trader'] },
  { title: 'THE RISK TEAM', agents: ['risk_aggressive', 'risk_conservative', 'risk_neutral'] },
];

/** Le paragraphe « Executive Summary » du verdict, sinon le premier paragraphe qui n'est pas la ligne de note. */
function executiveSummary(decision: string | null | undefined): string {
  if (!decision) return '';
  const m = /\*\*Executive Summary\*\*:?\s*([\s\S]*?)(?:\n\s*\n|$)/i.exec(decision);
  if (m) return m[1].trim();
  const paras = decision.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^\*\*Rating\*\*/i.test(p));
  return paras[0] ?? '';
}
/** La première ligne « **Action**: X » ou « **Recommendation**: X » d'un rapport. */
function firstField(text: string | undefined, field: string): string | null {
  if (!text) return null;
  const m = new RegExp(`\\*\\*${field}\\*\\*:?\\s*([^\\n]+)`, 'i').exec(text);
  return m ? m[1].trim() : null;
}
/** Une ligne de résumé pour une voix sans brief : le champ Action/Recommendation, sinon la première phrase. */
function fallbackTakeaway(text: string | undefined): string {
  const f = firstField(text, 'Recommendation') ?? firstField(text, 'Action');
  if (f) return f.replace(/\*/g, '').slice(0, 110);
  const line = (text ?? '').split('\n').map((l) => l.replace(/^[#>*\-\s|]+/, '').replace(/\*\*/g, '').trim()).find((l) => l.length > 30) ?? '';
  return line.length > 110 ? line.slice(0, 107).trimEnd() + '…' : line;
}
const words = (t: string | undefined) => (t ? t.trim().split(/\s+/).length : 0);
const pct = (from: number | null, to: number | null) => (from && to ? `${to >= from ? '+' : ''}${(((to - from) / from) * 100).toFixed(2)}%` : '—');
const fmtLevel = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));

function PriceChip({ sym, short, dp, active, onClick }: { sym: string; short: string; dp: number; active: boolean; onClick: () => void }) {
  const px = usePrice(sym);
  return (
    <button onClick={onClick} className="mono" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '8px 6px', borderRadius: 11, cursor: 'pointer', border: `1px solid ${active ? 'rgba(43,227,245,.5)' : 'var(--border)'}`, background: active ? 'rgba(43,227,245,.07)' : 'rgba(10,17,31,.55)', boxShadow: active ? '0 0 16px rgba(43,227,245,.1)' : undefined }}>
      <span style={{ fontSize: 10, letterSpacing: 1.2, color: active ? 'var(--cyan)' : 'var(--dim)', fontWeight: 700 }}>{short}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: px ? (px.dir >= 0 ? 'var(--up)' : 'var(--down)') : 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
        {px ? px.mid.toFixed(dp) : '—'}
      </span>
    </button>
  );
}

const LABEL: CSSProperties = { fontSize: 9.5, letterSpacing: 1.6, color: 'var(--dim)', fontWeight: 800 };
const P: CSSProperties = { margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--muted)' };
const BODY: CSSProperties = { margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--text)' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel" style={{ padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={LABEL}>{title.toUpperCase()}</span>
      {children}
    </section>
  );
}

/** Une voix du desk, repliée : le nom, une ligne de résumé, la longueur ; on ouvre pour lire. */
function Voice({ label, takeaway, text }: { label: string; takeaway: string; text: string }) {
  const [open, setOpen] = useState(false);
  const n = words(text);
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', color: 'inherit', font: 'inherit' }}>
        <span className="mono" style={{ fontSize: 14, lineHeight: 1, color: 'var(--cyan)', marginTop: 2, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-block' }}>›</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{label}</span>
            <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', flex: '0 0 auto' }}>{n >= 100 ? `~${Math.round(n / 100) * 100} WORDS` : `${n} WORDS`}</span>
          </span>
          {takeaway && <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--muted)' }}>{takeaway}</span>}
        </span>
      </button>
      {open && <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}><DeskMarkdown text={text} /></div>}
    </div>
  );
}

export default function MemberDesk() {
  const { member, loading } = useMe();
  const [hero, setHero] = useState('XAUUSD');
  const [tab, setTab] = useState<TabKey>('brief');
  const [data, setData] = useState<{ run: Run | null; reports: Report[]; history: HistoryRow[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setFailed(false);
    void fetch(`/api/member/desk?market=${hero}`).then(async (r) => {
      if (!alive) return;
      if (!r.ok) { setFailed(true); return; }
      setData((await r.json()) as { run: Run | null; reports: Report[]; history: HistoryRow[] });
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [hero]);

  const byAgent = useMemo(() => Object.fromEntries((data?.reports ?? []).map((r) => [r.agent, r.content_md])) as Record<string, string>, [data]);
  const run = data?.run ?? null;
  const brief: Brief = run?.brief && typeof run.brief === 'object' ? run.brief : {};
  const story = (brief.story ?? []).filter((s) => typeof s === 'string' && s.trim());
  const rt = rating(run?.rating);
  const dateLabel = run ? new Date(run.run_date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const floor = fmtLevel(brief.levels?.floor);
  const ceiling = fmtLevel(brief.levels?.ceiling);
  const loadState = failed ? 'The desk could not be loaded. Pull to refresh.' : !data ? 'loading the desk…' : null;

  if (loading) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;
  if (!member) return <LoadFailed />;

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {SYMS.map((s) => <PriceChip key={s.key} sym={s.key} short={s.short} dp={s.dp} active={hero === s.key} onClick={() => { setHero(s.key); setTab('brief'); }} />)}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className="mono"
            style={{ flex: 1, padding: '8px 6px', borderRadius: 999, fontSize: 9.5, letterSpacing: 1.2, fontWeight: 800, cursor: 'pointer', border: `1px solid ${tab === t.key ? 'rgba(43,227,245,.55)' : 'var(--border)'}`, background: tab === t.key ? 'rgba(43,227,245,.1)' : 'rgba(10,17,31,.55)', color: tab === t.key ? 'var(--cyan)' : 'var(--dim)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'brief' && (
        <>
          {/* LE GRAPHIQUE D'ABORD — compact, en H1 : le contexte en un coup d'œil, pas un poste de trading */}
          <section style={{ position: 'relative', height: 'min(38vh, 250px)', minHeight: 190, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(43,227,245,.3)', background: '#070f1d' }}>
            <Chart key={hero} symbol={hero} signals={[]} wins={[]} defaultTf="H1" broadcast />
          </section>
          {(floor || ceiling) && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Level label="FLOOR THE DESK WATCHES" value={floor} color="var(--up)" />
              <Level label="CEILING THE DESK WATCHES" value={ceiling} color="var(--down)" />
            </div>
          )}

          {loadState && <p style={P}>{loadState}</p>}
          {data && !run && (
            <Section title="Algoria Desk">
              <p style={P}>No analysis published yet for this market. The desk publishes every morning at 06:00 UTC, before London opens.</p>
            </Section>
          )}

          {run && (
            <section className="panel" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid rgba(43,227,245,.3)', background: 'linear-gradient(180deg,rgba(18,33,62,.6),rgba(10,20,37,.6))' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="mono" style={LABEL}>ALGORIA DESK · {dateLabel.toUpperCase()}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{(run.agents ?? []).length} VOICES</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: rt.color, letterSpacing: 1 }}>{rt.glyph} {rt.word}</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4, fontWeight: 800, color: 'var(--text)' }}>{brief.headline || rt.hint}</p>
              </div>

              {story.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span className="mono" style={LABEL}>WHAT&rsquo;S GOING ON</span>
                  {story.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10 }}>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 800, marginTop: 3 }}>{i + 1}</span>
                      <p style={BODY}>{s}</p>
                    </div>
                  ))}
                </div>
              ) : (
                executiveSummary(run.decision_md) ? <p style={BODY}>{executiveSummary(run.decision_md)}</p> : null
              )}

              {brief.call && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '10px 12px', borderRadius: 10, background: 'rgba(43,227,245,.06)', border: '1px solid rgba(43,227,245,.18)' }}>
                  <span className="mono" style={LABEL}>WHAT THE DESK DOES WITH IT</span>
                  <p style={BODY}>{brief.call}</p>
                </div>
              )}

              {(brief.flip?.up || brief.flip?.down) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="mono" style={LABEL}>WHAT WOULD CHANGE ITS MIND</span>
                  {brief.flip?.up && <Flip glyph="▲" color="var(--up)" text={brief.flip.up} />}
                  {brief.flip?.down && <Flip glyph="▼" color="var(--down)" text={brief.flip.down} />}
                </div>
              )}

              <button onClick={() => setTab('deep')} className="mono" style={{ alignSelf: 'flex-start', padding: '8px 12px', borderRadius: 999, fontSize: 9.5, letterSpacing: 1.2, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)', color: 'var(--cyan)' }}>
                READ THE FULL REASONING ›
              </button>
              <p className="mono" style={{ margin: 0, fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5 }}>
                READING MATERIAL, NOT A PROMISE · PAST CALLS UNDER “CALLS”, RIGHT OR WRONG
              </p>
            </section>
          )}
        </>
      )}

      {tab === 'deep' && (
        <>
          {loadState && <p style={P}>{loadState}</p>}
          {data && !run && <Section title="Deep dive"><p style={P}>Nothing to read yet for this market.</p></Section>}
          {run && (
            <>
              <p style={{ ...P, padding: '0 2px' }}>Everything the desk wrote today, voice by voice. Open only what you want to read.</p>
              {GROUPS.map((g) => {
                const present = g.agents.filter((a) => byAgent[a]);
                if (!present.length) return null;
                return (
                  <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="mono" style={{ ...LABEL, padding: '4px 2px 0' }}>{g.title}</span>
                    {present.map((a) => (
                      <Voice key={a} label={AGENT_LABEL[a] ?? a} takeaway={brief.voices?.[a] || fallbackTakeaway(byAgent[a])} text={byAgent[a]} />
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {tab === 'calls' && loadState && <p style={P}>{loadState}</p>}
      {tab === 'calls' && data && (
        <Section title="The desk’s calls · what the price did next">
          <p style={{ margin: '0 0 6px', fontSize: 11.5, lineHeight: 1.55, color: 'var(--muted)' }}>
            Every morning call, then the reference price 1, 3 and 7 days later. Filled in as the days pass. Shown as is, right or wrong — that is the point.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="mono" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.3fr 1fr 1fr 1fr', gap: 6, fontSize: 9, letterSpacing: 1, color: 'var(--dim)', fontWeight: 800, padding: '0 4px' }}>
              <span>DATE</span><span>CALL</span><span>+1D</span><span>+3D</span><span>+7D</span>
            </div>
            {data.history.map((h) => {
              const r = rating(h.rating);
              return (
                <div key={h.run_date} className="mono" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.3fr 1fr 1fr 1fr', gap: 6, fontSize: 11, padding: '7px 4px', borderBottom: '1px solid rgba(130,152,190,.12)', alignItems: 'center' }}>
                  <span style={{ color: 'var(--muted)' }}>{new Date(h.run_date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                  <span style={{ color: r.color, fontWeight: 800 }}>{r.glyph} {r.word}</span>
                  <span style={{ color: 'var(--dim)' }}>{pct(h.price, h.price_1d)}</span>
                  <span style={{ color: 'var(--dim)' }}>{pct(h.price, h.price_3d)}</span>
                  <span style={{ color: 'var(--dim)' }}>{pct(h.price, h.price_7d)}</span>
                </div>
              );
            })}
            {data.history.length === 0 && <p style={P}>No calls yet.</p>}
          </div>
          <p className="mono" style={{ margin: '6px 0 0', fontSize: 9.5, color: 'var(--dim)' }}>TRACK RECORD STARTS 9 SEP 2026</p>
        </Section>
      )}
    </main>
  );
}

function Level({ label, value, color }: { label: string; value: string | null; color: string }) {
  return (
    <div className="panel" style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="mono" style={{ fontSize: 8.5, letterSpacing: 1.2, color: 'var(--dim)', fontWeight: 800 }}>{label}</span>
      <span className="mono" style={{ fontSize: 15, fontWeight: 800, color: value ? color : 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{value ?? '—'}</span>
    </div>
  );
}
function Flip({ glyph, color, text }: { glyph: string; color: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span className="mono" style={{ fontSize: 12, color, fontWeight: 800, marginTop: 2 }}>{glyph}</span>
      <p style={{ ...BODY, fontSize: 12.5, color: 'var(--muted)' }}>{text}</p>
    </div>
  );
}
