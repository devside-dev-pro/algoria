// 🛡️ LA DÉCISION DES GARDE-FOUS DU MASTER, sans aucun effet de bord (voir runner/guard.ts pour le pourquoi et
// l'exécution). Séparée pour pouvoir la rejouer sur les positions de n'importe quelle nuit, sans broker ni base.

/** Les seuils validés par Mathieu le 22/10. Réglables sans redéploiement : support_settings 'guard_config' (JSON
 *  partiel, ex. {"dayLossPct":0.15}), relu chaque minute par le runner — voir readGuardConfig. */
export const GUARD = {
  maxOpen: 10,
  safetyAfterMs: 2 * 60_000,
  safetyGoldUsd: 25,
  safetyOtherPct: 0.02,
  dayLossPct: 0.05,
  /** la perte doit TENIR ce temps avant la coupure : l'équité lue chez le broker fait des sauts (pause de 22 h UTC,
   *  écart qui s'ouvre, valeur figée) — mesuré sur septembre-octobre, des « −20 % » d'une seule minute sans position */
  cutPersistMs: 90_000,
  loopCloses: 5,
  loopWindowMs: 10 * 60_000,
  everyMs: 5_000,
};
export type GuardConfig = typeof GUARD;

/** JSON de support_settings → config bornée (une valeur absurde ne doit jamais désarmer un garde-fou). */
export function readGuardConfig(raw: string | null | undefined): GuardConfig {
  let o: Partial<Record<keyof GuardConfig, unknown>> = {};
  try { o = raw ? (JSON.parse(raw) as typeof o) : {}; } catch { o = {}; }
  const num = (k: keyof GuardConfig, lo: number, hi: number) => {
    const v = Number(o[k]);
    return Number.isFinite(v) && v >= lo && v <= hi ? v : GUARD[k];
  };
  return {
    ...GUARD,
    maxOpen: Math.round(num('maxOpen', 1, 100)),
    safetyAfterMs: num('safetyAfterMs', 10_000, 30 * 60_000),
    safetyGoldUsd: num('safetyGoldUsd', 3, 200),
    safetyOtherPct: num('safetyOtherPct', 0.002, 0.2),
    dayLossPct: num('dayLossPct', 0.01, 0.5),
    cutPersistMs: num('cutPersistMs', 0, 10 * 60_000),
  };
}

export interface GuardPos { id: string; symbol: string; long: boolean; entry: number; price: number; sl: number; tp: number; openedAt: number }
export interface GuardPlan { trip: string | null; breach: boolean; close: Array<{ id: string; why: string }>; stops: Array<{ id: string; sl: number; tp: number }> }

const isGold = (symbol: string) => /XAU|GOLD/i.test(symbol);
const decimals = (x: number) => Math.min(5, Math.max(2, (String(x).split('.')[1] ?? '').length));
const roundTo = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Le stop de secours d'une position : 25 $ sur l'or, 2 % du prix d'entrée ailleurs, du côté de la perte. */
export function safetyStop(p: Pick<GuardPos, 'symbol' | 'long' | 'entry'>, cfg: GuardConfig = GUARD): number {
  const dist = isGold(p.symbol) ? cfg.safetyGoldUsd : p.entry * cfg.safetyOtherPct;
  return roundTo(p.long ? p.entry - dist : p.entry + dist, decimals(p.entry));
}

/** LA DÉCISION : quoi fermer, quels stops poser, faut-il verrouiller la journée.
 *  `breachSince` = depuis quand l'équité est sous le seuil (null si elle ne l'est pas) : la coupure n'a lieu que si
 *  ça dure cutPersistMs. Sans position ouverte, l'équité ne compte pas (elle devrait égaler le solde). */
export function planGuard(o: { positions: GuardPos[]; now: number; equity: number | null; dayStart: number | null; locked: boolean; breachSince: number | null; cfg?: GuardConfig }): GuardPlan {
  const cfg = o.cfg ?? GUARD;
  const plan: GuardPlan = { trip: null, breach: false, close: [], stops: [] };
  plan.breach = o.positions.length > 0 && o.equity != null && o.dayStart != null && o.dayStart > 0 && o.equity <= o.dayStart * (1 - cfg.dayLossPct);
  if (!o.locked && plan.breach && o.breachSince != null && o.now - o.breachSince >= cfg.cutPersistMs) {
    plan.trip = `equity ${Math.round(o.equity!)} $ is ${(100 * (1 - o.equity! / o.dayStart!)).toFixed(1)} % below the day's start (${Math.round(o.dayStart!)} $)`;
  }
  if (o.locked || plan.trip) {
    plan.close = o.positions.map((p) => ({ id: p.id, why: plan.trip ? 'daily cut' : 'day locked' }));
    return plan;
  }
  const byAge = [...o.positions].sort((a, b) => a.openedAt - b.openedAt);
  const extra = byAge.slice(cfg.maxOpen);
  for (const p of extra) plan.close.push({ id: p.id, why: `more than ${cfg.maxOpen} positions open` });
  const closing = new Set(extra.map((p) => p.id));
  for (const p of byAge) {
    if (closing.has(p.id) || p.sl > 0 || o.now - p.openedAt < cfg.safetyAfterMs) continue;
    const sl = safetyStop(p, cfg);
    const beyond = p.long ? p.price <= sl : p.price >= sl;
    if (beyond) plan.close.push({ id: p.id, why: 'no stop in time, already past the safety distance' });
    else plan.stops.push({ id: p.id, sl, tp: p.tp });
  }
  return plan;
}
