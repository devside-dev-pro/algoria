// L'EDGE PAR SESSION, HORS ÉCHANTILLON (02/09/2026, soir) — le contrôle que le tribunal des entrées réclame.
//
// CE QUE LE LIVE A MONTRÉ (backtest/replay.ts, 1 132 trades or de juillet à septembre) : après un signal, le prix
// touche +1R avant −1R une fois sur deux — une pièce de monnaie — MAIS pas à toutes les heures :
//   scalp (rejets de niveaux)   Asie 53 % · Londres 44 % · New York 39 % · soir 57 %
//   swing (suivi de tendance)   Asie 46 % · Londres 65 % · New York 48 % · soir 55 %
// Le scalp vit aux heures calmes et meurt aux heures de tendance ; le swing fait l'inverse. Ça a un sens
// économique — et c'est exactement le genre de motif qu'on trouve AUSSI par hasard quand on regarde 16 cases
// et qu'on retient les meilleures (57 % sur 155 trades = 1,7 écart-type).
//
// CE FICHIER TRANCHE : on fait tourner les VRAIS générateurs de signaux (le moteur scalp de prod, la stratégie
// swing trend de labcore) sur tout l'historique en cache, on mesure la même chose — part des entrées qui
// touchent +1R avant −1R — par session ET par semestre. Si le motif tient sur des périodes que personne n'a
// regardées, il est réel. S'il disparaît, c'était le hasard de trois mois.
//
// On NE regarde PAS le P&L simulé : la parité scalp est mauvaise (corr 0,17) sur les SORTIES, mais les ENTRÉES
// du sim sont le même code que le live. Le trajet du prix après l'entrée (M5 réel) ne dépend d'aucune gestion.
// Aucune sortie simulée n'intervient dans la mesure — seule l'ENTRÉE compte (le sim sert uniquement à savoir
// QUAND le moteur aurait tiré, une position à la fois, comme en live).
//
// Filtre 12–17h : retiré ici (il masquerait la case qu'on veut mesurer). BTC : pas mesuré — BTC_SWING est un
// breakout Donchian sans simulateur, on ne va pas juger une stratégie avec une autre.
//
//   node scripts/pull-cache.mjs XAUUSD M5 && node scripts/pull-cache.mjs XAUUSD H1
//   npx tsx backtest/edge-sessions.ts
import { existsSync, readFileSync } from 'node:fs';
import { backtest } from './simulator';
import type { SimTrade } from './simulator';
import { FEATURES } from '../lib/engine/features';
import { STRATEGIES } from '../lib/engine/strategies';
import { computeIndicators, labBacktest, swingTrendDef, SPECS, SWING_PROD_EXITS, SWING_PROD_TP_ATR } from './labcore';
import { cfgFor, simFor } from './wiring';
import type { Bar } from '../lib/engine/types';

const load = (f: string): Bar[] | null => (existsSync(`backtest/.cache/${f}`) ? JSON.parse(readFileSync(`backtest/.cache/${f}`, 'utf8')) : null);
const m5 = load('XAUUSD-M5-15.json');
const h1 = load('XAUUSD-H1-15.json');
if (!m5 || !h1) { console.error('caches manquants → node scripts/pull-cache.mjs XAUUSD M5 && node scripts/pull-cache.mjs XAUUSD H1'); process.exit(1); }
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

// ===== La mesure : à partir de la bougie d'entrée, +1R touché avant −1R ? (même définition que replay.ts) =====
const startIndex = (bars: Bar[], t: number): number => { let lo = 0, hi = bars.length; while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].time < t) lo = m + 1; else hi = m; } return lo; };
function mfe(bars: Bar[], t: SimTrade, maxBars: number): number | null {
  const risk = t.riskDist ?? 0;
  if (!(risk > 0)) return null;
  const dir = t.dir === 'long' ? 1 : -1;
  const i0 = startIndex(bars, t.entryTime);
  if (i0 >= bars.length) return null;
  let best = 0;
  for (let i = i0; i < bars.length && i - i0 < maxBars; i++) {
    const b = bars[i];
    const adverse = (dir * (t.entryPrice - (dir === 1 ? b.low : b.high))) / risk;
    if (adverse >= 1) break; // stop initial touché : le trade n'existe plus
    best = Math.max(best, (dir * ((dir === 1 ? b.high : b.low) - t.entryPrice)) / risk);
  }
  return best;
}

