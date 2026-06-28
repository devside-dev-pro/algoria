'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Chart } from '@/components/Chart';
import { Desk } from '@/components/Desk';
import { Telemetry } from '@/components/Telemetry';
import { useSignals, useLatestState, sendCommand, usePrice } from '@/lib/cockpit/useRealtime';

const fmt = (n: unknown, d = 2) => (n == null ? '—' : Number(n).toFixed(d));
const pct = (n: unknown, d = 1) => (n == null ? '—' : (Number(n) * 100).toFixed(d) + '%');

export function Cockpit() {
  const signals = useSignals(8);
  const st = useLatestState() as any;
  // feedback optimiste : on reflète le clic tout de suite (sinon il faut attendre la prochaine clôture de bougie)
  const [optMode, setOptMode] = useState<string | null>(null);
  const [optKilled, setOptKilled] = useState<boolean | null>(null);
  const activeMode = optMode ?? (st?.mode as string | undefined) ?? 'normal';
  const killed = optKilled ?? !!st?.killed;

  return (
    <main style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100vh' }}>
      <header className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="glow" style={{ width: 22, height: 22, background: 'linear-gradient(135deg,#2be3f5,#1e40e5)', clipPath: 'polygon(50% 8%,92% 92%,8% 92%)' }} />
          <strong style={{ fontSize: 16, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA&nbsp;AI</strong>
          <PriceTicker />
          <MarketStatus session={st?.session as string | undefined} regime={st?.regime as string | undefined} tradable={!!st?.tradable} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['soft', 'normal', 'turbo'] as const).map((m) => (
            <button key={m} onClick={() => { setOptMode(m); void sendCommand('set_mode', { mode: m }); }} style={pill(activeMode === m)} title={`mode ${m}`}>
              {m}
            </button>
          ))}
          <button
            onClick={() => { const next = !killed; setOptKilled(next); void sendCommand(next ? 'kill' : 'resume'); }}
            style={{ ...pill(killed), color: killed ? '#ff8aa2' : 'var(--muted)', borderColor: 'rgba(255,107,138,.45)', background: killed ? 'rgba(255,107,138,.15)' : 'transparent' }}
            title={killed ? 'reprendre le trading' : 'kill switch — coupe toute nouvelle position'}
          >
            {killed ? '● KILLED' : 'kill'}
          </button>
          <button onClick={() => supabase.auth.signOut()} style={pill(false)} title="sign out">⎋</button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr', gap: 12 }}>
        <section className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 13, marginBottom: 6, color: 'var(--muted)' }}>XAU/USD</div>
          <div style={{ height: 540 }}>
            <Chart signals={signals} />
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateRows: '1fr 1.6fr', gap: 12, height: 540, minHeight: 0 }}>
          <Desk />
          <Telemetry state={st} signals={signals} />
        </div>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        {signals.length === 0 && <div className="panel" style={{ padding: 12, color: 'var(--dim)' }}>no signal yet</div>}
        {signals.map((s: any) => {
          const long = s.direction === 'long';
          return (
            <div key={s.id} className="panel" style={{ padding: 12, borderColor: long ? 'rgba(34,224,166,.3)' : 'rgba(255,107,138,.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>{s.symbol}</strong>
                <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 6, background: long ? 'rgba(34,224,166,.15)' : 'rgba(255,107,138,.15)', color: long ? 'var(--up)' : 'var(--down)' }}>
                  {String(s.direction).toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>entry {fmt(s.entry)}</span>
                <span>SL {fmt(s.stop_loss)}</span>
                <span>TP {fmt(s.take_profits?.[0])}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8 }}>conf {pct(s.confidence)} · R:R {fmt(s.risk_reward)} · {fmt(s.lot)} lot</div>
              {Array.isArray(s.rationale) && s.rationale.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ fontSize: 9.5, color: 'var(--cyan)', letterSpacing: 0.5, opacity: 0.85 }}>WHY THIS TRADE</div>
                  {(s.rationale as string[]).slice(0, 3).map((r: string, i: number) => (
                    <div key={i} style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.35 }}>◢ {r}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
        <Metric label="Balance" value={st ? fmt(st.balance, 0) : '—'} accent="var(--cyan)" />
        <Metric label="Equity" value={st ? fmt(st.equity, 0) : '—'} accent="var(--blue)" />
        <Metric label="Day P&L" value={st ? fmt(st.day_pnl, 0) : '—'} color={st && st.day_pnl >= 0 ? 'var(--up)' : 'var(--down)'} accent={st && st.day_pnl >= 0 ? 'var(--up)' : 'var(--down)'} />
        <Metric label="Positions" value={st ? String(st.open_positions ?? 0) : '—'} accent="var(--muted)" />
        <Metric label="Risk exposure" value={st ? pct(st.open_risk_pct) : '—'} accent="var(--gold)" />
        <Metric label="Kill switch" value={killed ? 'ON' : 'off'} color={killed ? 'var(--down)' : 'var(--dim)'} accent={killed ? 'var(--down)' : 'var(--dim)'} />
      </section>
    </main>
  );
}

function Metric({ label, value, color, accent }: { label: string; value: string; color?: string; accent?: string }) {
  return (
    <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '9px 12px', borderLeft: `2px solid ${accent ?? 'var(--border)'}` }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  );
}

