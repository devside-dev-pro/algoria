import { readFileSync, existsSync } from 'node:fs';
// TEST DE PARITÉ SIM ↔ LIVE — le juge du juge (étude 28/07, demande Mathieu : « les backtests ne
// correspondent pas à la réalité »). On rejoue le simulateur sur les bougies RÉELLES de la période live
// et on compare JOUR PAR JOUR avec ce que le compte a réellement fait (fixture fixtures/live-daily.json,
// extraite de la table trades). Deux issues :
//   · sim ≈ live  → le simulateur est honnête ; les écarts backtest/réalité = régime de marché.
//   · sim ≫ live  → le simulateur ment (coûts/exécution) → recalibrer spread/slippage jusqu'à parité.
//
// LEÇON DU 1er RUN (28/07) : la v1 comparait le sim scalp au P&L TOTAL du compte → ❌ décorrélé…
// parce qu'un compte live = 5 COUCHES : scalp (moteur confluence, la seule que le sim reproduit),
// breakout (-bk-), swing (-swing-, lot 0.5), RAFALE (lot 0.05, micro-scalps de SHOW — 92 trades le 06/07 !)
// et manuel. À couche égale (scalp↔scalp), S1 corrèle à 0.77. La fixture est maintenant par couche et
// XAUUSD uniquement (la v1 mélangeait aussi le Nasdaq). Le breakout et le swing n'ont pas encore de sim
// dédié dans CE test — leurs journées live sont récapitulées pour situer ce qui échappe à la comparaison.
//
// ⚠️ Le live ne commence que le 02/07 → il FAUT le cache M5 de juillet :
//   node scripts/pull-cache.mjs XAUUSD M5   (depuis un réseau autorisé)   puis   npx tsx backtest/parity.ts
// Nuance honnête : la config live a évolué EN COURS de juillet (trailing/minRR/dayLock ajoutés ~20-22/07,
// S1/S3 lancées le 20/07) → la zone la plus propre est 21→28/07 (configs stables, 3 stratégies).
// S3 : le scalp confluence est ÉTEINT en live (intraday='breakout') → sa parité « scalp » est indicative,
// son vrai moteur attend un sim breakout.
import { backtest } from './simulator';
import { computeIndicators, labBacktest, swingTrendDef, SPECS, START, SWING_PROD_EXITS, SWING_PROD_TP_ATR } from './labcore';
import { FEATURES } from '../lib/engine/features';
import { STRATEGIES } from '../lib/engine/strategies';
import { cfgFor, simFor } from './wiring';
import type { Bar } from '../lib/engine/types';

interface LiveDay { day: string; strategy: number; layer: string; symbol?: string; n: number; pnl: number }
interface LiveExit { symbol: string; layer: string; strategy: number; reason: string; n: number; pnl: number }
const FIX = JSON.parse(readFileSync('backtest/fixtures/live-daily.json', 'utf8')) as { days: LiveDay[]; exits?: LiveExit[]; from?: string; to?: string; generatedAt?: string };
// La fixture v1 était implicitement XAUUSD sans le dire ; la v2 porte le symbole. On filtre explicitement,
// sinon les trades BTC (qui GAGNENT) viendraient diluer une comparaison censée juger l'or.
const LIVE: LiveDay[] = FIX.days.filter((d) => (d.symbol ?? 'XAUUSD') === 'XAUUSD');
if (FIX.from) console.log(`[parity] fixture live : ${FIX.from} → ${FIX.to}${FIX.generatedAt ? ` (extraite le ${FIX.generatedAt.slice(0, 10)})` : ''}`);
else console.log("[parity] ⚠️ fixture SANS date de génération — probablement la v1 figée. Régénérer : tsx scripts/pull-live-fixture.ts");
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
  const liveAll = LIVE.filter((d) => d.strategy === Number(sid) && barDays.has(d.day));
  const liveS = liveAll.filter((d) => d.layer === 'scalp');
  if (!liveAll.length) continue;

  const run = backtest(bars, FEATURES, cfgFor(profile), simFor(profile));
  const simByDay = new Map<string, { n: number; pnl: number }>();
  for (const t of run.trades) {
    const d = dayStr(t.exitTime);
    const cur = simByDay.get(d) ?? { n: 0, pnl: 0 };
    cur.n++; cur.pnl += t.pnl;
    simByDay.set(d, cur);
  }

  console.log(`================  PARITÉ ${profile.label} — couche SCALP uniquement  ================`);
  console.log('jour        live n  live $   sim n   sim $     Δ$');
  let ln = 0, lp = 0, sn = 0, sp = 0;
  const daily: Array<{ live: number; sim: number }> = [];
  for (const d of liveS) {
    const s = simByDay.get(d.day) ?? { n: 0, pnl: 0 };
    ln += d.n; lp += d.pnl; sn += s.n; sp += s.pnl;
    daily.push({ live: d.pnl, sim: s.pnl });
    console.log(d.day, String(d.n).padStart(7), String(d.pnl).padStart(7), String(s.n).padStart(7), s.pnl.toFixed(0).padStart(7), (s.pnl - d.pnl).toFixed(0).padStart(7));
  }
  if (daily.length >= 3) {
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
    console.log(verdict);
  } else {
    console.log(`(seulement ${daily.length} jour(s) scalp — pas assez pour une corrélation)`);
  }

  // Les autres couches (non simulées ici) : ce qui échappe encore à la comparaison.
  const byLayer = new Map<string, { n: number; pnl: number }>();
  for (const d of liveAll.filter((x) => x.layer !== 'scalp')) {
    const cur = byLayer.get(d.layer) ?? { n: 0, pnl: 0 };
    cur.n += d.n; cur.pnl += d.pnl;
    byLayer.set(d.layer, cur);
  }
  if (byLayer.size) {
    const parts = [...byLayer.entries()].map(([k, v]) => `${k} ${v.n} trades $${v.pnl}`).join(' · ');
    console.log(`couches live NON simulées ici : ${parts}`);
  }
  console.log();
}
// ═══ RÉPARTITION DES SORTIES — l'angle qui manquait (02/09/2026) ═══════════════════════════════════
// Le P&L journalier ne suffit pas : deux distributions de sorties très différentes peuvent donner la même
// somme. Or c'est précisément là que le live surprend — en réalité 44 % des scalps or et 54 % des swings or
// finissent au BREAKEVEN, pour +27 $ et +51 $. Si le simulateur n'en produit pas autant, son modèle de
// sortie est faux, et alors AUCUN de ses chiffres ne vaut : ni le P&L, ni le classement des candidats du
// walk-forward, ni les décisions prises dessus.
const pct = (n: number, tot: number) => (tot ? `${Math.round((100 * n) / tot)}%` : '—');
const dist = (rows: Array<{ reason: string; n: number; pnl: number }>) => {
  const tot = rows.reduce((s, r) => s + r.n, 0);
  return [...rows].sort((a, b) => b.n - a.n)
    .map((r) => `${r.reason} ${r.n} (${pct(r.n, tot)}, ${(r.pnl / Math.max(1, r.n)).toFixed(0)}$/tr)`).join(' · ');
};