const SESS: Array<[string, number, number]> = [['Asie 22–07h', 22, 7], ['Londres 07–12h', 7, 12], ['New York 12–17h', 12, 17], ['soir 17–22h', 17, 22]];
const inSess = (h: number, a: number, b: number) => (a < b ? h >= a && h < b : h >= a || h < b);
const half = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${d.getUTCMonth() < 6 ? 'H1' : 'H2'}`; };

function report(layer: string, trades: SimTrade[], fine: Bar[], maxBars: number, minN = 60) {
  const rows = trades.map((t) => ({ t, m: mfe(fine, t, maxBars) })).filter((x): x is { t: SimTrade; m: number } => x.m != null);
  const periods = [...new Set(rows.map((x) => half(x.t.entryTime)))].sort();
  console.log(`\n────────  ${layer} · ${rows.length} entrées simulées · ${dayStr(rows[0]?.t.entryTime ?? 0)} → ${dayStr(rows[rows.length - 1]?.t.entryTime ?? 0)}  ────────`);
  console.log(`+1R avant −1R (hasard 50 %) — cellule : n · % ; une session est ROBUSTE si ≥ 55 % sur chaque semestre jugé (n ≥ ${minN}), TOXIQUE si ≤ 45 % sur chacun.`);
  console.log(`${'session'.padEnd(18)} ${periods.map((p) => p.padStart(12)).join(' ')} ${'TOTAL'.padStart(12)}  verdict`);
  const all = { n: 0, p1: 0 };
  for (const [name, a, b] of SESS) {
    const sub = rows.filter((x) => inSess(new Date(x.t.entryTime).getUTCHours(), a, b));
    const cells = periods.map((p) => { const s = sub.filter((x) => half(x.t.entryTime) === p); return { n: s.length, p1: s.filter((x) => x.m >= 1).length }; });
    const tot = { n: sub.length, p1: sub.filter((x) => x.m >= 1).length, p2: sub.filter((x) => x.m >= 2).length };
    all.n += tot.n; all.p1 += tot.p1;
    const judged = cells.filter((c) => c.n >= minN);
    const robust = judged.length >= 2 && judged.every((c) => pct(c.p1, c.n) >= 55);
    const toxic = judged.length >= 2 && judged.every((c) => pct(c.p1, c.n) <= 45);
    const verdict = robust ? '✅ robuste' : toxic ? '❌ toxique' : judged.length < 2 ? '— trop peu de données' : '≈ hasard / instable';
    console.log(`${name.padEnd(18)} ${cells.map((c) => (c.n ? `${String(c.n).padStart(4)} · ${String(pct(c.p1, c.n)).padStart(3)}%` : '—'.padStart(11)).padStart(12)).join(' ')} ${`${String(tot.n).padStart(4)} · ${String(pct(tot.p1, tot.n)).padStart(3)}%`.padStart(12)}  ${verdict}   (+2R ${pct(tot.p2, tot.n)}%)`);
  }
  console.log(`${'toutes sessions'.padEnd(18)} ${''.padStart(periods.length * 13)} ${`${String(all.n).padStart(4)} · ${String(pct(all.p1, all.n)).padStart(3)}%`.padStart(12)}`);
}

console.log(`\n================  EDGE PAR SESSION, HORS ÉCHANTILLON — XAUUSD  ================`);
console.log(`M5 : ${m5.length} bougies, ${dayStr(m5[0].time)} → ${dayStr(m5[m5.length - 1].time)} · H1 : ${h1.length} bougies, ${dayStr(h1[0].time)} → ${dayStr(h1[h1.length - 1].time)}`);

// ===== SCALP : le moteur de prod (profil S2), toutes les heures ouvertes =====
for (const key of ['2', '1']) {
  const profile = STRATEGIES[key];
  const run = backtest(m5, FEATURES, cfgFor(profile), { ...simFor(profile), blockEntryHours: undefined });
  report(`SCALP · profil S${key} (${profile.tradeAsia ? 'Asie ouverte' : 'Asie coupée par le profil'}) · trajet M5 · horizon 8 h`, run.trades, m5, 96);
}

// ===== SWING : la stratégie trend de labcore (= GOLD_SWING), entrées H1, trajet M5 là où il existe =====
{
  const ind = computeIndicators(h1);
  const run = labBacktest(ind, swingTrendDef({ ...SWING_PROD_EXITS, noEntryFriFrom: undefined }, SWING_PROD_TP_ATR), SPECS.XAUUSD);
  const m5From = m5[0].time;
  const onM5 = run.trades.filter((t) => t.entryTime >= m5From);
  report(`SWING · trend GOLD_SWING · trajet M5 · horizon 5 j`, onM5, m5, 5 * 24 * 12, 30);
  report(`SWING · trend GOLD_SWING · trajet H1 (tout l'historique, moins précis) · horizon 5 j`, run.trades, h1, 5 * 24, 30);
}
console.log('');
