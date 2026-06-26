'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useEvents } from '@/lib/cockpit/useRealtime';
import { TAG_COLOR, pickLine, type Feed } from '@/lib/cockpit/telemetry';

interface Line { id: number; tag: string; text: string; color: string; glow?: boolean; t: number }

const BUFFER = 150;
const TICK_MS = 180; // ~5-6 lignes / seconde

// niveau d'event moteur → tag/couleur dans le flux
const EVENT_TAG: Record<string, { tag: string; color: string; glow?: boolean }> = {
  ai: { tag: 'AI', color: TAG_COLOR.AI, glow: true },
  signal: { tag: 'SIGNAL', color: TAG_COLOR.SIGNAL, glow: true },
  order: { tag: 'EXEC', color: TAG_COLOR.EXEC, glow: true },
  veto: { tag: 'VETO', color: TAG_COLOR.VETO },
  info: { tag: 'ENGINE', color: TAG_COLOR.ENGINE },
  scan: { tag: 'ENGINE', color: '#4fb8ff' },
};

export function Telemetry({ state, signals }: { state: any; signals: any[] }) {
  const events = useEvents(50);
  const [lines, setLines] = useState<Line[]>([]);
  const [live, setLive] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);

  const feed = useRef<Feed>({
    mid: 4540, bid: 4539.8, ask: 4540.2, spread: 0.4, dPx: 0, dPct: 0, velocity: 0, ticks: 0, vwap: 4540, up: true,
    session: 'closed', regime: 'range', tradable: false, emaBias: 'flat',
    atr: 4, atrPct: 50, adx: 18, equity: 10000, balance: 10000, dayPnL: 0, openPositions: 0, openRiskPct: 0,
    mode: 'normal', killed: false, uptimeMs: 0, feedLagMs: 42, live: false,
  });
  const lastRealAt = useRef(0);
  const mounted = useRef(Date.now());
  const seen = useRef({ sum: 0, n: 0 });
  const lastEventId = useRef(-1);
  const lastSignalKey = useRef('');

  const push = (tag: string, text: string, color: string, glow?: boolean) => {
    const ln: Line = { id: idRef.current++, tag, text, color, glow, t: Date.now() };
    setLines((p) => (p.length >= BUFFER ? [...p.slice(p.length - BUFFER + 1), ln] : [...p, ln]));
  };

  // seed du prix depuis la dernière bougie (réaliste même sans runner)
  useEffect(() => {
    supabase
      .from('candles')
      .select('close')
      .eq('symbol', 'XAUUSD')
      .eq('timeframe', 'M5')
      .order('time', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const c = (data?.[0] as any)?.close;
        if (typeof c === 'number') {
          const f = feed.current;
          f.mid = c; f.bid = c - f.spread / 2; f.ask = c + f.spread / 2; f.vwap = c;
        }
      });
  }, []);

  // prix LIVE réel (broadcast depuis le runner) → ancre le flux
  useEffect(() => {
    const ch = supabase
      .channel('algoria-ticks')
      .on('broadcast', { event: 'tick' }, ({ payload }) => {
        const p = payload as { bid: number; ask: number; t: number };
        const f = feed.current;
        const mid = (p.bid + p.ask) / 2;
        const prev = f.mid;
        f.bid = p.bid; f.ask = p.ask; f.spread = Math.max(0, p.ask - p.bid);
        f.dPx = mid - prev; f.dPct = prev ? ((mid - prev) / prev) * 100 : 0; f.up = mid >= prev;
        f.mid = mid; f.ticks++; f.velocity = f.dPx;
        const s = seen.current; s.sum += mid; s.n++; f.vwap = s.sum / s.n;
        f.feedLagMs = Math.max(8, Date.now() - p.t);
        lastRealAt.current = Date.now();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // dernier snapshot moteur → modèle de flux
  useEffect(() => {
    if (!state) return;
    const f = feed.current;
    f.session = state.session ?? f.session;
    f.regime = state.regime ?? f.regime;
    f.tradable = !!state.tradable;
    f.atr = state.atr ?? f.atr;
    f.atrPct = (state.atr_percentile ?? 0.5) * 100;
    f.adx = state.adx ?? f.adx;
    f.equity = state.equity ?? f.equity;
    f.balance = state.balance ?? f.balance;
    f.dayPnL = state.day_pnl ?? f.dayPnL;
    f.openPositions = state.open_positions ?? 0;
    f.openRiskPct = state.open_risk_pct ?? 0;
    f.mode = state.mode ?? f.mode;
    f.killed = !!state.killed;
  }, [state]);

  // events moteur réels (incl. narration Claude) injectés dès leur arrivée
  useEffect(() => {
    for (const e of events as any[]) {
      const id = Number(e.id);
      if (!Number.isFinite(id) || id <= lastEventId.current) continue;
      lastEventId.current = Math.max(lastEventId.current, id);
      if (e.level === 'ai') {
        // la matière complète vit dans le desk ALGORIA — ici juste un "ping" lumineux dans le flux
        const kind = (e.data?.kind as string) ?? 'note';
        push('AI', `◆ ALGORIA desk · ${kind} ↗`, TAG_COLOR.AI, true);
        continue;
      }
      const map = EVENT_TAG[e.level as string] ?? { tag: 'ENGINE', color: TAG_COLOR.ENGINE };
      push(map.tag, e.msg, map.color, map.glow);
    }
  }, [events]);

  // signaux réels → ligne EXEC
  useEffect(() => {
    const s = signals?.[0] as any;
    if (!s) return;
    const key = String(s.id ?? s.ref ?? s.created_at);
    if (key === lastSignalKey.current) return;
    lastSignalKey.current = key;
    const long = s.direction === 'long';
    push(
      'EXEC',
      `▶ ${String(s.direction).toUpperCase()} XAUUSD ${s.lot}lot @${Number(s.entry).toFixed(1)} sl ${Number(s.stop_loss).toFixed(1)} tp ${Number(s.take_profits?.[0]).toFixed(1)} → route(master)`,
      long ? TAG_COLOR.SIGNAL : TAG_COLOR.VETO,
      true,
    );
  }, [signals]);

  // le firehose
  useEffect(() => {
    const iv = setInterval(() => {
      const f = feed.current;
      const now = Date.now();
      f.uptimeMs = now - mounted.current;
      const isLive = now - lastRealAt.current < 2800;
      if (isLive !== f.live) { f.live = isLive; setLive(isLive); }
      if (!isLive) {
        // micro-marche aléatoire autour du dernier mid → le flux respire sans le runner
        const step = (Math.random() - 0.5) * Math.max(0.02, f.atr * 0.01);
        const prev = f.mid;
        const mid = Math.max(1, prev + step);
        f.dPx = mid - prev; f.dPct = prev ? ((mid - prev) / prev) * 100 : 0; f.up = mid >= prev;
        f.mid = mid; f.bid = mid - f.spread / 2; f.ask = mid + f.spread / 2; f.ticks++; f.velocity = f.dPx;
        const s = seen.current; s.sum += mid; s.n++; f.vwap = s.sum / s.n;
        f.feedLagMs = 38 + ((Math.random() * 16) | 0);
      }
      const { tag, text } = pickLine(f);
      push(tag, text, TAG_COLOR[tag] ?? 'var(--muted)');
    }, TICK_MS);
    return () => clearInterval(iv);
  }, []);

  // auto-scroll bas
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section className="panel mono" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
        <span style={{ color: 'var(--cyan)' }}>ALGORIA&nbsp;AI · mission&nbsp;control</span>
        <span className={live ? 'pulse' : ''} style={{ color: live ? 'var(--up)' : 'var(--dim)', fontSize: 10.5, letterSpacing: 0.5 }}>{live ? '● LIVE FEED' : '◌ SIM FEED'}</span>
      </div>
      <div ref={scroller} style={{ padding: '6px 10px', fontSize: 11, lineHeight: 1.5, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {lines.map((l) => (
          <div key={l.id} style={{ whiteSpace: 'nowrap', textShadow: l.glow ? `0 0 8px ${l.color}` : undefined }}>
            <span style={{ color: 'var(--dim)', display: 'inline-block', width: 92 }}>
              {new Date(l.t).toLocaleTimeString('en-GB')}.{String(l.t % 1000).padStart(3, '0')}
            </span>
            <span style={{ color: l.color, opacity: 0.9, display: 'inline-block', width: 56 }}>{l.tag}</span>
            <span style={{ color: l.glow ? l.color : 'var(--text)' }}>{l.text}</span>
          </div>
        ))}
        <span className="blink" style={{ color: 'var(--cyan)' }}>▌</span>
      </div>
    </section>
  );
}
