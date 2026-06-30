'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Chart } from '@/components/Chart';
import { Desk } from '@/components/Desk';
import { Telemetry } from '@/components/Telemetry';
import { useSignals, useLatestState, sendCommand, usePrice, useTrades, useDayStartEquity } from '@/lib/cockpit/useRealtime';

const fmt = (n: unknown, d = 2) => (n == null ? '—' : Number(n).toFixed(d));
const pct = (n: unknown, d = 1) => (n == null ? '—' : (Number(n) * 100).toFixed(d) + '%');

export function Cockpit() {
  const signals = useSignals(8);
  const st = useLatestState() as any;
  const trades = useTrades(60);
  const dayStartEq = useDayStartEquity();
  const [optMode, setOptMode] = useState<string | null>(null);
  const [optKilled, setOptKilled] = useState<boolean | null>(null);
  const [action, setAction] = useState(false);
  const [lastFire, setLastFire] = useState<string | null>(null);
  const [lot, setLot] = useState('0.10');
  const [slIn, setSlIn] = useState('');
  const [tpIn, setTpIn] = useState('');
  const activeMode = optMode ?? (st?.mode as string | undefined) ?? 'normal';
  const killed = optKilled ?? !!st?.killed;
  const openPos = Number(st?.open_positions ?? 0);
  const dayPnl =
    dayStartEq != null && st?.equity != null ? Number(st.equity) - dayStartEq : st?.day_pnl == null ? null : Number(st.day_pnl);
  const tradeByTicket = new Map<string, any>();
  for (const t of trades) {
    if (t.ticket == null) continue;
    const k = String(t.ticket);
    const prev = tradeByTicket.get(k);
    if (!prev || (t.closed_at && !prev.closed_at)) tradeByTicket.set(k, t);
  }

  // position OUVERTE a materialiser sur le chart (entree/SL/TP) ; null si aucune
  const openSig = signals.find((s: any) => {
    if (s.ticket == null) return false;
    const t = tradeByTicket.get(String(s.ticket));
    return t && !t.closed_at;
  }) as any;
  const activeTrade = openSig
    ? { direction: String(openSig.direction), entry: Number(openSig.entry), sl: Number(openSig.stop_loss) || null, tp: Number(openSig.take_profits?.[0]) || null }
    : null;

  function fire(kind: string, fn: () => void) {
    setLastFire(kind);
    fn();
    setTimeout(() => setLastFire((k) => (k === kind ? null : k)), 700);
  }

  function manualTrade(direction: 'long' | 'short') {
    const p: Record<string, unknown> = { direction };
    const l = parseFloat(lot); if (l > 0) p.lot = l;
    const s = parseFloat(slIn); if (s > 0) p.sl = s;
    const t = parseFloat(tpIn); if (t > 0) p.tp = t;
    fire(direction, () => sendCommand('manual_trade', p));
  }

  return (
    <main style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100vh' }}>
      {lastFire === 'long' && <div className="flashbar" style={{ background: 'linear-gradient(90deg,transparent,#1fd8b0,transparent)' }} />}
      {lastFire === 'short' && <div className="flashbar" style={{ background: 'linear-gradient(90deg,transparent,#ff6b8a,transparent)' }} />}

      <header className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="glow" style={{ width: 22, height: 22, background: 'linear-gradient(135deg,#2be3f5,#1e40e5)', clipPath: 'polygon(50% 8%,92% 92%,8% 92%)' }} />
          <strong style={{ fontSize: 16, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA&nbsp;AI</strong>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--up)', letterSpacing: 1 }}>
            <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--up)' }} /> LIVE
          </span>
          <PriceTicker />
          <MarketStatus session={st?.session as string | undefined} regime={st?.regime as string | undefined} tradable={!!st?.tradable} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['soft', 'normal', 'turbo', 'scalp'] as const).map((m) => {
            const isScalp = m === 'scalp';
            const on = activeMode === m;
            return (
              <button
                key={m}
                onClick={() => { setOptMode(m); void sendCommand('set_mode', { mode: m }); }}
                style={isScalp
                  ? { ...pill(on), color: on ? '#0b0e14' : '#ffd166', borderColor: 'rgba(255,209,102,.55)', background: on ? '#ffd166' : 'transparent', fontWeight: 700, letterSpacing: 0.5 }
                  : pill(on)}
                title={isScalp ? 'mode SCALP — stratégie scalp validée (trade souvent, TP rapide)' : `mode ${m}`}
              >
                {isScalp ? '⚡ SCALP' : m}
              </button>
            );
          })}
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

      <section className="panel" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, color: 'var(--cyan)', letterSpacing: 1, opacity: 0.85 }}>CONTROL&nbsp;DECK</span>
        <label style={lbl}>lot<input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="decimal" style={inp(56)} /></label>
        <label style={lbl}>SL<input value={slIn} onChange={(e) => setSlIn(e.target.value)} placeholder="—" inputMode="decimal" style={inp(70)} /></label>
        <label style={lbl}>TP<input value={tpIn} onChange={(e) => setTpIn(e.target.value)} placeholder="—" inputMode="decimal" style={inp(70)} /></label>
        <button onClick={() => manualTrade('long')} disabled={killed} style={deckBtn('long', lastFire === 'long', killed)} title="ouvre un LONG au marché (SL/TP optionnels)">
          ▲ LONG NOW
        </button>
        <button onClick={() => manualTrade('short')} disabled={killed} style={deckBtn('short', lastFire === 'short', killed)} title="ouvre un SHORT au marché (SL/TP optionnels)">
          ▼ SHORT NOW
        </button>
        <button onClick={() => fire('flat', () => sendCommand('close_all'))} style={deckBtn('flat', lastFire === 'flat', false)} title="ferme toutes les positions ouvertes">
          ✕ CLOSE ALL
        </button>
        <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
        <button
          onClick={() => { const n = !action; setAction(n); void sendCommand('set_action', { on: n }); }}
          style={deckBtn(action ? 'action-on' : 'action-off', false, false)}
          title="mode Action : Algoria envoie des trades en continu"
        >
          {action ? '● ACTION ON' : '○ ACTION'}
        </button>
        {openPos > 0 ? (
          <span className="liveGlow" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 8, background: 'rgba(31,216,176,.08)' }}>
            <span className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--up)' }} />
            <span style={{ fontSize: 11.5, color: 'var(--up)', letterSpacing: 0.5 }}>EN POSITION ×{openPos}</span>
            {dayPnl != null && <span className="mono popVal" key={dayPnl} style={{ fontSize: 13, fontWeight: 600, color: dayPnl >= 0 ? 'var(--up)' : 'var(--down)' }}>{dayPnl >= 0 ? '+' : ''}{dayPnl.toFixed(0)}$</span>}
          </span>
        ) : (
          <span style={{ fontSize: 10.5, color: 'var(--dim)', marginLeft: 'auto' }}>contrôle manuel — démo · SL/TP optionnels</span>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr', gap: 12 }}>
        <section className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 13, marginBottom: 6, color: 'var(--muted)' }}>XAU/USD</div>
          <div style={{ height: 540 }}>
            <Chart signals={signals} activeTrade={activeTrade} />
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateRows: '1fr 1.6fr', gap: 12, height: 540, minHeight: 0 }}>
          <Desk />
          <Telemetry state={st} signals={signals} />
        </div>
      </div>

      <div style={{ fontSize: 10.5, color: 'var(--cyan)', letterSpacing: 1 }}>
        TRADES <span style={{ color: 'var(--dim)' }}>— le plus récent à gauche (#{signals.length || 0}) → le plus ancien à droite</span>
      </div>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
        {signals.length === 0 && <div className="panel" style={{ padding: 12, color: 'var(--dim)' }}>aucun trade pour l'instant</div>}
        {signals.map((s: any, i: number) => {
          const long = s.direction === 'long';
          const tr = s.ticket != null ? tradeByTicket.get(String(s.ticket)) : null;
          const closed = !!tr?.closed_at;
          const pnl = tr?.pnl != null ? Number(tr.pnl) : null;
          const reason = (tr?.reason as string | undefined) ?? '';
          const num = signals.length - i;
          const time = s.created_at ? new Date(s.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
          const edge = long ? 'rgba(34,224,166,.35)' : 'rgba(255,107,138,.35)';
          return (
            <div key={s.id} className="panel cardIn" style={{ padding: 12, borderColor: closed ? 'var(--border)' : edge, opacity: closed ? 0.9 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>#{num}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{time}</span>
                  <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 6, background: long ? 'rgba(34,224,166,.15)' : 'rgba(255,107,138,.15)', color: long ? 'var(--up)' : 'var(--down)' }}>{String(s.direction).toUpperCase()}</span>
                </span>
                {closed ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {reason && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 5, background: 'rgba(130,152,190,.15)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{reason}</span>}
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: (pnl ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }}>{(pnl ?? 0) >= 0 ? '✓ +' : '✗ '}{pnl != null ? pnl.toFixed(0) : '—'}$</span>
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--cyan)', letterSpacing: 0.5 }}>
                    <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cyan)' }} /> OUVERT
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>entry {fmt(s.entry)}</span>
                <span>SL {s.stop_loss > 0 ? fmt(s.stop_loss) : '—'}</span>
                <span>TP {s.take_profits?.[0] ? fmt(s.take_profits[0]) : '—'}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8 }}>{fmt(s.lot)} lot{closed && tr?.exit ? ` · sortie ${fmt(tr.exit)}` : ''}</div>
              {Array.isArray(s.rationale) && s.rationale.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ fontSize: 9.5, color: 'var(--cyan)', letterSpacing: 0.5, opacity: 0.85 }}>WHY THIS TRADE</div>
                  {(s.rationale as string[]).slice(0, 2).map((r: string, j: number) => (
                    <div key={j} style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.35 }}>◢ {r}</div>
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
        <Metric label="Day P&L" value={dayPnl == null ? '—' : (dayPnl >= 0 ? '+' : '') + dayPnl.toFixed(0)} color={(dayPnl ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} accent={(dayPnl ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} />
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

const lbl: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--muted)', letterSpacing: 0.5 };
function inp(width: number): CSSProperties {
  return {
    width,
    fontSize: 12,
    fontFamily: 'JetBrains Mono, monospace',
    padding: '4px 7px',
    borderRadius: 6,
    color: 'var(--text)',
    background: 'var(--panel-2)',
    border: '1px solid rgba(130,152,190,.3)',
    outline: 'none',
  };
}

function deckBtn(kind: 'long' | 'short' | 'flat' | 'action-on' | 'action-off', flash: boolean, disabled: boolean): CSSProperties {
  const map = {
    long: { fg: '#1fd8b0', bd: 'rgba(34,224,166,.5)', bg: 'rgba(34,224,166,.12)' },
    short: { fg: '#ff6b8a', bd: 'rgba(255,107,138,.5)', bg: 'rgba(255,107,138,.12)' },
    flat: { fg: 'var(--muted)', bd: 'rgba(130,152,190,.35)', bg: 'transparent' },
    'action-on': { fg: '#f5c24a', bd: 'rgba(245,194,74,.6)', bg: 'rgba(245,194,74,.16)' },
    'action-off': { fg: 'var(--muted)', bd: 'rgba(130,152,190,.3)', bg: 'transparent' },
  }[kind];
  return {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.4,
    padding: '6px 14px',
    borderRadius: 7,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    color: map.fg,
    background: flash ? map.fg : map.bg,
    border: `1px solid ${map.bd}`,
    transform: flash ? 'scale(1.06)' : 'scale(1)',
    transition: 'transform .15s ease, background .2s ease',
    animation: kind === 'action-on' ? 'pulseDot 1.4s ease-in-out infinite' : undefined,
  };
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
