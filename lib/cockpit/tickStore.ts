import { supabase } from '../supabase/client';

// Store de prix live partagé : UNE seule souscription au broadcast runner, plusieurs consommateurs
// (header price ticker + mission control). Évite d'ouvrir 2 canaux Supabase pour le même flux.
export interface Tick {
  bid: number;
  ask: number;
  t: number;
}

let latest: Tick | null = null;
const listeners = new Set<(t: Tick) => void>();
let started = false;

function ensureStarted() {
  if (started) return;
  started = true;
  supabase
    .channel('algoria-ticks')
    .on('broadcast', { event: 'tick' }, ({ payload }) => {
      latest = payload as Tick;
      for (const l of listeners) l(latest);
    })
    .subscribe();
}

/** Abonne un listener au flux de prix. Renvoie la fonction de désabonnement. */
export function subscribeTicks(cb: (t: Tick) => void): () => void {
  ensureStarted();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const getLatestTick = () => latest;
