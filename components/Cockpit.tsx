'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Chart } from '@/components/Chart';
import { Desk } from '@/components/Desk';
import { Telemetry } from '@/components/Telemetry';
import { useSignals, useLatestState, sendCommand, usePrice, useTrades, useDayStartEquity } from '@/lib/cockpit/useRealtime';

const fmt = (n: unknown, d = 2) => (n == null ? '—' : Number(n).toFixed(d));
const pct = (n: unknown, d = 1) => (n == null ? '—' : (Number(n) * 100).toFixed(d) + '%');
const CONTRACT = 100; // XAUUSD : 100 oz / lot (cf. lib/engine/config.ts)
const PIP = 0.1; // XAUUSD : 1 pip = 0.1

export function Cockpit() {
  const signals = useSignals(40);
  const st = useLatestState() as any;
  const trades = useTrades(80);
  const dayStartEq = useDayStartEquity();
  const [optMode, setOptMode] = useState<string | null>(null);
  const [optKilled, setOptKilled] = useState<boolean | null>(null);
  const [show, setShow] = useState(false); // SHOW = générateur d'activité (ex action + rafale fusionnés → set_rafale)
  const [lastFire, setLastFire] = useState<string | null>(null);
  const [lot, setLot] = useState('0.10');
  const [slIn, setSlIn] = useState('');
  const [tpIn, setTpIn] = useState('');
  const activeMode = optMode ?? (st?.mode as string | undefined) ?? 'normal';
  const strategy = activeMode === 'scalp' ? 'scalp' : 'normal'; // 2 stratégies seulement
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

  // open position to draw on the chart (entry/SL/TP); null if none
  const openSig = signals.find((s: any) => {
    if (s.ticket == null) return false;
    const t = tradeByTicket.get(String(s.ticket));
    return t && !t.closed_at;
  }) as any;
  const openRefMs = openSig ? Number(String(openSig.ref ?? '').split('-')[1]) : NaN; // temps d'entrée (comme le marqueur)
  const activeTrade = openSig
    ? {
        direction: String(openSig.direction),
        entry: Number(openSig.entry),
        entryTime: Number.isFinite(openRefMs) && openRefMs > 1e12 ? openRefMs : openSig.created_at ? Date.parse(openSig.created_at) : null,
        sl: Number(openSig.stop_loss) || null,
        tp: Number(openSig.take_profits?.[0]) || null,
        tps: (Array.isArray(openSig.take_profits) ? openSig.take_profits : []).map(Number).filter((x: number) => Number.isFinite(x) && x > 0),
      }
    : null;

  // Stats desk (track record) depuis les trades clôturés. On exclut les micro-scalps BEAST (spam) repérés via les signaux.
  const rafaleTickets = new Set(
    signals.filter((s: any) => Array.isArray(s.rationale) && s.rationale.join(' ').includes('RAFALE')).map((s: any) => String(s.ticket)),
  );
  const closedT = trades.filter((t: any) => t.closed_at != null && t.pnl != null && !rafaleTickets.has(String(t.ticket)));
  const stats = (() => {
    const n = closedT.length;
    if (n < 5) return { n, ready: false as const };
    const wins = closedT.filter((t: any) => Number(t.pnl) > 0).length;
    const gp = closedT.reduce((s: number, t: any) => s + Math.max(0, Number(t.pnl)), 0);
    const gl = closedT.reduce((s: number, t: any) => s + Math.min(0, Number(t.pnl)), 0); // ≤ 0
    const rs = closedT.map((t: any) => Number(t.r)).filter((x: number) => Number.isFinite(x));
    return {
      n,
      ready: true as const,
      winPct: wins / n,
      pf: gl < 0 ? gp / Math.abs(gl) : gp > 0 ? Infinity : 0,
      avgR: rs.length ? rs.reduce((a: number, b: number) => a + b, 0) / rs.length : null,
      exp: closedT.reduce((s: number, t: any) => s + Number(t.pnl), 0) / n,
    };
  })();

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

  function setStrategy(mode: 'normal' | 'scalp') {
    setOptMode(mode);
    void sendCommand('set_mode', { mode });
  }

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', gap: 8, padding: 10, overflow: 'hidden' }}>
      {lastFire === 'long' && <div className="flashbar" style={{ background: 'linear-gradient(90deg,transparent,#1fd8b0,transparent)' }} />}
      {lastFire === 'short' && <div className="flashbar" style={{ background: 'linear-gradient(90deg,transparent,#ff6b8a,transparent)' }} />}

      {/* ===== HEADER ===== */}
      <header className="panel" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="glow" style={{ width: 20, height: 20, background: 'linear-gradient(135deg,#2be3f5,#1e40e5)', clipPath: 'polygon(50% 8%,92% 92%,8% 92%)' }} />
          <strong style={{ fontSize: 15, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA&nbsp;AI</strong>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: 'var(--up)', letterSpacing: 1 }}>
            <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--up)' }} /> LIVE
          </span>
          <PriceTicker />
          <MarketStatus session={st?.session as string | undefined} regime={st?.regime as string | undefined} tradable={!!st?.tradable} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* STRATEGY : 2 stratégies seulement */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={grpLabel}>STRATEGY</span>
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
              <button onClick={() => setStrategy('normal')} style={seg(strategy === 'normal', false)} title="Normal — selective real edge">NORMAL</button>
              <button onClick={() => setStrategy('scalp')} style={seg(strategy === 'scalp', true)} title="Scalp — validated scalp strategy (trades often, fast TP)">⚡ SCALP</button>
            </div>
          </div>
          {/* SHOW : générateur d'activité (action + rafale fusionnés) */}
          <button
            onClick={() => { const n = !show; setShow(n); void sendCommand('set_rafale', { on: n }); }}
            style={beastBtn(show)}
            title="BEAST MODE — rapid-fire micro-scalps for the stream (3-5/min). Pure show, not an edge: small lot, burns fees. Best on demo."
          >
            {show ? '🔥 BEAST ON' : '🔥 BEAST MODE'}
          </button>
          <button
            onClick={() => { const next = !killed; setOptKilled(next); void sendCommand(next ? 'kill' : 'resume'); }}
            style={{ ...pill(killed), padding: '5px 12px', color: killed ? '#ff8aa2' : 'var(--muted)', borderColor: 'rgba(255,107,138,.45)', background: killed ? 'rgba(255,107,138,.15)' : 'transparent' }}
            title={killed ? 'resume trading' : 'kill switch — stops any new position'}
          >
            {killed ? '● KILLED' : 'KILL'}
          </button>
          <button onClick={() => supabase.auth.signOut()} style={pill(false)} title="sign out">⎋</button>
        </div>
      </header>

      {/* ===== CONTROL DECK (manual) ===== */}
      <section className="panel" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexWrap: 'wrap' }}>
        <span style={grpLabel}>MANUAL</span>
        <label style={lbl}>lot<input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="decimal" style={inp(52)} /></label>
        <label style={lbl}>SL<input value={slIn} onChange={(e) => setSlIn(e.target.value)} placeholder="—" inputMode="decimal" style={inp(64)} /></label>
        <label style={lbl}>TP<input value={tpIn} onChange={(e) => setTpIn(e.target.value)} placeholder="—" inputMode="decimal" style={inp(64)} /></label>
        <button onClick={() => manualTrade('long')} disabled={killed} style={deckBtn('long', lastFire === 'long', killed)} title="open a LONG at market (SL/TP optional)">▲ LONG</button>
        <button onClick={() => manualTrade('short')} disabled={killed} style={deckBtn('short', lastFire === 'short', killed)} title="open a SHORT at market (SL/TP optional)">▼ SHORT</button>
        <button onClick={() => fire('flat', () => sendCommand('close_all'))} style={deckBtn('flat', lastFire === 'flat', false)} title="close all open positions">✕ CLOSE ALL</button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: openPos > 0 ? 'var(--up)' : 'var(--dim)' }}>
            {openPos > 0 && <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--up)' }} />}
            {openPos > 0 ? `IN POSITION ×${openPos}` : 'flat'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>day</span>
          <span className="mono popVal" key={dayPnl ?? 'x'} style={{ fontSize: 16, fontWeight: 700, color: (dayPnl ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {dayPnl == null ? '—' : (dayPnl >= 0 ? '+' : '') + dayPnl.toFixed(0) + '$'}
          </span>
        </div>
      </section>

      {/* ===== MAIN (fills, fixed) : chart | desk + mission control ===== */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '2.4fr 1fr', gap: 10 }}>
        <section className="panel" style={{ minHeight: 0, padding: 10, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6, flex: 'none', minHeight: 20, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>XAU/USD</span>
            {activeTrade && (
              <LivePositionHud
                direction={activeTrade.direction}
                entry={activeTrade.entry}
                sl={activeTrade.sl}
                tp={activeTrade.tp}
                lot={Number(openSig?.lot) || 0.1}
              />
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Chart signals={signals} activeTrade={activeTrade} />
          </div>
        </section>
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1.4fr', gap: 10, minHeight: 0 }}>
          <Desk />
          <Telemetry state={st} signals={signals} />
        </div>
      </div>

      {/* ===== TRADES — single-line chips, horizontal scroll (open positions first, with close) ===== */}
      <section className="panel" style={{ flex: 'none', padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
        <div style={{ fontSize: 9.5, color: 'var(--cyan)', letterSpacing: 1, opacity: 0.85, flex: 'none' }}>
          TRADES <span style={{ color: 'var(--dim)' }}>— newest left → scroll ▸</span>
        </div>
        <div className="mono" style={{ display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 2 }}>
          {signals.length === 0 && <span style={{ fontSize: 11, color: 'var(--dim)', padding: '6px 2px' }}>no trades yet</span>}
          {signals.map((s: any, i: number) => {
            const long = s.direction === 'long';
            const tr = s.ticket != null ? tradeByTicket.get(String(s.ticket)) : null;
            const closed = !!tr?.closed_at;
            const open = !!tr && !closed;
            const pnl = tr?.pnl != null ? Number(tr.pnl) : null;
            const reason = (tr?.reason as string | undefined) ?? '';
            const num = signals.length - i;
            const time = s.created_at ? new Date(s.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
            const edge = open ? (long ? 'rgba(34,224,166,.6)' : 'rgba(255,107,138,.6)') : 'var(--border)';
            const rationale = Array.isArray(s.rationale) ? (s.rationale as string[]).join(' · ') : '';
            const k = s.ticket != null ? String(s.ticket) : '';
            return (
              <div key={s.id} className="cardIn" title={rationale} style={{
                flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
                padding: '5px 10px', borderRadius: 8, border: `1px solid ${edge}`,
                background: open ? (long ? 'rgba(34,224,166,.07)' : 'rgba(255,107,138,.07)') : 'rgba(255,255,255,.012)',
              }}>
                <span style={{ fontSize: 9.5, color: 'var(--dim)' }}>#{num}</span>
                <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{time}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: long ? 'rgba(34,224,166,.15)' : 'rgba(255,107,138,.15)', color: long ? 'var(--up)' : 'var(--down)' }}>{String(s.direction).toUpperCase()}</span>
                <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{fmt(s.lot)}@{fmt(s.entry, 1)}</span>
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>SL {s.stop_loss > 0 ? fmt(s.stop_loss, 1) : '—'} · TP {s.take_profits?.[0] ? fmt(s.take_profits[0], 1) : '—'}</span>
                {open ? (
                  <>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--cyan)' }}>
                      <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cyan)' }} /> OPEN
                    </span>
                    <button onClick={() => fire('close-' + k, () => sendCommand('close_position', { ticket: k }))} title="close this position at market (without waiting for TP/SL)"
                      style={{ fontSize: 9.5, padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(255,107,138,.5)', background: lastFire === 'close-' + k ? 'rgba(255,107,138,.2)' : 'transparent', color: '#ff8aa2', cursor: 'pointer' }}>✕ close</button>
                  </>
                ) : closed ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {reason && <span style={{ fontSize: 8.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(130,152,190,.15)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{reason}</span>}
                    <span style={{ fontSize: 12, fontWeight: 700, color: (pnl ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }}>{(pnl ?? 0) >= 0 ? '✓+' : '✗'}{pnl != null ? pnl.toFixed(0) : '—'}$</span>
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--dim)' }}>placed</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== METRICS (compact, fixed) ===== */}
      <section style={{ flex: 'none', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
        <Metric label="Balance" value={st ? fmt(st.balance, 0) : '—'} accent="var(--cyan)" />
        <Metric label="Equity" value={st ? fmt(st.equity, 0) : '—'} accent="var(--blue)" />
        <Metric label="Day P&L" value={dayPnl == null ? '—' : (dayPnl >= 0 ? '+' : '') + dayPnl.toFixed(0)} color={(dayPnl ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} accent={(dayPnl ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} />
        <Metric label={`Win rate · ${stats.n}`} value={stats.ready ? (stats.winPct * 100).toFixed(0) + '%' : `${stats.n}/5`} color={stats.ready ? 'var(--up)' : 'var(--dim)'} accent="var(--up)" />
        <Metric label="Profit factor" value={stats.ready ? (stats.pf === Infinity ? '∞' : stats.pf.toFixed(2)) : '—'} color={stats.ready ? (stats.pf >= 1 ? 'var(--up)' : 'var(--down)') : 'var(--dim)'} accent="var(--cyan)" />
        <Metric label="Avg R" value={stats.ready && stats.avgR != null ? (stats.avgR >= 0 ? '+' : '') + stats.avgR.toFixed(2) : '—'} color={stats.ready && (stats.avgR ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} accent="var(--gold)" />
      </section>
    </main>
  );
}

function Metric({ label, value, color, accent }: { label: string; value: string; color?: string; accent?: string }) {
  return (
    <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '6px 11px', borderLeft: `2px solid ${accent ?? 'var(--border)'}` }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: color ?? 'var(--text)', lineHeight: 1.2 }}>{value}</div>
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
      <span style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: 0.5 }}>XAU/USD</span>
      <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: col, lineHeight: 1 }}>{px.mid.toFixed(2)}</span>
      <span className="mono" style={{ fontSize: 11, color: col }}>{arrow}</span>
      <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>spr {(px.ask - px.bid).toFixed(2)}</span>
    </span>
  );
}

// HUD position OUVERTE : P&L flottant / R / pips en direct (tick par tick), + mini-barre SL·entrée·TP.
// S'abonne au prix lui-même → seul ce composant se re-rend à chaque tick (pas tout le cockpit).
function LivePositionHud({ direction, entry, sl, tp, lot }: { direction: string; entry: number; sl: number | null; tp: number | null; lot: number }) {
  const px = usePrice();
  const long = direction === 'long';
  const dir = long ? 1 : -1;
  const exit = px ? (long ? px.bid : px.ask) : entry; // on clôturerait au bid (long) / ask (short)
  const move = (exit - entry) * dir; // distance en notre faveur (prix)
  const pnl = move * lot * CONTRACT;
  const pips = move / PIP;
  const rr = sl != null && Math.abs(entry - sl) > 1e-9 ? move / Math.abs(entry - sl) : null;
  const col = pnl > 0 ? 'var(--up)' : pnl < 0 ? 'var(--down)' : 'var(--muted)';
  return (
    <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: long ? 'rgba(31,216,176,.15)' : 'rgba(255,107,138,.15)', color: long ? 'var(--up)' : 'var(--down)' }}>
        {long ? '▲ LONG' : '▼ SHORT'}
      </span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{lot.toFixed(2)} @ {entry.toFixed(2)}</span>
      <span style={{ fontSize: 11, color: 'var(--dim)' }}>→</span>
      <span style={{ fontSize: 12, color: 'var(--text)' }}>{px ? exit.toFixed(2) : '—'}</span>
      <PosBar entry={entry} sl={sl} tp={tp} cur={exit} col={col} />
      <span className="popVal" key={px ? Math.round(pnl) : 'x'} style={{ fontSize: 16, fontWeight: 700, color: col, minWidth: 72, textAlign: 'right' }}>
        {px ? (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + '$' : '—'}
      </span>
      <span style={{ fontSize: 11.5, color: col, minWidth: 44, textAlign: 'right' }}>{rr != null && px ? (rr >= 0 ? '+' : '') + rr.toFixed(2) + 'R' : '·'}</span>
      <span style={{ fontSize: 11, color: 'var(--dim)', minWidth: 40, textAlign: 'right' }}>{px ? (pips >= 0 ? '+' : '') + pips.toFixed(0) + 'p' : ''}</span>
    </div>
  );
}

// Mini-barre : piste SL↔TP, segment rempli entrée→prix courant (couleur du P&L), point courant.
function PosBar({ entry, sl, tp, cur, col }: { entry: number; sl: number | null; tp: number | null; cur: number; col: string }) {
  if (sl == null || tp == null) return null;
  const lo = Math.min(sl, tp);
  const hi = Math.max(sl, tp);
  const span = hi - lo;
  if (span <= 0) return null;
  const pos = (x: number) => Math.max(0, Math.min(1, (x - lo) / span)) * 100;
  const eX = pos(entry);
  const cX = pos(cur);
  const a = Math.min(eX, cX);
  const b = Math.max(eX, cX);
  return (
    <span style={{ position: 'relative', width: 104, height: 6, borderRadius: 3, background: 'rgba(130,152,190,.18)', display: 'inline-block' }} title="SL · entry · TP">
      <span style={{ position: 'absolute', left: `${a}%`, width: `${b - a}%`, top: 0, bottom: 0, background: col, opacity: 0.7, borderRadius: 3 }} />
      <Tick x={pos(sl)} color="var(--down)" />
      <Tick x={pos(tp)} color="var(--up)" />
      <span style={{ position: 'absolute', left: `${cX}%`, top: '50%', width: 7, height: 7, marginLeft: -3.5, marginTop: -3.5, borderRadius: '50%', background: col, boxShadow: `0 0 6px ${col}` }} />
    </span>
  );
}
function Tick({ x, color }: { x: number; color: string }) {
  return <span style={{ position: 'absolute', left: `${x}%`, top: -1, bottom: -1, width: 2, marginLeft: -1, background: color, borderRadius: 1 }} />;
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
    return <span style={{ fontSize: 12, color: 'var(--gold)' }}>⏸ market closed · reopens in {hh}h{String(mm).padStart(2, '0')}</span>;
  }
  return (
    <span style={{ fontSize: 12, color: tradable ? 'var(--up)' : 'var(--dim)' }}>
      {session ?? '—'} · {regime ?? '—'}
    </span>
  );
}

const grpLabel: CSSProperties = { fontSize: 9, color: 'var(--cyan)', letterSpacing: 1, opacity: 0.85, textTransform: 'uppercase' };
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

// Segmented strategy button (NORMAL | SCALP). scalp = gold accent.
function seg(active: boolean, gold: boolean): CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.4,
    padding: '5px 12px',
    cursor: 'pointer',
    border: 'none',
    color: active ? (gold ? '#0b0e14' : '#7fc4ff') : 'var(--muted)',
    background: active ? (gold ? '#ffd166' : 'rgba(46,139,240,.22)') : 'transparent',
  };
}

// BEAST MODE toggle (fiery red/orange — distinct from gold SCALP).
function beastBtn(on: boolean): CSSProperties {
  return {
    padding: '5px 13px',
    borderRadius: 7,
    fontSize: 11.5,
    fontWeight: 800,
    letterSpacing: 0.5,
    cursor: 'pointer',
    border: `1px solid ${on ? 'rgba(255,90,60,.8)' : 'rgba(255,107,61,.55)'}`,
    color: on ? '#fff' : '#ff8a5c',
    background: on ? 'linear-gradient(90deg,#ff7a18,#ff2d55)' : 'transparent',
    boxShadow: on ? '0 0 16px rgba(255,77,77,.6)' : 'none',
    animation: on ? 'pulseDot 1.4s ease-in-out infinite' : undefined,
  };
}

function deckBtn(kind: 'long' | 'short' | 'flat', flash: boolean, disabled: boolean): CSSProperties {
  const map = {
    long: { fg: '#1fd8b0', bd: 'rgba(34,224,166,.5)', bg: 'rgba(34,224,166,.12)' },
    short: { fg: '#ff6b8a', bd: 'rgba(255,107,138,.5)', bg: 'rgba(255,107,138,.12)' },
    flat: { fg: 'var(--muted)', bd: 'rgba(130,152,190,.35)', bg: 'transparent' },
  }[kind];
  return {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.4,
    padding: '6px 13px',
    borderRadius: 7,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    color: map.fg,
    background: flash ? map.fg : map.bg,
    border: `1px solid ${map.bd}`,
    transform: flash ? 'scale(1.06)' : 'scale(1)',
    transition: 'transform .15s ease, background .2s ease',
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
