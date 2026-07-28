import { readFileSync, existsSync } from 'node:fs';
// TEST DE PARITÉ SIM ↔ LIVE — le juge du juge (étude 28/07, demande Mathieu : « les backtests ne
// correspondent pas à la réalité »). On rejoue le simulateur sur les bougies RÉELLES de la période live
// et on compare JOUR PAR JOUR avec ce que le compte a réellement fait (fixture fixtures/live-daily.json,
// extraite de la table trades). Deux issues :
//   · sim ≈ live  → le simulateur est honnête ; les écarts backtest/réalité = régime de marché.
//   · sim ≫ live  → le simulateur ment (coûts/exécution) → recalibrer spread/slippage jusqu'à parité.
// ⚠️ Le live ne commence que le 02/07 → il FAUT le cache M5 de juillet :
//   node scripts/pull-cache.mjs XAUUSD M5   (depuis un réseau autorisé)   puis   npx tsx backtest/parity.ts
// Nuance honnête : la config live a évolué EN COURS de juillet (trailing/minRR/dayLock ajoutés ~20-22/07,
// S1/S3 lancées le 20/07) → la zone la plus propre est 21→28/07 (configs stables, 3 stratégies).
import { backtest } from './simulator';
import { FEATURES } from '../lib/engine/features';
import { STRATEGIES } from '../lib/engine/strategies';
import { cfgFor, ctxFor, SIM_BASE } from './wiring';
import type { Bar } from '../lib/engine/types';

interface LiveDay { day: string; strategy: number; n: number; pnl: number }
const LIVE: LiveDay[] = JSON.parse(readFileSync('backtest/fixtures/live-daily.json', 'utf8')).days;
const CACHE = 'backtest/.cache/XAUUSD-M5-15.json';
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

if (!existsSync(CACHE)) { console.error(`[parity] cache manquant : ${CACHE}`); process.exit(1); }
const bars: Bar[] = JSON.parse(readFileSync(CACHE, 'utf8'));
const barDays = new Set(bars.map((b) => dayStr(b.time)));
const first = dayStr(bars[0].time), last = dayStr(bars[bars.length - 1].time);
console.log(`[parity] cache M5 : ${bars.length} bougies · ${first} → ${last}`);

const liveDays = [...new Set(LIVE.map((d) => d.day))].sort();
const overlap = liveDays.filter((d) => barDays.has(d));
if (overlap.length < 3) {
  console.error(`[parity] seulement ${overlap.length} jour(s) de recouvrement entre le cache et le live (live : ${liveDays[0]} → ${liveDays[liveDays.length - 1]}).`);
  console.error('[parity] → rafraîchir le cache M5 : node scripts/pull-cache.mjs XAUUSD M5');
  process.exit(1);
}
console.log(`[parity] recouvrement : ${overlap.length} jours (${overlap[0]} → ${overlap[overlap.length - 1]})\n`);

for (const sid of ['1', '2', '3'] as const) {
  const profile = STRATEGIES[sid];
  const liveS = LIVE.filter((d) => d.strategy === Number(sid) && barDays.has(d.day));
  if (!liveS.length) continue;

  const run = backtest(bars, FEATURES, cfgFor(profile), { ...SIM_BASE, ctxOpts: ctxFor(profile) });
  const simByDay = new Map<string, { n: number; pnl: number }>();
  for (const t of run.trades) {
    const d = dayStr(t.exitTime);
    const cur = simByDay.get(d) ?? { n: 0, pnl: 0 };
    cur.n++; cur.pnl += t.pnl;
    simByDay.set(d, cur);
  }

  console.log(`================  PARITÉ ${profile.label}  ================`);
  console.log('jour        live n  live $   sim n   sim $     Δ$');
  let ln = 0, lp = 0, sn = 0, sp = 0;
  const daily: Array<{ live: number; sim: number }> = [];
  for (const d of liveS) {
    const s = simByDay.get(d.day) ?? { n: 0, pnl: 0 };
    ln += d.n; lp += d.pnl; sn += s.n; sp += s.pnl;
    daily.push({ live: d.pnl, sim: s.pnl });
    console.log(d.day, String(d.n).padStart(7), String(d.pnl).padStart(7), String(s.n).padStart(7), s.pnl.toFixed(0).padStart(7), (s.pnl - d.pnl).toFixed(0).padStart(7));
  }
  // corrélation des P&L journaliers : le sim vit-il les MÊMES jours rouges/verts que le live ?
  const mL = lp / daily.length, mS = sp / daily.length;
  let cov = 0, vL = 0, vS = 0;
  for (const d of daily) { cov += (d.live - mL) * (d.sim - mS); vL += (d.live - mL) ** 2; vS += (d.sim - mS) ** 2; }
  const corr = vL && vS ? cov / Math.sqrt(vL * vS) : 0;
  console.log(`TOTAL       ${String(ln).padStart(7)} ${String(lp).padStart(7)} ${String(sn).padStart(7)} ${sp.toFixed(0).padStart(7)}   corr(jours) = ${corr.toFixed(2)}`);
  const verdict = corr > 0.5 && Math.abs(sp - lp) < Math.abs(lp) * 0.5 + 3000
    ? '✅ sim ≈ live — le simulateur est crédible sur cette période'
    : corr > 0.5
      ? '⚠️ même profil de jours mais niveau décalé → recalibrer les COÛTS (spread/slippage)'
      : '❌ jours décorrélés — le sim ne vit pas le même marché (config/période/fills à investiguer)';
  console.log(verdict, '\n');
}
console.log('[parity] terminé.');
