'use client';
// ALGORIA DESK (09/09/2026, décision Mathieu) — le bouton central n'ouvre plus « juste un graphique » mais le
// desk d'analystes : la note du jour, le verdict du gérant, puis chaque voix (technique, macro et news,
// sentiment, le débat haussier contre baissier, les trois profils de risque), le graphique en onglet, et
// « les appels du desk » — ce qu'il a dit les jours précédents et ce que le prix a fait ensuite.
// Le desk est de la MATIÈRE À LIRE, pas une promesse : aucun chiffre de performance ici, et le suivi des appels
// est affiché tel quel, bon ou mauvais. Ouvert à tout compte connecté (c'est l'accroche du produit).
import { useEffect, useMemo, useState } from 'react';
import { Chart } from '@/components/Chart';
import { DeskMarkdown } from '@/components/DeskMarkdown';
import { usePrice } from '@/lib/cockpit/useRealtime';
import { useMe, LoadFailed } from '../ui';

const SYMS = [
  { key: 'XAUUSD', short: 'GOLD', dp: 2 },
  { key: 'BTCUSD', short: 'BTC', dp: 1 },
];

interface Run { id: string; market: string; run_date: string; rating: string; price: number | null; summary: string | null; decision_md: string | null; duration_s: number | null; agents: string[]; price_1d: number | null; price_3d: number | null; price_7d: number | null; created_at: string }
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

type TabKey = 'desk' | 'technical' | 'macro' | 'sentiment' | 'debate' | 'risk' | 'chart' | 'calls';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'desk', label: 'DESK' }, { key: 'technical', label: 'TECHNICAL' }, { key: 'macro', label: 'MACRO' }, { key: 'sentiment', label: 'SENTIMENT' },
  { key: 'debate', label: 'BULL vs BEAR' }, { key: 'risk', label: 'RISK' }, { key: 'chart', label: 'CHART' }, { key: 'calls', label: 'CALLS' },
];
const AGENT_LABEL: Record<string, string> = {
  market: 'Technical analyst', news: 'News & macro analyst', sentiment: 'Sentiment analyst', fundamentals: 'Fundamentals analyst',
  bull: 'Bull researcher', bear: 'Bear researcher', research_manager: 'Research manager', trader: 'Trader',
  risk_aggressive: 'Aggressive risk analyst', risk_conservative: 'Conservative risk analyst', risk_neutral: 'Neutral risk analyst', portfolio_manager: 'Portfolio manager',
};

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
const pct = (from: number | null, to: number | null) => (from && to ? `${to >= from ? '+' : ''}${(((to - from) / from) * 100).toFixed(2)}%` : '—');

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel" style={{ padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--dim)', fontWeight: 800 }}>{title.toUpperCase()}</span>
      {children}
    </section>
  );
}

export default function MemberDesk() {
  const { member, loading } = useMe();
  const [hero, setHero] = useState('XAUUSD');
  const [tab, setTab] = useState<TabKey>('desk');
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
  const rt = rating(run?.rating);
  const dateLabel = run ? new Date(run.run_date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';

  if (loading) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;
  if (!member) return <LoadFailed />;

  const report = (agent: string, title?: string) => byAgent[agent]
    ? <Section key={agent} title={title ?? AGENT_LABEL[agent] ?? agent}><DeskMarkdown text={byAgent[agent]} /></Section>
    : null;

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {SYMS.map((s) => <PriceChip key={s.key} sym={s.key} short={s.short} dp={s.dp} active={hero === s.key} onClick={() => { setHero(s.key); setTab('desk'); }} />)}
      </div>

      {/* onglets — une ligne défilante, le desk en premier */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className="mono"
            style={{ flex: '0 0 auto', padding: '7px 11px', borderRadius: 999, fontSize: 9.5, letterSpacing: 1.2, fontWeight: 800, cursor: 'pointer', border: `1px solid ${tab === t.key ? 'rgba(43,227,245,.55)' : 'var(--border)'}`, background: tab === t.key ? 'rgba(43,227,245,.1)' : 'rgba(10,17,31,.55)', color: tab === t.key ? 'var(--cyan)' : 'var(--dim)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'chart' && (
        <section style={{ position: 'relative', height: 'min(60vh, 420px)', minHeight: 250, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(43,227,245,.3)', background: '#070f1d' }}>
          <Chart key={hero} symbol={hero} signals={[]} wins={[]} defaultTf="M5" broadcast />
        </section>
      )}

      {tab !== 'chart' && failed && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)' }}>The desk could not be loaded. Pull to refresh.</p>}
      {tab !== 'chart' && !failed && !data && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--dim)' }}>loading the desk…</p>}

      {tab !== 'chart' && data && !run && (
        <Section title="Algoria Desk">
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--muted)' }}>
            No analysis published yet for this market. The desk publishes every morning at 06:00 UTC, before London opens.
          </p>
        </Section>
      )}

      {tab === 'desk' && run && (
        <>
          {/* LA CARTE DE TÊTE : la note, la date, le prix de référence, le résumé du gérant */}
          <section className="panel" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid rgba(43,227,245,.3)', background: 'linear-gradient(180deg,rgba(18,33,62,.6),rgba(10,20,37,.6))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--dim)', fontWeight: 800 }}>ALGORIA DESK · {dateLabel.toUpperCase()}</span>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{run.duration_s ? `${Math.round(run.duration_s / 60)} min of work` : ''}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 26, fontWeight: 900, color: rt.color, letterSpacing: 1 }}>{rt.glyph} {rt.word}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>{run.price != null ? `ref ${Number(run.price).toFixed(hero === 'BTCUSD' ? 0 : 2)}` : ''}</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{rt.hint}</p>
            {executiveSummary(run.decision_md) && (
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>{executiveSummary(run.decision_md)}</p>
            )}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {firstField(byAgent.research_manager, 'Recommendation') && <Stat label="RESEARCH" value={firstField(byAgent.research_manager, 'Recommendation')!} />}
              {firstField(byAgent.trader, 'Action') && <Stat label="TRADER" value={firstField(byAgent.trader, 'Action')!} />}
              <Stat label="VOICES" value={String((run.agents ?? []).length)} />
            </div>
            <p className="mono" style={{ margin: 0, fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5 }}>
              READING MATERIAL, NOT A PROMISE · THE DESK&rsquo;S PAST CALLS ARE UNDER “CALLS”, RIGHT OR WRONG
            </p>
          </section>
          {report('portfolio_manager', 'The manager’s verdict, in full')}
          {report('trader', 'The trader’s plan')}
        </>
      )}

      {tab === 'technical' && run && (report('market') ?? <Section title="Technical"><p style={P}>No technical report today.</p></Section>)}
      {tab === 'macro' && run && (<>{report('news', 'News & macro')}{report('fundamentals')}{!byAgent.news && !byAgent.fundamentals && <Section title="Macro"><p style={P}>No macro report today.</p></Section>}</>)}
      {tab === 'sentiment' && run && (report('sentiment') ?? <Section title="Sentiment"><p style={P}>No sentiment report today.</p></Section>)}
      {tab === 'debate' && run && (<>{report('bull', '▲ The bull case')}{report('bear', '▼ The bear case')}{report('research_manager', 'The research manager settles it')}</>)}
      {tab === 'risk' && run && (<>{report('risk_aggressive', 'Aggressive')}{report('risk_conservative', 'Conservative')}{report('risk_neutral', 'Neutral')}</>)}

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

const P: React.CSSProperties = { margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--muted)' };
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="mono" style={{ fontSize: 8.5, letterSpacing: 1.2, color: 'var(--dim)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}
