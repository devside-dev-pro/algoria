import { supabase } from '../supabase/client';

// Store de prix live partagé : UNE seule souscription au broadcast runner, plusieurs consommateurs.
// Les ticks sont TAGUÉS par symbole (cockpit multi-symbole) → on garde le dernier tick PAR symbole et
// on route vers les listeners abonnés à ce symbole (ou à tous, pour le watchdog de flux).
export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  t: number;
}

const latest = new Map<string, Tick>();
let latestAny: Tick | null = null;
const listeners = new Set<{ symbol?: string; cb: (t: Tick) => void }>();
let started = false;

function ensureStarted() {
  if (started) return;
  started = true;
  supabase
    .channel('algoria-ticks')
    .on('broadcast', { event: 'tick' }, ({ payload }) => {
      const raw = payload as Partial<Tick>;
      if (typeof raw?.bid !== 'number' || typeof raw?.ask !== 'number') return;
      const t: Tick = { symbol: raw.symbol ?? 'XAUUSD', bid: raw.bid, ask: raw.ask, t: raw.t ?? Date.now() }; // legacy (sans symbole) → or
      latest.set(t.symbol, t);
      latestAny = t;
      for (const l of listeners) if (!l.symbol || l.symbol === t.symbol) l.cb(t);
    })
    .subscribe();
}

/** Abonne un listener au flux de prix. `symbol` optionnel : si omis, reçoit TOUS les symboles (watchdog). */
export function subscribeTicks(cb: (t: Tick) => void, symbol?: string): () => void {
  ensureStarted();
  const entry = { symbol, cb };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}

/** Dernier tick d'un symbole, ou (sans argument) le dernier tick tous symboles confondus — pour le watchdog. */
export const getLatestTick = (symbol?: string) => (symbol ? latest.get(symbol) ?? null : latestAny);
