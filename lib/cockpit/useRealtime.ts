'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase/client';
import { subscribeTicks, getLatestTick } from './tickStore';

type Row = Record<string, unknown>;

/** Terminal ALGORIA AI : seed des N derniers events + abonnement aux inserts. */
export function useEvents(limit = 60) {
  const [events, setEvents] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    supabase
      .from('events')
      .select('*')
      .order('ts', { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (alive && data) setEvents([...data].reverse());
      });
    const ch = supabase
      .channel('rt-events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, ({ new: e }) =>
        setEvents((p) => [...p.slice(-limit + 1), e as Row]),
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [limit]);
  return events;
}

/** Cartes de signaux. */
export function useSignals(limit = 12) {
  const [signals, setSignals] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (alive && data) setSignals(data);
      });
    const ch = supabase
      .channel('rt-signals')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals' }, ({ new: s }) =>
        setSignals((p) => [s as Row, ...p].slice(0, limit)),
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [limit]);
  return signals;
}

/** Barre haute + risk panel : dernier snapshot. */
export function useLatestState() {
  const [state, setState] = useState<Row | null>(null);
  useEffect(() => {
    let alive = true;
    supabase
      .from('state_snapshots')
      .select('*')
      .order('ts', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (alive && data?.[0]) setState(data[0]);
      });
    const ch = supabase
      .channel('rt-state')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'state_snapshots' }, ({ new: s }) => setState(s as Row))
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return state;
}

/** Desk ALGORIA AI : commentaires/opportunités/trades/recaps (events level='ai'), du plus récent au plus ancien.
 * TOUS les marchés entrelacés (chaque event porte data.symbol) — le composant Desk badge chaque carte
 * et choisit le hero du marché sélectionné. */
export function useDesk(limit = 10) {
  const [items, setItems] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    supabase
      .from('events')
      .select('*')
      .eq('level', 'ai')
      .order('ts', { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (alive && data) setItems(data as Row[]);
      });
    const ch = supabase
      .channel('rt-desk')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: 'level=eq.ai' }, ({ new: e }) => {
        setItems((p) => [e as Row, ...p].slice(0, limit));
      })
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [limit]);
  return items;
}

/** Prix live (broadcast runner) d'UN symbole pour le ticker/HUD. `dir` = sens du dernier mouvement. */
export function usePrice(symbol = 'XAUUSD') {
  const [px, setPx] = useState<{ bid: number; ask: number; mid: number; dir: -1 | 0 | 1 } | null>(null);
  useEffect(() => {
    setPx(null); // reset au changement de symbole
    let prev = 0;
    supabase
      .from('candles')
      .select('close')
      .eq('symbol', symbol)
      .eq('timeframe', 'M5')
      .order('time', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const c = (data?.[0] as { close?: number } | undefined)?.close;
        if (typeof c === 'number') {
          prev = c;
          setPx((q) => q ?? { bid: c, ask: c, mid: c, dir: 0 });
        }
      });
    return subscribeTicks((t) => {
      const mid = (t.bid + t.ask) / 2;
      const dir = mid > prev ? 1 : mid < prev ? -1 : 0;
      prev = mid;
      setPx({ bid: t.bid, ask: t.ask, mid, dir });
    }, symbol);
  }, [symbol]);
  return px;
}

/** Trades (ouvertures + clôtures) → corrélés aux signaux : statut ouvert/fermé, P&L, raison. Refetch sur tout changement. */
export function useTrades(limit = 60) {
  const [trades, setTrades] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      supabase
        .from('trades')
        .select('*')
        .order('opened_at', { ascending: false, nullsFirst: false })
        .limit(limit)
        .then(({ data }) => {
          if (alive && data) setTrades(data);
        });
    void load();
    const ch = supabase
      .channel('rt-trades')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => void load())
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [limit]);
  return trades;
}

/** Équity au DÉBUT du jour UTC (1er snapshot du jour) → day P&L correct, insensible aux redémarrages du runner. */
export function useDayStartEquity() {
  const [eq, setEq] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    supabase
      .from('state_snapshots')
      .select('equity')
      .gte('ts', midnight.toISOString())
      .order('ts', { ascending: true })
      .limit(1)
      .then(({ data }) => {
        if (alive && data?.[0]) setEq(Number((data[0] as { equity: number }).equity));
      });
    return () => {
      alive = false;
    };
  }, []);
  return eq;
}

/** Courbe d'équity du JOUR (points equity, ordre chronologique) → sparkline. Seed depuis minuit + live. */
export function useEquityCurve(maxPoints = 160) {
  const [curve, setCurve] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    supabase
      .from('state_snapshots')
      .select('equity, ts')
      .gte('ts', midnight.toISOString())
      .order('ts', { ascending: true })
      .limit(1000)
      .then(({ data }) => {
        if (!alive || !data) return;
        const pts = data.map((d) => Number((d as { equity: number }).equity)).filter(Number.isFinite);
        setCurve(pts.slice(-maxPoints));
      });
    const ch = supabase
      .channel('rt-equity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'state_snapshots' }, ({ new: s }) => {
        const e = Number((s as { equity?: number }).equity);
        if (Number.isFinite(e)) setCurve((c) => [...c, e].slice(-maxPoints));
      })
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [maxPoints]);
  return curve;
}

/** Watchdog du flux de prix : temps écoulé depuis le DERNIER tick reçu (horloge CLIENT → insensible au
 * décalage serveur). Re-render chaque seconde pour rafraîchir l'âge. `stale` = flux muet trop longtemps. */
export function useFeedHealth(staleMs = 12000) {
  const lastRecv = useRef<number>(getLatestTick() ? Date.now() : 0);
  const [, bump] = useState(0);
  useEffect(() => {
    const unsub = subscribeTicks(() => {
      lastRecv.current = Date.now();
    });
    const iv = setInterval(() => bump((x) => (x + 1) % 1_000_000), 1000);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, []);
  const last = lastRecv.current;
  const ageMs = last > 0 ? Date.now() - last : Infinity;
  return { hasData: last > 0, ageMs, stale: last > 0 && ageMs > staleMs };
}

/** Cockpit → runner (mode pills, kill switch). On AWAIT : sinon supabase-js n'envoie jamais la requête. */
export async function sendCommand(type: string, payload?: unknown) {
  const { error } = await supabase.from('commands').insert({ type, payload: (payload ?? null) as never });
  if (error) console.error('[algoria] sendCommand échec:', error.message);
}
