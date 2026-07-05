'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Chart } from '@/components/Chart';
import { Desk } from '@/components/Desk';
import { Telemetry } from '@/components/Telemetry';
import { useSignals, useLatestState, sendCommand, usePrice, useTrades, useDayStartEquity, useEquityCurve, useFeedHealth, useDesk, useWeekHistory } from '@/lib/cockpit/useRealtime';
import { AlgoriaVoice } from './Voice';
import { Autopilot } from './Autopilot';

const fmt = (n: unknown, d = 2) => (n == null ? '—' : Number(n).toFixed(d));
const pct = (n: unknown, d = 1) => (n == null ? '—' : (Number(n) * 100).toFixed(d) + '%');

// Marchés tradés par Algoria (le cockpit suit le symbole sélectionné). contract/pip/dp servent au HUD live.
interface SymSpec { key: string; label: string; short: string; contract: number; pip: number; dp: number; h24?: boolean }
const SYMS: SymSpec[] = [
  { key: 'XAUUSD', label: 'XAU/USD', short: 'XAU', contract: 100, pip: 0.1, dp: 2 },
  { key: 'NAS100', label: 'NAS100', short: 'NAS', contract: 1, pip: 1, dp: 1 },
  { key: 'BTCUSD', label: 'BTC/USD', short: 'BTC', contract: 1, pip: 10, dp: 1, h24: true }, // 24/7 — WATCH pour l'auto (pas d'edge validé), manuel OK
];
const symSpec = (k: string) => SYMS.find((s) => s.key === k) ?? SYMS[0];

