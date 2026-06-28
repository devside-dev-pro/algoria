'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client';
import { subscribeTicks } from './tickStore';

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

/** Desk ALGORIA AI : commentaires/opportunités/trades (events level='ai'), du plus récent au plus ancien. */
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
        if (alive && data) setItems(data);
      });
    const ch = supabase
      .channel('rt-desk')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: 'level=eq.ai' }, ({ new: e }) =>
        setItems((p) => [e as Row, ...p].slice(0, limit)),
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [limit]);
  return items;
}

/** Prix live (broadcast runner) pour le ticker du header. `dir` = sens du dernier mouvement. */
export function usePrice() {
  const [px, setPx] = useState<{ bid: number; ask: number; mid: number; dir: -1 | 0 | 1 } | null>(null);
  useEffect(() => {
    let prev = 0;
    supabase
      .from('candles')
      .select('close')
      .eq('symbol', 'XAUUSD')
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
    });
  }, []);
  return px;
}

/** Cockpit → runner (mode pills, kill switch). */
export const sendCommand = (type: string, payload?: unknown) => supabase.from('commands').insert({ type, payload: (payload ?? null) as never });