function PriceTicker() {
  const px = usePrice();
  if (!px) return <span className="mono" style={{ color: 'var(--dim)', fontSize: 13 }}>XAU/USD —</span>;
  const col = px.dir > 0 ? 'var(--up)' : px.dir < 0 ? 'var(--down)' : 'var(--text)';
  const arrow = px.dir > 0 ? '▲' : px.dir < 0 ? '▼' : '·';
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
      <span style={{ color: 'var(--muted)', fontSize: 11.5, letterSpacing: 0.5 }}>XAU/USD</span>
      <span className="mono" style={{ fontSize: 22, fontWeight: 600, color: col, lineHeight: 1 }}>{px.mid.toFixed(2)}</span>
      <span className="mono" style={{ fontSize: 12, color: col }}>{arrow}</span>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>spr {(px.ask - px.bid).toFixed(2)}</span>
    </span>
  );
}

/** ms jusqu'à la réouverture du gold (≈ dimanche 22:00 UTC), ou null si le marché est ouvert. */
function goldReopenMs(): number | null {
  const now = new Date();
  const day = now.getUTCDay();
  const h = now.getUTCHours();
  const inGap = (day === 5 && h >= 21) || day === 6 || (day === 0 && h < 22);
  if (!inGap) return null;
  const reopen = new Date(now);
  if (day === 0) reopen.setUTCHours(22, 0, 0, 0);
  else {
    reopen.setUTCDate(now.getUTCDate() + (7 - day));
    reopen.setUTCHours(22, 0, 0, 0);
  }
  return Math.max(0, reopen.getTime() - now.getTime());
}

function MarketStatus({ session, regime, tradable }: { session?: string; regime?: string; tradable: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((x) => x + 1), 20000);
    return () => clearInterval(i);
  }, []);
  const reopen = goldReopenMs();
  if (reopen != null) {
    const hh = Math.floor(reopen / 3_600_000);
    const mm = Math.floor((reopen % 3_600_000) / 60_000);
    return (
      <span style={{ fontSize: 12, color: 'var(--gold)' }}>⏸ market closed · reopens in {hh}h{String(mm).padStart(2, '0')}</span>
    );
  }
  return (
    <span style={{ fontSize: 12.5, color: tradable ? 'var(--up)' : 'var(--dim)' }}>
      {session ?? '—'} · {regime ?? '—'}
    </span>
  );
}

function pill(active: boolean): CSSProperties {
  return {
    fontSize: 11,
    padding: '3px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    background: active ? 'rgba(46,139,240,.2)' : 'transparent',
    color: active ? '#7fc4ff' : 'var(--muted)',
    border: `1px solid ${active ? 'rgba(43,227,245,.4)' : 'rgba(130,152,190,.25)'}`,
  };
}
