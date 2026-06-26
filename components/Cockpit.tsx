'use client';
import type { CSSProperties } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Chart } from '@/components/Chart';
import { useEvents, useSignals, useLatestState, sendCommand } from '@/lib/cockpit/useRealtime';

const fmt = (n: unknown, d = 2) => (n == null ? '—' : Number(n).toFixed(d));
const pct = (n: unknown, d = 1) => (n == null ? '—' : (Number(n) * 100).toFixed(d) + '%');

const LEVEL_COLOR: Record<string, string> = {
  scan: '#4fb8ff',
  info: '#8298be',
  signal: '#22e0a6',
  order: '#2be3f5',
  veto: '#ff6b8a',
};

export function Cockpit() {
  const events = useEvents(120);
  const signals = useSignals(8);
  const st = useLatestState() as any;

  return (
    <main style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100vh' }}>
      <header className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="glow" style={{ width: 22, height: 22, background: 'linear-gradient(135deg,#2be3f5,#1e40e5)', clipPath: 'polygon(50% 8%,92% 92%,8% 92%)' }} />
          <strong style={{ fontSize: 16, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA&nbsp;AI</strong>
          <span style={{ color: 'var(--muted)' }}>XAU/USD</span>
          <span style={{ color: st?.tradable ? 'var(--up)' : 'var(--dim)' }}>{st?.session ?? '—'} · {st?.regime ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['soft', 'normal', 'turbo'] as const).map((m) => (
            <button key={m} onClick={() => sendCommand('set_mode', { mode: m })} style={pill(st?.mode === m)}>
              {m}
            </button>
          ))}
          <button onClick={() => sendCommand('kill')} style={{ ...pill(false), color: '#ff8aa2', borderColor: 'rgba(255,107,138,.45)' }}>kill</button>
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

        <section className="panel mono" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', color: 'var(--cyan)', fontSize: 12 }}>ALGORIA AI · engine.log</div>
          <div style={{ padding: '8px 12px', fontSize: 11.5, lineHeight: 1.8, height: 520, overflowY: 'auto' }}>
            {events.length === 0 && <span style={{ color: 'var(--dim)' }}>waiting for the runner…</span>}
            {events.map((e: any, i: number) => (
              <div key={i}>
                <span style={{ color: 'var(--dim)' }}>{new Date(e.ts).toLocaleTimeString()}</span>{' '}
                <span style={{ color: LEVEL_COLOR[e.level] ?? 'var(--text)' }}>{e.msg}</span>
              </div>
            ))}
          </div>
        </section>
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
            </div>
          );
        })}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
        <Metric label="Balance" value={st ? fmt(st.balance, 0) : '—'} />
        <Metric label="Equity" value={st ? fmt(st.equity, 0) : '—'} />
        <Metric label="Day P&L" value={st ? fmt(st.day_pnl, 0) : '—'} color={st && st.day_pnl >= 0 ? 'var(--up)' : 'var(--down)'} />
        <Metric label="Positions" value={st ? String(st.open_positions ?? 0) : '—'} />
        <Metric label="Risk exposure" value={st ? pct(st.open_risk_pct) : '—'} />
        <Metric label="Kill switch" value={st?.killed ? 'ON' : 'off'} color={st?.killed ? 'var(--down)' : 'var(--dim)'} />
      </section>
    </main>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 500, color: color ?? 'var(--text)' }}>{value}</div>
    </div>
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