export function Cockpit() {
  const [symbol, setSymbol] = useState('XAUUSD'); // marché affiché/piloté par le cockpit
  const spec = symSpec(symbol);
  const signals = useSignals(60);
  const st = useLatestState() as any;
  const trades = useTrades(120);
  const deskItems = useDesk(24); // desk MULTI-MARCHÉ entrelacé (XAU + NAS) — levé ici pour aussi nourrir le header
  const symCtx = (deskItems as any[]).find((e) => ((e?.data?.symbol as string | undefined) ?? 'XAUUSD') === symbol)?.data; // dernier contexte structuré du symbole sélectionné
  const dayStartEq = useDayStartEquity();
  const equityCurve = useEquityCurve();
  const [optKilled, setOptKilled] = useState<boolean | null>(null);
  const [show, setShow] = useState(false); // SHOW = générateur d'activité (ex action + rafale fusionnés → set_rafale)
  const [lastFire, setLastFire] = useState<string | null>(null);
  const [lot, setLot] = useState('0.10');
  const [slIn, setSlIn] = useState('');
  const [tpIn, setTpIn] = useState('');
  const [broadcast, setBroadcast] = useState(false); // mode diffusion : vue épurée pour le live (masque les contrôles opérateur)
  // MODE AUTOPILOT : Algoria tient le live seule (scène plein écran + chat TikTok + voix). Persisté →
  // un crash/reload de la machine de stream REPREND l'autopilot tout seul (personne n'est là pour cliquer).
  const [autopilot, setAutopilot] = useState(false);
  useEffect(() => {
    setAutopilot(localStorage.getItem('algoria.autopilot') === '1');
  }, []);
  const toggleAutopilot = () =>
    setAutopilot((v) => {
      const n = !v;
      try { localStorage.setItem('algoria.autopilot', n ? '1' : '0'); } catch { /* private mode */ }
      return n;
    });
  const [whyDismissed, setWhyDismissed] = useState<string | null>(null); // id du setup fermé manuellement (croix) → se réaffiche au prochain
  // === MODE RECAP — l'HISTOIRE de la semaine, racontée pour les lives du week-end : stats jour par jour,
  // tape des trades passés, et REPLAY d'un setup sur le chart (le chart remonte le temps + WHY rejoué).
  const [recap, setRecap] = useState(false);
  const [recapDay, setRecapDay] = useState<string>('week'); // 'week' | jour UTC 'YYYY-MM-DD'
  const [focus, setFocus] = useState<number | null>(null); // instant du chart à cadrer (clic sur un trade)
  const [replayTicket, setReplayTicket] = useState<string | null>(null); // trade dont on rejoue le WHY
  const hist = useWeekHistory(8, recap); // chargé uniquement quand le recap s'ouvre
  const toggleRecap = () =>
    setRecap((r) => {
      const n = !r;
      if (n) setRecapDay('week');
      else {
        setFocus(null); // retour au présent (le chart re-scroll au temps réel)
        setReplayTicket(null);
      }
      return n;
    });
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('broadcast'); // ?broadcast=1 → source OBS dédiée
    if (p != null) setBroadcast(p === '1' || p === 'true');
    else setBroadcast(localStorage.getItem('algoria.broadcast') === '1');
  }, []);
  const toggleBroadcast = () =>
    setBroadcast((b) => {
      const n = !b;
      try {
        localStorage.setItem('algoria.broadcast', n ? '1' : '0');
      } catch {
        /* private mode */
      }
      return n;
    });
  // Une SEULE stratégie exposée : le scalp validé tourne 24/24 (le sélecteur NORMAL/SCALP était un bouton
  // qu'on ne touchait jamais — retiré). Le vrai interrupteur, c'est AUTO ON/OFF (kill switch du moteur).
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

  // Positions ouvertes PAR symbole (pour la barre marchés : point + sens sur chaque marché en position).
  const openBySym: Record<string, { dir: string }> = {};
  for (const s of signals as any[]) {
    if (s.ticket == null || !s.symbol) continue;
    const t = tradeByTicket.get(String(s.ticket));
    if (t && !t.closed_at) openBySym[s.symbol] ??= { dir: String(s.direction) };
  }

  // open position à dessiner sur le chart (entry/SL/TP) — DU SYMBOLE SÉLECTIONNÉ ; null sinon
  const openSig = signals.find((s: any) => {
    if (s.ticket == null || s.symbol !== symbol) return false;
    const t = tradeByTicket.get(String(s.ticket));
    return t && !t.closed_at;
  }) as any;
  const openRefMs = openSig ? Number(String(openSig.ref ?? '').split('-')[1]) : NaN; // temps d'entrée (comme le marqueur)
  // SL COURANT : la ligne trades porte le stop VIVANT (mis à jour par le runner au breakeven/trailing) —
  // le SL initial du signal n'est qu'un fallback. C'est ce qui fait disparaître la zone rouge après un BE.
  const openTradeRow = openSig?.ticket != null ? tradeByTicket.get(String(openSig.ticket)) : null;
  const activeTrade = openSig
    ? {
        direction: String(openSig.direction),
        entry: Number(openSig.entry),
        entryTime: Number.isFinite(openRefMs) && openRefMs > 1e12 ? openRefMs : openSig.created_at ? Date.parse(openSig.created_at) : null,
        sl: Number(openTradeRow?.sl ?? openSig.stop_loss) || null,
        tp: Number(openSig.take_profits?.[0]) || null,
        // TP1 uniquement : c'est le SEUL ordre réel chez le broker (TP2 est une cible interne du moteur) —
        // dessiner TP2 étirait la zone verte bien au-delà du vrai take profit (retour live).
        tps: (Array.isArray(openSig.take_profits) ? openSig.take_profits : []).map(Number).filter((x: number) => Number.isFinite(x) && x > 0).slice(0, 1),
      }
    : null;

  // Signal servant de base au panneau « WHY THIS TRADE » : la position ouverte si elle porte une confluence,
  // sinon le dernier signal réel (les entrées manuelles/BEAST ont des contributions vides → naturellement exclues).
  const hasConf = (s: any) => Array.isArray(s?.confluence?.contributions) && s.confluence.contributions.length > 0;
  const whySig = openSig && hasConf(openSig) ? openSig : (signals.find((s: any) => s.symbol === symbol && hasConf(s)) ?? null);
  const whyTrade = whySig?.ticket != null ? tradeByTicket.get(String(whySig.ticket)) : null;
  const whyClosed = !!whyTrade?.closed_at;
  const whyPnl = whyTrade?.pnl != null ? Number(whyTrade.pnl) : null;

  // Stats desk (track record) depuis les trades clôturés. On exclut les micro-scalps BEAST (spam) repérés via les signaux.
  const rafaleTickets = new Set(
    signals.filter((s: any) => Array.isArray(s.rationale) && s.rationale.join(' ').includes('RAFALE')).map((s: any) => String(s.ticket)),
  );
  for (const s of hist.signals as any[]) {
    if (Array.isArray(s.rationale) && s.rationale.join(' ').includes('RAFALE')) rafaleTickets.add(String(s.ticket));
  }

  // === Données RECAP : trades clôturés de la semaine (hors BEAST), groupés par jour UTC ===
  const histClosed = (hist.trades as any[]).filter((t) => t.pnl != null && t.closed_at && !rafaleTickets.has(String(t.ticket)));
  const dayOf = (t: any) => new Date(Date.parse(t.closed_at)).toISOString().slice(0, 10);
  const recapDays = (() => {
    const out: { key: string; label: string; net: number; n: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const rows = histClosed.filter((t) => dayOf(t) === key);
      out.push({
        key,
        label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase(),
        net: rows.reduce((a, t) => a + Number(t.pnl), 0),
        n: rows.length,
      });
    }
    return out;
  })();
  const recapRows = recapDay === 'week' ? histClosed : histClosed.filter((t) => dayOf(t) === recapDay);
  const recapStats = (() => {
    const n = recapRows.length;
    const net = recapRows.reduce((a, t) => a + Number(t.pnl), 0);
    const wins = recapRows.filter((t) => Number(t.pnl) > 0).length;
    const best = recapRows.reduce((m, t) => Math.max(m, Number(t.pnl) || 0), 0);
    return { n, net, wins, winPct: n ? wins / n : 0, best };
  })();
  const recapLabel = recapDay === 'week' ? 'WEEK' : (recapDays.find((d) => d.key === recapDay)?.label ?? recapDay);
  // Setup REJOUÉ (clic sur un trade du recap) : son signal complet (confluence) + sa ligne trade (P&L réel)
  const replaySig = recap && replayTicket ? ((hist.signals as any[]).find((s) => String(s.ticket) === replayTicket && Array.isArray(s?.confluence?.contributions) && s.confluence.contributions.length > 0) ?? null) : null;
  const replayTrade = replayTicket ? (histClosed.find((t) => String(t.ticket) === replayTicket) ?? null) : null;
  // Compteur "trades today" (hors BEAST) — l'activité du jour visible d'un coup d'œil dans le header.
  const dayStartMs = new Date().setUTCHours(0, 0, 0, 0);
  const tradesTodayCount = (trades as any[]).filter((t) => t.opened_at && Date.parse(t.opened_at) >= dayStartMs && !rafaleTickets.has(String(t.ticket))).length;
  // Gains clôturés du symbole affiché (hors BEAST) → pastilles "+X$" de célébration sur le chart.
  // En RECAP : TOUTE la semaine (le replay montre chaque win passé) ; sinon les 24 derniers.
  const winsForChart = recap
    ? histClosed.filter((t) => t.symbol === symbol && Number(t.pnl) > 0).map((t) => ({ time: Date.parse(t.closed_at), pnl: Number(t.pnl) }))
    : (trades as any[])
        .filter((t) => t.symbol === symbol && t.closed_at && Number(t.pnl) > 0 && !rafaleTickets.has(String(t.ticket)))
        .slice(0, 24)
        .map((t) => ({ time: Date.parse(t.closed_at), pnl: Number(t.pnl) }));

  // Signaux fournis au chart (triangles d'entrée) : en RECAP on fusionne l'historique de la semaine
  // (les 60 signaux "live" ne couvrent que les derniers jours) — dédupliqués par id.
  const chartSigs = (() => {
    const base = signals.filter((s: any) => s.symbol === symbol);
    if (!recap) return base;
    const seen = new Set(base.map((s: any) => String(s.id)));
    return [...base, ...(hist.signals as any[]).filter((s) => s.symbol === symbol && !seen.has(String(s.id)))];
  })();
  const closedT = trades.filter((t: any) => t.closed_at != null && t.pnl != null && !rafaleTickets.has(String(t.ticket)));
  const stats = (() => {
    const n = closedT.length;
    if (n < 5) return { n, ready: false as const };
    const wins = closedT.filter((t: any) => Number(t.pnl) > 0).length;
    return { n, ready: true as const, winPct: wins / n };
  })();
  // Stats STREAM du jour : compteur de wins + meilleur trade (PF/Avg R retirés — structurellement ternes avec
  // une stratégie petits-gains/petit-R:R : PF ~1.3 et avg R ~+0.05 ne parlent pas à l'audience).
  const closedToday = closedT.filter((t: any) => Date.parse(t.closed_at) >= dayStartMs);
  const winsToday = closedToday.filter((t: any) => Number(t.pnl) > 0).length;
  const bestToday = closedToday.reduce((m: number, t: any) => Math.max(m, Number(t.pnl) || 0), 0);

  function fire(kind: string, fn: () => void) {
    setLastFire(kind);
    fn();
    setTimeout(() => setLastFire((k) => (k === kind ? null : k)), 700);
  }

  function manualTrade(direction: 'long' | 'short') {
    const p: Record<string, unknown> = { direction, symbol }; // routé vers le MARCHÉ affiché (long/short BTC à la main, etc.)
    const l = parseFloat(lot); if (l > 0) p.lot = l;
    const s = parseFloat(slIn); if (s > 0) p.sl = s;
    const t = parseFloat(tpIn); if (t > 0) p.tp = t;
    fire(direction, () => sendCommand('manual_trade', p));
  }


  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', gap: 8, padding: 10, overflow: 'hidden' }}>
      {lastFire === 'long' && <div className="flashbar" style={{ background: 'linear-gradient(90deg,transparent,#1fd8b0,transparent)' }} />}
      {lastFire === 'short' && <div className="flashbar" style={{ background: 'linear-gradient(90deg,transparent,#ff6b8a,transparent)' }} />}
      <TradeAlerts signals={signals} trades={trades} rafaleTickets={rafaleTickets} />

      {/* ===== HEADER ===== */}
      <header className="panel" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/brand/algoria-mark.png" alt="Algoria" width={22} height={22} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 9px rgba(43,227,245,.45))' }} />
          <strong style={{ fontSize: 15, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA&nbsp;AI</strong>
          <FeedStatus symbol={symbol} />
          <MarketRail selected={symbol} onSelect={setSymbol} openBySym={openBySym} />
          <MarketStatus symbol={symbol} session={(symCtx?.session as string | undefined) ?? (st?.session as string | undefined)} regime={(symCtx?.regime as string | undefined) ?? (st?.regime as string | undefined)} tradable={st?.tradable !== false} />
          {tradesTodayCount > 0 && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)', display: 'flex', alignItems: 'center', gap: 4 }} title="trades executed today (excl. BEAST)">
              ⚡ <b>{tradesTodayCount}</b> <span style={{ color: 'var(--dim)' }}>today</span>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!broadcast && (
            <>
              {/* AUTO ON/OFF — l'interrupteur du moteur (remplace l'ex-sélecteur NORMAL/SCALP jamais utilisé
                  + l'ancien bouton KILL : même commande kill/resume, lecture instantanée ON=vert / OFF=rouge). */}
              <button
                onClick={() => { const next = !killed; setOptKilled(next); void sendCommand(next ? 'kill' : 'resume'); }}
                style={{
                  ...pill(false), padding: '5px 14px', fontWeight: 700, letterSpacing: 0.5,
                  color: killed ? '#ff8aa2' : 'var(--up)',
                  borderColor: killed ? 'rgba(255,107,138,.5)' : 'rgba(31,216,176,.45)',
                  background: killed ? 'rgba(255,107,138,.14)' : 'rgba(31,216,176,.08)',
                }}
                title={killed ? 'auto-trading is OFF — click to resume' : 'auto-trading is ON (validated scalp + breakout, 24/24) — click to stop new entries'}
              >
                {killed ? '⏸ AUTO OFF' : '⚡ AUTO ON'}
              </button>
              {/* SHOW : générateur d'activité (action + rafale fusionnés) */}
              <button
                onClick={() => { const n = !show; setShow(n); void sendCommand('set_rafale', { on: n }); }}
                style={beastBtn(show)}
                title="BEAST MODE — rapid-fire micro-scalps for the stream (3-5/min). Pure show, not an edge: small lot, burns fees. Best on demo."
              >
                {show ? '🔥 BEAST ON' : '🔥 BEAST MODE'}
              </button>
              <button onClick={() => supabase.auth.signOut()} style={{ ...pill(false), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '5px 9px' }} title="sign out" aria-label="sign out"><LogoutIcon /></button>
            </>
          )}
          {/* VOICE — Algoria parle : annonces trades/news + « Hey Algoria » (Q&R vocale avec le contexte live) */}
          <AlgoriaVoice deskItems={deskItems} trades={trades} st={st} symbol={symbol} dayPnl={dayPnl} rafaleTickets={rafaleTickets} autopilot={autopilot} />
          {/* RECAP — raconter la semaine en live week-end : stats par jour + replay des setups sur le chart */}
          <button
            onClick={toggleRecap}
            style={{
              ...pill(false), fontWeight: recap ? 700 : 500,
              color: recap ? 'var(--gold)' : undefined,
              borderColor: recap ? 'rgba(245,194,74,.55)' : undefined,
              background: recap ? 'rgba(245,194,74,.1)' : undefined,
            }}
            title="RECAP — rewind the week: day-by-day stats, past trades, click any trade to replay its setup on the chart"
          >
            {recap ? '📼 RECAP ON' : '📼 Recap'}
          </button>
          {/* AUTOPILOT — Algoria tient le live seule : scène plein écran (orbe), chat TikTok lu et répondu à voix
              haute, analyses parlées, trading auto inchangé. (l'ancien mode Broadcast reste via ?broadcast=1) */}
          <button
            onClick={toggleAutopilot}
            style={{
              ...pill(false), fontWeight: 700, letterSpacing: 0.5,
              color: autopilot ? '#ff8aa2' : 'var(--muted)',
              borderColor: autopilot ? 'rgba(255,107,138,.55)' : 'var(--border)',
              background: autopilot ? 'rgba(255,107,138,.12)' : 'transparent',
            }}
            title="AUTOPILOT — Algoria runs the live alone: full-screen orb stage, reads & answers TikTok chat out loud, keeps narrating the market. Trading stays fully automatic."
          >
            {autopilot ? '🤖 AUTOPILOT ON' : '🤖 Autopilot'}
          </button>
        </div>
      </header>

      {/* ===== CONTROL DECK (manual) — masqué en mode diffusion ===== */}
      {!broadcast && (
      <section className="panel" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexWrap: 'wrap' }}>
        <span style={grpLabel}>MANUAL</span>
        <label style={lbl}>lot<input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="decimal" style={inp(52)} /></label>
        <label style={lbl}>SL<input value={slIn} onChange={(e) => setSlIn(e.target.value)} placeholder="—" inputMode="decimal" style={inp(64)} /></label>
        <label style={lbl}>TP<input value={tpIn} onChange={(e) => setTpIn(e.target.value)} placeholder="—" inputMode="decimal" style={inp(64)} /></label>
        <button onClick={() => manualTrade('long')} disabled={killed} style={deckBtn('long', lastFire === 'long', killed)} title="open a LONG at market (SL/TP optional)">▲ LONG</button>
        <button onClick={() => manualTrade('short')} disabled={killed} style={deckBtn('short', lastFire === 'short', killed)} title="open a SHORT at market (SL/TP optional)">▼ SHORT</button>
        <button onClick={() => fire('flat', () => sendCommand('close_all', { symbol }))} style={deckBtn('flat', lastFire === 'flat', false)} title="close all open positions on the displayed market">✕ CLOSE ALL</button>
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
      )}

      {/* ===== MAIN (fills, fixed) : chart | desk + mission control ===== */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '2.4fr 1fr', gap: 10 }}>
        <section className="panel" style={{ minHeight: 0, padding: 10, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6, flex: 'none', minHeight: 20, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{spec.label}</span>
            {activeTrade && (
              <LivePositionHud
                symbol={symbol}
                direction={activeTrade.direction}
                entry={activeTrade.entry}
                sl={activeTrade.sl}
                tp={activeTrade.tp}
                lot={Number(openSig?.lot) || 0.1}
              />
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Chart key={symbol} symbol={symbol} signals={chartSigs} activeTrade={activeTrade} wins={winsForChart} focusAt={recap ? focus : null} />
          </div>
          {/* WHY : le setup REJOUÉ (recap) prime sur le setup courant — croix = sortir du replay */}
          {replaySig ? (
            <WhyPanel direction={String(replaySig.direction)} conf={replaySig.confluence} rationale={replaySig.rationale} live={false} closed={!!replayTrade} pnl={replayTrade?.pnl != null ? Number(replayTrade.pnl) : null} onClose={() => setReplayTicket(null)} />
          ) : (
            whySig && String(whySig.id) !== whyDismissed && <WhyPanel direction={String(whySig.direction)} conf={whySig.confluence} rationale={whySig.rationale} live={!!openSig} closed={whyClosed} pnl={whyPnl} onClose={() => setWhyDismissed(String(whySig.id))} />
          )}
        </section>
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1.4fr', gap: 10, minHeight: 0 }}>
          <Desk items={deskItems} heroSymbol={symbol} />
          <Telemetry state={st} signals={signals} symbol={symbol} />
        </div>
      </div>

      {/* ===== TRADES — single-line chips, horizontal scroll (open positions first, with close) ===== */}
      <section className="panel" style={{ flex: 'none', padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 9.5, color: recap ? 'var(--gold)' : 'var(--cyan)', letterSpacing: 1, opacity: 0.85 }}>
            {recap ? <>📼 RECAP · {recapLabel} <span style={{ color: 'var(--dim)' }}>— click a trade to replay its setup ▸</span></> : <>TRADES <span style={{ color: 'var(--dim)' }}>— newest left → scroll ▸</span></>}
          </div>
          {/* Bandeau des JOURS : la semaine d'un coup d'œil — net + nb de trades par jour, WEEK = tout */}
          {recap && (
            <div className="mono" style={{ display: 'flex', gap: 5, overflowX: 'auto' }}>
              {[{ key: 'week', label: 'WEEK', net: recapDays.reduce((a, d) => a + d.net, 0), n: recapDays.reduce((a, d) => a + d.n, 0) }, ...recapDays].map((d) => {
                const sel = recapDay === d.key;
                return (
                  <button key={d.key} onClick={() => { setRecapDay(d.key); setReplayTicket(null); }} style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                    border: `1px solid ${sel ? 'rgba(245,194,74,.55)' : 'var(--border)'}`,
                    background: sel ? 'rgba(245,194,74,.09)' : 'transparent',
                    opacity: d.n === 0 && d.key !== 'week' ? 0.45 : 1,
                  }}>
                    <span style={{ fontSize: 9, letterSpacing: 0.6, color: sel ? 'var(--gold)' : 'var(--muted)', fontWeight: sel ? 700 : 500 }}>{d.label}</span>
                    {/* jour vert : net franc ; jour rouge : rose sourd (honnête mais discret — même règle que la tape) */}
                    <span style={{ fontSize: 10, fontWeight: 600, color: d.n === 0 ? 'var(--dim)' : d.net >= 0 ? 'var(--up)' : 'rgba(210,150,165,.8)' }}>
                      {d.n === 0 ? '—' : (d.net >= 0 ? '+' : '') + Math.round(d.net) + '$'}
                    </span>
                    {d.n > 0 && <span style={{ fontSize: 8.5, color: 'var(--dim)' }}>{d.n}t</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="mono" style={{ display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 2 }}>
          {/* ===== TAPE RECAP : les trades clôturés de la période — cliquables → time-travel du chart + WHY rejoué ===== */}
          {recap && recapRows.length === 0 && <span style={{ fontSize: 11, color: 'var(--dim)', padding: '6px 2px' }}>no trades in this period</span>}
          {recap && recapRows.map((t: any, i: number) => {
            const long = t.direction === 'long';
            const pnl = Number(t.pnl);
            const win = pnl >= 0;
            const sel = replayTicket != null && String(t.ticket) === replayTicket;
            const when = new Date(Date.parse(t.opened_at));
            const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
            const dayTag = recapDay === 'week' ? when.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }).toUpperCase() + ' ' : '';
            const sym = symSpec(String(t.symbol));
            return (
              <button key={t.id ?? i} className="cardIn" title={`replay this ${long ? 'long' : 'short'} on the chart`} onClick={() => {
                if (t.symbol && t.symbol !== symbol) setSymbol(String(t.symbol));
                const ms = Date.parse(t.opened_at);
                if (Number.isFinite(ms)) setFocus(ms);
                setReplayTicket(String(t.ticket));
              }} style={{
                flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', cursor: 'pointer',
                padding: '5px 10px', borderRadius: 8, fontFamily: 'inherit',
                border: `1px solid ${sel ? 'rgba(245,194,74,.6)' : win ? 'rgba(34,224,166,.4)' : 'var(--border)'}`,
                background: sel ? 'rgba(245,194,74,.08)' : win ? 'rgba(34,224,166,.06)' : 'rgba(255,255,255,.012)',
                boxShadow: win && !sel ? '0 0 10px rgba(34,224,166,.12)' : undefined,
                opacity: !win && !sel ? 0.55 : 1,
              }}>
                <span style={{ fontSize: 9.5, color: 'var(--dim)' }}>#{recapRows.length - i}</span>
                <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{dayTag}{time}</span>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, color: 'var(--cyan)' }}>{sym.short}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: long ? 'rgba(34,224,166,.15)' : 'rgba(255,107,138,.15)', color: long ? 'var(--up)' : 'var(--down)' }}>{String(t.direction ?? '').toUpperCase()}</span>
                <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{fmt(t.lot)}@{fmt(t.entry, 1)}</span>
                {t.reason && win && <span style={{ fontSize: 8.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(130,152,190,.15)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t.reason}</span>}
                <span style={{ fontSize: win ? 12 : 11, fontWeight: win ? 700 : 500, color: win ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{win ? '✓ +' : ''}{pnl.toFixed(0)}$</span>
              </button>
            );
          })}
          {!recap && signals.length === 0 && <span style={{ fontSize: 11, color: 'var(--dim)', padding: '6px 2px' }}>no trades yet</span>}
          {!recap && signals.map((s: any, i: number) => {
            const long = s.direction === 'long';
            const tr = s.ticket != null ? tradeByTicket.get(String(s.ticket)) : null;
            const closed = !!tr?.closed_at;
            const open = !!tr && !closed;
            const pnl = tr?.pnl != null ? Number(tr.pnl) : null;
            const reason = (tr?.reason as string | undefined) ?? '';
            const num = signals.length - i;
            const time = s.created_at ? new Date(s.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
            const win = closed && (pnl ?? 0) >= 0;
            const loss = closed && (pnl ?? 0) < 0;
            // signal émis mais JAMAIS exécuté (refus broker/risk) — afficher "placed" serait mensonger
            const rejected = !tr && s.status === 'rejected';
            const edge = open ? (long ? 'rgba(34,224,166,.6)' : 'rgba(255,107,138,.6)') : win ? 'rgba(34,224,166,.4)' : 'var(--border)';
            const rationale = Array.isArray(s.rationale) ? (s.rationale as string[]).join(' · ') : '';
            const k = s.ticket != null ? String(s.ticket) : '';
            return (
              <div key={s.id} className="cardIn" title={rejected ? `not executed — ${String(s.result_code ?? 'rejected')}` : rationale} style={{
                flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
                padding: '5px 10px', borderRadius: 8, border: `1px solid ${edge}`,
                background: open ? (long ? 'rgba(34,224,166,.07)' : 'rgba(255,107,138,.07)') : win ? 'rgba(34,224,166,.06)' : 'rgba(255,255,255,.012)',
                boxShadow: win ? '0 0 10px rgba(34,224,166,.12)' : undefined,
                opacity: loss || rejected ? 0.5 : 1, // pertes/refus atténués visuellement (toujours lisibles — relevé honnête), gains mis en avant
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
                    {!broadcast && (
                      <button onClick={() => fire('close-' + k, () => sendCommand('close_position', { ticket: k }))} title="close this position at market (without waiting for TP/SL)"
                        style={{ fontSize: 9.5, padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(255,107,138,.5)', background: lastFire === 'close-' + k ? 'rgba(255,107,138,.2)' : 'transparent', color: '#ff8aa2', cursor: 'pointer' }}>✕ close</button>
                    )}
                  </>
                ) : closed ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {reason && win && <span style={{ fontSize: 8.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(130,152,190,.15)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{reason}</span>}
                    {/* gain : vert franc + ✓ ; perte : rose sourd, discret (présent mais pas agressif) */}
                    <span style={{ fontSize: win ? 12 : 11, fontWeight: win ? 700 : 500, color: win ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{win ? '✓ +' : ''}{pnl != null ? pnl.toFixed(0) : '—'}$</span>
                  </span>
                ) : rejected ? (
                  <span style={{ fontSize: 10, color: 'rgba(210,150,165,.8)' }}>✗ not executed</span>
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
        <Metric label="Equity" value={st ? fmt(st.equity, 0) : '—'} accent="var(--blue)" spark={equityCurve} />
        {recap ? (
          <>
            {/* RECAP = relevé HONNÊTE de la période : un net négatif s'affiche (rose sourd), pas de tuile vide —
                c'est le track record qu'on raconte, il doit être crédible. Le vert des gains reste franc. */}
            <Metric label={`P&L · ${recapLabel}`} value={recapStats.n === 0 ? '—' : (recapStats.net >= 0 ? '+' : '') + recapStats.net.toFixed(0) + '$'} color={recapStats.n === 0 ? 'var(--dim)' : recapStats.net >= 0 ? 'var(--up)' : 'rgba(210,150,165,.85)'} accent={recapStats.net > 0 ? 'var(--up)' : 'var(--border)'} />
            <Metric label={`Win rate · ${recapStats.n}`} value={recapStats.n > 0 ? (recapStats.winPct * 100).toFixed(0) + '%' : '—'} color={recapStats.n > 0 && recapStats.winPct >= 0.5 ? 'var(--up)' : 'var(--dim)'} accent="var(--up)" />
            <Metric label={`Wins · ${recapLabel}`} value={recapStats.wins > 0 ? '✓ ' + recapStats.wins : '—'} color={recapStats.wins > 0 ? 'var(--up)' : 'var(--dim)'} accent="var(--cyan)" />
            <Metric label="Best trade" value={recapStats.best > 0 ? '+' + recapStats.best.toFixed(0) + '$' : '—'} gold={recapStats.best > 0} color="var(--dim)" accent="var(--gold)" />
          </>
        ) : (
          <>
            {/* règle broadcast 70/30 : un Day P&L rouge ou un win rate < 75% ne s'affichent pas (tuile neutre "—") */}
            <Metric label="Day P&L" value={dayPnl == null || dayPnl < 0 ? '—' : '+' + dayPnl.toFixed(0)} color={dayPnl != null && dayPnl >= 0 ? 'var(--up)' : 'var(--dim)'} accent={dayPnl != null && dayPnl >= 0 ? 'var(--up)' : 'var(--border)'} />
            <Metric label={`Win rate · ${stats.n}`} value={stats.ready && stats.winPct >= 0.75 ? (stats.winPct * 100).toFixed(0) + '%' : '—'} color={stats.ready && stats.winPct >= 0.75 ? 'var(--up)' : 'var(--dim)'} accent="var(--up)" />
            <Metric label="Wins today" value={winsToday > 0 ? '✓ ' + winsToday : '—'} color={winsToday > 0 ? 'var(--up)' : 'var(--dim)'} accent="var(--cyan)" />
            <Metric label="Best trade" value={bestToday > 0 ? '+' + bestToday.toFixed(0) + '$' : '—'} gold={bestToday > 0} color="var(--dim)" accent="var(--gold)" />
          </>
        )}
      </section>

      {/* ===== SCÈNE AUTOPILOT — plein écran par-dessus tout (à capturer dans OBS à la place de la caméra) ===== */}
      {autopilot && <Autopilot st={st} deskItems={deskItems} dayPnl={dayPnl} onExit={toggleAutopilot} />}
    </main>
  );
}

// Tuile métrique PREMIUM : surface en dégradé + liseré lumineux + halo d'accent dans le coin (matière, pas d'aplat).
// gold=true → valeur en OR MÉTALLIQUE (.goldText) pour le moment "Best trade".
function Metric({ label, value, color, accent, spark, gold }: { label: string; value: string; color?: string; accent?: string; spark?: number[]; gold?: boolean }) {
  const a = accent ?? 'var(--border)';
  return (
    <div
      style={{
        position: 'relative', overflow: 'hidden', borderRadius: 12, padding: '8px 13px',
        background: 'linear-gradient(180deg, rgba(26,41,72,.92) 0%, rgba(10,17,31,.96) 100%)',
        border: '1px solid rgba(130,152,190,.16)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.07), 0 6px 18px rgba(2,6,16,.35)',
      }}
    >
      {/* halo d'accent, coin haut-droit */}
      <span aria-hidden style={{ position: 'absolute', right: -30, top: -34, width: 120, height: 120, borderRadius: '50%', background: `radial-gradient(circle, color-mix(in srgb, ${a} 18%, transparent) 0%, transparent 68%)`, pointerEvents: 'none' }} />
      {spark && <Sparkline data={spark} />}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: a, boxShadow: `0 0 6px ${a}` }} />
        <span style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
      </div>
      <div className={gold ? 'goldText' : undefined} style={{ position: 'relative', fontSize: 19, fontWeight: 700, letterSpacing: 0.2, lineHeight: 1.25, marginTop: 1, ...(gold ? {} : { color: color ?? 'var(--text)' }) }}>{value}</div>
    </div>
  );
}

// Sparkline d'équity du jour : ligne + aire, en fond de carte. Règle broadcast 70/30 : une courbe
// DESCENDANTE ne se dessine pas (pas de rouge ni de pente négative à l'écran) — la tuile reste neutre.
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  if (data[data.length - 1] < data[0]) return null;
  const w = 100;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * h;
  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  const col = up ? 'var(--up)' : 'var(--down)';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={col} opacity={0.08} />
      <polyline points={line} fill="none" stroke={col} strokeWidth={1.4} opacity={0.55} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Barre MARCHÉS : un chip cliquable par symbole (prix live + sens + point si en position). Sert à la fois de
// switcher (le chip sélectionné pilote tout le cockpit) et d'aperçu multi-marché pour le live.
function MarketRail({ selected, onSelect, openBySym }: { selected: string; onSelect: (s: string) => void; openBySym: Record<string, { dir: string }> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {SYMS.map((s) => (
        <MarketChip key={s.key} spec={s} active={s.key === selected} pos={openBySym[s.key]} onClick={() => onSelect(s.key)} />
      ))}
    </div>
  );
}

function MarketChip({ spec, active, pos, onClick }: { spec: SymSpec; active: boolean; pos?: { dir: string }; onClick: () => void }) {
  const px = usePrice(spec.key);
  const { stale } = useFeedHealth();
  // Le week-end, BTC (24/7) garde le flux global vivant → un marché FERMÉ se grise individuellement,
  // sinon son prix figé aurait l'air vivant à côté du BTC qui tique.
  const closed = marketReopenMs(spec.key) != null;
  const col = stale || closed ? 'var(--dim)' : px && px.dir > 0 ? 'var(--up)' : px && px.dir < 0 ? 'var(--down)' : 'var(--text)';
  const arrow = px && px.dir > 0 ? '▲' : px && px.dir < 0 ? '▼' : '·';
  return (
    <button
      onClick={onClick}
      title={`${spec.label}${closed ? ' · closed' : ''}${pos ? ` · in ${pos.dir}` : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
        border: `1px solid ${active ? 'rgba(43,227,245,.5)' : 'var(--border)'}`,
        background: active ? 'rgba(43,227,245,.08)' : 'transparent',
        opacity: (stale || closed) && !active ? 0.6 : 1,
      }}
    >
      {pos && <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: pos.dir === 'long' ? 'var(--up)' : 'var(--down)' }} />}
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: active ? 'var(--text)' : 'var(--muted)' }}>{spec.short}</span>
      <span className="mono" style={{ fontSize: active ? 18 : 13, fontWeight: 600, color: col, lineHeight: 1 }}>{px ? px.mid.toFixed(spec.dp) : '—'}</span>
      {active && !stale && px && <span className="mono" style={{ fontSize: 11, color: col }}>{arrow}</span>}
    </button>
  );
}

// Watchdog du flux : LIVE (vert, pulse) tant que les ticks arrivent ; STALE Ns (ambre) si le flux se tait
// alors que le marché est ouvert ; OFFLINE (gris) pendant le gap week-end DU MARCHÉ AFFICHÉ (BTC 24/7 → jamais) ;
// CONNECTING avant le 1er tick.
function FeedStatus({ symbol }: { symbol: string }) {
  const { hasData, ageMs, stale } = useFeedHealth();
  const closed = marketReopenMs(symbol) != null;
  let color = 'var(--up)';
  let label = 'LIVE';
  let pulse = true;
  if (closed) {
    color = 'var(--dim)';
    label = 'OFFLINE';
    pulse = false;
  } else if (!hasData) {
    color = 'var(--gold)';
    label = 'CONNECTING';
    pulse = false;
  } else if (stale) {
    color = 'var(--gold)';
    label = `STALE ${Math.min(999, Math.floor(ageMs / 1000))}s`;
    pulse = false;
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color, letterSpacing: 1 }}>
      <span className={pulse ? 'pulse' : undefined} style={{ width: 6, height: 6, borderRadius: '50%', background: color }} /> {label}
    </span>
  );
}

// HUD position OUVERTE : P&L flottant / R / pips en direct (tick par tick), + mini-barre SL·entrée·TP.
// S'abonne au prix lui-même → seul ce composant se re-rend à chaque tick (pas tout le cockpit).
function LivePositionHud({ symbol, direction, entry, sl, tp, lot }: { symbol: string; direction: string; entry: number; sl: number | null; tp: number | null; lot: number }) {
  const px = usePrice(symbol);
  const spec = symSpec(symbol);
  const long = direction === 'long';
  const dir = long ? 1 : -1;
  const exit = px ? (long ? px.bid : px.ask) : entry; // on clôturerait au bid (long) / ask (short)
  const move = (exit - entry) * dir; // distance en notre faveur (prix)
  const pnl = move * lot * spec.contract;
  const pips = move / spec.pip;
  const rr = sl != null && Math.abs(entry - sl) > 1e-9 ? move / Math.abs(entry - sl) : null;
  // Règle broadcast 70/30 : un drawdown FLOTTANT (temporaire par nature) s'affiche en rose SOURD, pas en
  // rouge vif — même traitement discret que les pertes clôturées. Le vert des gains reste franc.
  const col = pnl > 0 ? 'var(--up)' : pnl < 0 ? 'rgba(210,150,165,.75)' : 'var(--muted)';
  return (
    <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: long ? 'rgba(31,216,176,.15)' : 'rgba(255,107,138,.15)', color: long ? 'var(--up)' : 'var(--down)' }}>
        {long ? '▲ LONG' : '▼ SHORT'}
      </span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{lot.toFixed(2)} @ {entry.toFixed(spec.dp)}</span>
      <span style={{ fontSize: 11, color: 'var(--dim)' }}>→</span>
      <span style={{ fontSize: 12, color: 'var(--text)' }}>{px ? exit.toFixed(spec.dp) : '—'}</span>
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

// Libellés features — miroir de lib/engine/trade.ts (LABELS) pour nommer les contributions de confluence.
const FEATURE_LABELS: Record<string, string> = {
  emaStack: 'EMA trend',
  macd: 'MACD momentum',
  rsiPullback: 'RSI pullback',
  srZone: 'S/R zone',
  divergence: 'divergence',
  liquiditySweep: 'liquidity sweep',
  roundLevel: 'round level',
};

const whyOverlay: CSSProperties = {
  position: 'absolute',
  left: 14,
  bottom: 34,
  zIndex: 6,
  width: 262, // assez large pour "liquidity sweep" en entier (retour live : les labels tronqués "…" font cheap)
  padding: '9px 11px',
  borderRadius: 10,
  background: 'rgba(8,16,31,.82)',
  border: '1px solid var(--border)',
  boxShadow: '0 8px 24px rgba(3,8,18,.5)',
  backdropFilter: 'blur(6px)',
  pointerEvents: 'none',
};

// Panneau « WHY THIS TRADE » : décompose la confluence du signal en barres pondérées par feature
// (vert = haussier, rouge = baissier, longueur ∝ |poids|) + jauge de confiance. Data-driven, pas de texte parsé
// (seule exception : session/régime relus depuis la dernière ligne du rationale, format contrôlé par buildRationale).
function WhyPanel({ direction, conf, rationale, live, closed = false, pnl = null, onClose }: { direction: string; conf: any; rationale?: unknown; live: boolean; closed?: boolean; pnl?: number | null; onClose?: () => void }) {
  const contribs: any[] = Array.isArray(conf?.contributions) ? conf.contributions : [];
  if (!contribs.length) return null;
  // Contexte marché AU MOMENT DU TIR — la décision ne repose pas que sur les votes : alignement des features
  // et qualité du marché (ADX + vol) multiplient le score, session/régime cadrent le setup. Tout est déjà calculé.
  const meta = Array.isArray(rationale) ? String(rationale[rationale.length - 1] ?? '') : '';
  const sessRegime = meta.match(/Session (\w+) · (\w+)/);
  const qualityChips: string[] = [];
  if (sessRegime) qualityChips.push(sessRegime[1].toUpperCase(), sessRegime[2].toUpperCase());
  const alignment = Number(conf?.alignment);
  const quality = Number(conf?.quality);
  if (Number.isFinite(alignment) && alignment > 0) qualityChips.push(`ALIGN ${Math.round(alignment * 100)}%`);
  if (Number.isFinite(quality) && quality > 0) qualityChips.push(`ADX·VOL ${Math.round(quality * 100)}%`);
  const top = [...contribs].sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted)).slice(0, 6);
  const maxW = Math.max(0.01, ...top.map((c) => Math.abs(Number(c.weighted) || 0)));
  const confidence = Math.max(0, Math.min(1, Number(conf?.confidence) || 0));
  const long = direction === 'long';
  // Cohérence live : si le setup est CLÔTURÉ, on affiche le résultat et — en cas de perte — on DÉSATURE les barres
  // (fini le "setup tout vert" à côté d'un −$). En gain, on garde le vert franc.
  const lost = closed && (pnl ?? 0) < 0;
  const won = closed && (pnl ?? 0) >= 0;
  const label = live ? 'WHY THIS TRADE' : won ? '✓ WINNING SETUP' : lost ? 'SETUP CLOSED' : 'LAST SETUP';
  const barCol = (bull: boolean) => (lost ? 'rgba(150,160,180,.5)' : bull ? 'var(--up)' : 'var(--down)');
  return (
    <div className="mono" style={{ ...whyOverlay, opacity: lost ? 0.72 : 1 }}>
      {onClose && (
        <button onClick={onClose} title="close" aria-label="close" style={{ position: 'absolute', top: 3, right: 4, width: 18, height: 18, lineHeight: '16px', textAlign: 'center', padding: 0, borderRadius: 5, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', color: 'var(--muted)', cursor: 'pointer', pointerEvents: 'auto', fontSize: 12 }}>×</button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7, paddingRight: 16 }}>
        <span style={{ fontSize: 9.5, letterSpacing: 1, color: lost ? 'var(--muted)' : 'var(--cyan)', opacity: 0.9 }}>{label}</span>
        {closed
          ? <span style={{ fontSize: 9.5, fontWeight: 700, color: won ? 'var(--up)' : 'rgba(210,150,165,.8)' }}>{won ? '+' : ''}{pnl != null ? pnl.toFixed(0) : '—'}$</span>
          : <span style={{ fontSize: 9.5, fontWeight: 700, color: long ? 'var(--up)' : 'var(--down)' }}>{long ? '▲ LONG' : '▼ SHORT'}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: 'var(--dim)' }}>conf</span>
        <span style={{ position: 'relative', flex: 1, height: 5, borderRadius: 3, background: 'rgba(130,152,190,.18)' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(confidence * 100)}%`, borderRadius: 3, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' }} />
        </span>
        <span style={{ fontSize: 9.5, color: 'var(--text)' }}>{Math.round(confidence * 100)}%</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {top.map((c, i) => {
          const w = Number(c.weighted) || 0;
          const bull = w >= 0;
          const frac = Math.min(1, Math.abs(w) / maxW);
          return (
            <div key={c.key ?? i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9.5, color: 'var(--muted)', width: 96, whiteSpace: 'nowrap' }}>{FEATURE_LABELS[c.key] ?? c.key}</span>
              <span style={{ position: 'relative', flex: 1, height: 5, background: 'rgba(130,152,190,.12)', borderRadius: 3 }}>
                <span style={{ position: 'absolute', left: '50%', top: -1, bottom: -1, width: 1, background: 'rgba(130,152,190,.35)' }} />
                <span style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: 2, background: barCol(bull), left: bull ? '50%' : `${50 - frac * 50}%`, width: `${frac * 50}%` }} />
              </span>
              <span style={{ fontSize: 9, color: barCol(bull), width: 30, textAlign: 'right' }}>{bull ? '+' : ''}{w.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
      {qualityChips.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 8, paddingTop: 7, borderTop: '1px solid rgba(130,152,190,.14)' }}>
          <span style={{ fontSize: 8, color: 'var(--dim)', letterSpacing: 0.8 }}>MARKET</span>
          {qualityChips.map((chip) => (
            <span key={chip} style={{ fontSize: 8, letterSpacing: 0.6, color: lost ? 'var(--muted)' : 'rgba(160,215,235,.85)', padding: '2px 5px', borderRadius: 4, border: '1px solid rgba(130,152,190,.2)', background: 'rgba(43,227,245,.05)' }}>{chip}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// Gap week-end (or/indices : vendredi 21h UTC → dimanche 22h UTC). Les marchés 24/7 (BTC) ne ferment JAMAIS
// → null en permanence : le statut est calculé PAR MARCHÉ, pas globalement.
function marketReopenMs(symbol: string): number | null {
  if (symSpec(symbol).h24) return null;
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

function MarketStatus({ symbol, session, regime, tradable }: { symbol: string; session?: string; regime?: string; tradable: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((x) => x + 1), 20000);
    return () => clearInterval(i);
  }, []);
  const reopen = marketReopenMs(symbol);
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

// Toasts d'alerte trade : pop animé à chaque ENTRÉE (signal rempli) / SORTIE (trade clôturé), hors BEAST.
// Seed sur le premier lot non vide → pas de spam du backlog au chargement ; auto-dismiss ~4.8s ; cap 4 à l'écran.
type Toast = { id: string; accent: string; icon: string; title: string; sub: string; big?: string };
function TradeAlerts({ signals, trades, rafaleTickets }: { signals: any[]; trades: any[]; rafaleTickets: Set<string> }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenSig = useRef<Set<string>>(new Set());
  const seenClose = useRef<Set<string>>(new Set());
  const initSig = useRef(false);
  const initClose = useRef(false);
  const timers = useRef<number[]>([]);

  const push = (t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((l) => [...l, { ...t, id }].slice(-4));
    timers.current.push(window.setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 4800));
  };
  useEffect(() => () => timers.current.forEach((h) => window.clearTimeout(h)), []);

  // ENTRÉES : nouveaux signaux remplis (ticket présent), hors BEAST/rafale.
  useEffect(() => {
    if (!signals.length) return;
    if (!initSig.current) {
      signals.forEach((s) => seenSig.current.add(String(s.id)));
      initSig.current = true;
      return;
    }
    for (const s of [...signals].reverse()) {
      const key = String(s.id);
      if (seenSig.current.has(key)) continue;
      seenSig.current.add(key);
      if (s.ticket == null || rafaleTickets.has(String(s.ticket))) continue;
      if (/RAFALE/i.test(Array.isArray(s.rationale) ? s.rationale.join(' ') : '')) continue;
      const long = s.direction === 'long';
      push({ accent: long ? 'var(--up)' : 'var(--down)', icon: long ? '▲' : '▼', title: long ? 'LONG FILLED' : 'SHORT FILLED', sub: `${fmt(s.lot)} @ ${fmt(s.entry, 1)}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals]);

  // SORTIES : trades clôturés, hors BEAST/rafale.
  useEffect(() => {
    if (!trades.length) return;
    const closed = trades.filter((t) => t.closed_at != null);
    if (!initClose.current) {
      closed.forEach((t) => seenClose.current.add(String(t.ticket)));
      initClose.current = true;
      return;
    }
    for (const t of [...closed].reverse()) {
      const key = String(t.ticket);
      if (seenClose.current.has(key)) continue;
      seenClose.current.add(key);
      if (rafaleTickets.has(key)) continue;
      const pnl = t.pnl != null ? Number(t.pnl) : 0;
      if (pnl < 0) continue; // toasts = highlight reel : on ne POP pas les pertes (le relevé honnête reste dans le bandeau + les stats). Les gains, eux, sont célébrés.
      const r = t.r != null && Number.isFinite(Number(t.r)) ? Number(t.r) : null;
      const reason = String(t.reason ?? '').toLowerCase();
      const title = /tp|take/.test(reason) ? '🎯 TAKE PROFIT' : '✓ WIN';
      push({ accent: 'var(--up)', icon: '✓', title, sub: r != null ? `${r >= 0 ? '+' : ''}${r.toFixed(2)}R` : String(t.direction ?? '').toUpperCase(), big: `+${pnl.toFixed(0)}$` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades]);

  if (!toasts.length) return null;
  return (
    <div style={{ position: 'fixed', top: 66, right: 16, zIndex: 120, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {toasts.map((t) => (
        <div key={t.id} className="toastIn panel" style={{ width: 248, padding: '9px 12px', borderLeft: `3px solid ${t.accent}`, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(14,27,51,.97)' }}>
          <span style={{ fontSize: 16, color: t.accent }}>{t.icon}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: t.accent, letterSpacing: 0.3 }}>{t.title}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{t.sub}</span>
          </div>
          {t.big && <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: t.accent }}>{t.big}</span>}
        </div>
      ))}
    </div>
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

// Icône déconnexion (porte + flèche sortante) — remplace le glyphe ⎋ ambigu.
function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 5V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-1" />
      <path d="M3 10h9M9 7l3 3-3 3" />
    </svg>
  );
}

const onAirBtn: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  padding: '4px 11px',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#ff8aa2',
  background: 'rgba(255,107,138,.14)',
  border: '1px solid rgba(255,107,138,.5)',
};

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