if (FIX.exits?.length) {
  console.log('\n================  RÉPARTITION DES SORTIES — LIVE vs SIM  ================');
  for (const layer of ['scalp', 'swing'] as const) {
    const live = FIX.exits.filter((e) => e.symbol === 'XAUUSD' && e.layer === layer);
    if (!live.length) continue;
    const totL = live.reduce((s, e) => s + e.n, 0);
    const beL = live.filter((e) => e.reason === 'be').reduce((s, e) => s + e.n, 0);
    console.log(`\n--- ${layer.toUpperCase()} or · ${totL} trades live`);
    console.log(`LIVE : ${dist(live)}`);

    if (layer === 'swing') {
      // Le swing n'avait AUCUN sim dans ce fichier — c'est pourtant lui qui a produit le +14 018 $ du
      // walk-forward du 02/09, opposé aux −18 591 $ du live. On le rejoue ici, avec la définition PARTAGÉE.
      const H1 = 'backtest/.cache/XAUUSD-H1-15.json';
      if (!existsSync(H1)) { console.log('SIM  : cache H1 absent → node scripts/pull-cache.mjs XAUUSD H1'); continue; }
      const h1: Bar[] = JSON.parse(readFileSync(H1, 'utf8'));
      const win = h1.filter((b) => { const d = dayStr(b.time); return d >= (FIX.from ?? '2000-01-01') && d <= (FIX.to ?? '2100-01-01'); });
      if (win.length < 800) { console.log(`SIM  : seulement ${win.length} bougies H1 sur la fenêtre live (700 de chauffe nécessaires)`); continue; }
      const run = labBacktest(computeIndicators(win), swingTrendDef(SWING_PROD_EXITS, SWING_PROD_TP_ATR), SPECS.XAUUSD);
      const byReason = new Map<string, { reason: string; n: number; pnl: number }>();
      for (const t of run.trades) {
        const cur = byReason.get(t.reason) ?? { reason: t.reason, n: 0, pnl: 0 };
        cur.n++; cur.pnl += t.pnl; byReason.set(t.reason, cur);
      }
      const sim = [...byReason.values()];
      const totS = sim.reduce((s, e) => s + e.n, 0);
      const beS = sim.filter((e) => e.reason === 'be').reduce((s, e) => s + e.n, 0);
      console.log(`SIM  : ${dist(sim)}`);
      console.log(`P&L  : live $${live.reduce((s, e) => s + e.pnl, 0)}  ·  sim $${(run.finalBalance - START).toFixed(0)}`);
      console.log(`BE   : live ${pct(beL, totL)}  ·  sim ${pct(beS, totS)}  → ${Math.abs(beL / Math.max(1, totL) - beS / Math.max(1, totS)) > 0.15
        ? '❌ ÉCART MAJEUR sur le breakeven : le modèle de sortie du sim ne reproduit pas le live, ses chiffres ne sont pas utilisables tels quels'
        : '✅ taux de breakeven comparable'}`);
      console.log('⚠️ Rappel : le sim dimensionne à 1 % de risque sur $10 000, le live est en LOT FIXE. Les');
      console.log('   niveaux de $ ne sont donc pas directement comparables — la RÉPARTITION, elle, l\'est.');
    }
  }
}

console.log('\n[parity] terminé.');
