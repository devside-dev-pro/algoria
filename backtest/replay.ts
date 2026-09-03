// TRIBUNAL DES ENTRÉES — rejoue les VRAIES entrées live sous d'autres règles de sortie (02/09/2026).
//
// POURQUOI CE FICHIER EXISTE. Trois mois de live sur l'or : −50 k$. Toutes les couches ont la MÊME signature —
// 74–76 % de trades gagnants, moitié des sorties au breakeven, perte moyenne 4 à 5× le gain moyen, espérance
// −0,05 à −0,09 R. Deux explications possibles, aux remèdes opposés :
//   1. les ENTRÉES n'ont pas d'avantage (le prix ne va nulle part de préférence après le signal) → aucune
//      gestion ne sauvera la couche, il faut changer ou couper les entrées ;
//   2. les entrées ont un avantage mais la GESTION le détruit (BE trop tôt, paliers trop serrés, stops pleins
//      sur les perdants) → on garde les entrées et on change les sorties.
// Le simulateur de signaux ne peut pas trancher : sa parité scalp est mauvaise (S2 corr 0,17), et BTC n'a pas
// de simulateur. Ici on CONTOURNE le simulateur : on prend les entrées telles que le live les a prises (heure,
// prix, stop, direction, table trades) et on rejoue chaque position sur les bougies M1 réelles avec plusieurs
// règles de sortie. Les entrées sont la vérité, seules les sorties sont simulées — et la parité de la gestion
// M1 est acquise (backtest/parity.ts, swing : BE live 29 % · sim 20 % ✅).
//
// CE QU'ON MESURE, par symbole × couche :
//   · EDGE DES ENTRÉES : part des trades qui touchent +1R AVANT −1R (hasard pur : 50 %), et +2R avant −1R
//     (hasard : 33 %). En dessous du hasard après coûts, les entrées n'ont rien.
//   · VARIANTES DE SORTIE sur les mêmes entrées : la prod, le brut (SL/TP sans gestion), les seuils de BE, etc.,
//     avec le détail par MOIS — une variante qui gagne un mois et perd les deux autres n'a rien prouvé.
//
// LE STOP QUI COMPTE : `sl0`, le stop INITIAL du signal (signals.stop_loss), jamais `trades.sl` qui est le stop
// courant réécrit à chaque BE/palier/trailing. La première version utilisait `sl` : sur les sorties au BE le
// risque devenait ~0, chaque trade sortait « trail +1R » à la première bougie, et LIVE affichait +150 R pour
// −18 591 $. Le contrôle de sincérité (PROD rejouée ≈ LIVE) existait pour ça. Le R live est recalculé depuis
// le P&L et le risque initial ; la colonne `r` a le même défaut que `sl`.
//
// L'HEURE QUI COMPTE : `trades.opened_at` est l'heure de la BOUGIE DU SIGNAL (runner/index.ts : openedAt =
// signal.time), pas celle du remplissage. Sur un signal M5 l'écart est de 0 à 5 min ; sur un signal H1 (swing)
// jusqu'à une heure. Mesuré en base le 02/09 : le prix de sortie tombe dans la bougie M1 de closed_at pour 99 %
// des trades, le prix d'entrée dans celle de opened_at pour 36 % seulement (133 swings sur 192 à plus de 15 min).
// signal.time est l'heure d'OUVERTURE de la bougie du signal (lib/engine : `time: b.time`), et l'ordre part à
// sa clôture : le remplissage est donc à opened_at + 5 min (signal M5) ou + 60 min (signal H1), jamais avant.
// Le rejeu cherche, à partir de LÀ, la première bougie M1 dont l'amplitude contient le prix d'entrée réel
// (fenêtre 70 min). Chercher dès opened_at (version précédente) tombait dans la bougie du signal elle-même —
// dont la clôture EST le prix d'entrée — et comptait ses mèches comme si la position existait déjà : le BE
// s'armait avant le remplissage, d'où 5 % de stops pleins rejoués contre 19 % en live sur le scalp.
//
// STOPS ABERRANTS : quelques signaux ont un stop_loss nul ou absurde (risque de 4 103 $ sur un scalp or). Ils
// sont exclus par une borne de plausibilité par symbole et comptés, pas cachés.
//
// DIFFÉRENCES ASSUMÉES : la bougie M1 du remplissage est comptée en entier (son plus-bas peut précéder
// l'entrée — légèrement pessimiste) ; pas de cap journalier ni de kill switch (ils coupent des ENTRÉES, pas des sorties) ;
// coûts = commission + glissement sur les sorties au stop (le spread est déjà dans le prix d'entrée live).
//
//   node scripts/pull-cache.mjs XAUUSD M1 && npx tsx scripts/pull-live-trades.ts
//   npx tsx backtest/replay.ts XAUUSD            (BTCUSD · --since 2026-08-01 · --layer swing · --strategy 3)
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';
import { GOLD_SWING, BTC_SWING, type SwingConfig } from '../lib/engine/swing';
import { STRATEGIES } from '../lib/engine/strategies';
import type { LiveTrade } from '../scripts/pull-live-trades';

const args = process.argv.slice(2);
const sym = args.find((a) => !a.startsWith('--')) ?? 'XAUUSD';
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const since = opt('since') ?? '2026-07-01';
const onlyLayer = opt('layer');
const onlyStrat = opt('strategy') ? Number(opt('strategy')) : undefined;

const FIX = 'backtest/fixtures/live-trades.json';
const M1 = `backtest/.cache/${sym}-M1-15.json`;
if (!existsSync(FIX)) { console.error(`${FIX} absent → npx tsx scripts/pull-live-trades.ts`); process.exit(1); }
if (!existsSync(M1)) { console.error(`${M1} absent → node scripts/pull-cache.mjs ${sym} M1`); process.exit(1); }
const fixture = JSON.parse(readFileSync(FIX, 'utf8')) as { generatedAt: string; rows: LiveTrade[] };
const bars = JSON.parse(readFileSync(M1, 'utf8')) as Bar[];

// Coûts par symbole : commission par lot et glissement sur une sortie au stop (frais RaiseFX mesurés — voir
// breakout-core.ts BK_COSTS pour l'or ; BTC : pas de commission mesurée, glissement ≈ 1 tick de spread).
const SPEC: Record<string, { contractSize: number; commissionPerLot: number; slippage: number; fillTol: number; riskMin: number; riskMax: number }> = {
  // fillTol : tolérance pour retrouver la bougie du remplissage (≈ spread) · riskMin/Max : bornes de plausibilité du stop initial
  XAUUSD: { contractSize: 100, commissionPerLot: 7, slippage: 0.05, fillTol: 0.3, riskMin: 0.5, riskMax: 60 },
  BTCUSD: { contractSize: 1, commissionPerLot: 0, slippage: 5, fillTol: 15, riskMin: 20, riskMax: 5000 },
};
const spec = SPEC[sym] ?? SPEC.XAUUSD;

/** Couche déduite du signal_ref, comme le runner la nomme (même règle que pull-live-fixture.ts). */
const layerOf = (ref: string | null): 'trend' | 'swing' | 'breakout' | 'scalp' => {
  const r = (ref ?? '').toLowerCase();
  if (r.includes('-trend-')) return 'trend';
  if (r.includes('swing')) return 'swing';
  if (r.includes('-bk-') || r.includes('break')) return 'breakout';
  return 'scalp';
};

// Règle de sortie rejouée : identique à labcore.ts (BE sur le pic, paliers, trailing, stop testé AVANT le TP).
// beBefore : BE différent pour les trades ouverts avant une date — sert à rejouer la prod TELLE QUE VÉCUE
// (jusqu'au 04/08, un bug de purge dans manage.ts ramenait le swing au BE scalp de 0,15 R ; voir manage.ts).
// weekendFlatLosers : la règle de prod du runner (weekendFlatLosers, toutes les 5 min) — vendredi ≥ 20h UTC,
// tout swing en PERTE latente est fermé au marché ; les gagnants restent. Appliquée à toutes les variantes swing :
// c'est un garde-fou de prod, pas une stratégie de sortie, et le live la subit quelle que soit la gestion.
interface Exit { be?: number; beOffset?: number; ladder?: Array<[number, number]>; trailActivate?: number; trailDist?: number; tpR?: number; maxBars: number; beBefore?: { until: string; be: number }; weekendFlatLosers?: boolean }
type Reason = 'sl' | 'be' | 'trail' | 'tp' | 'time' | 'wkd';
const isFri20 = (t: number) => { const d = new Date(t); return d.getUTCDay() === 5 && d.getUTCHours() >= 20; };
interface Outcome { r: number; reason: Reason; bars: number }

const swingExit = (cfg: SwingConfig, maxBars: number, over: Partial<Exit> = {}): Exit => ({
  be: cfg.beTrigger, ladder: cfg.ladder, trailActivate: cfg.trailActivate, trailDist: cfg.trailDist,
  tpR: cfg.tpAtr / cfg.slAtr, // TP à tpAtr×ATR avec un SL à slAtr×ATR → tpAtr/slAtr en R (16 R : jamais touché en pratique)
  maxBars, weekendFlatLosers: true, ...over,
});
const swingRaw = (tpR: number): Exit => ({ tpR, maxBars: SWING_BARS, weekendFlatLosers: true });
const scalpExit = (s: string, maxBars: number, over: Partial<Exit> = {}): Exit => {
  const p = STRATEGIES[s];
  return { be: p.beTrigger, ladder: p.ladder, trailActivate: p.trailActivate, trailDist: p.trailDist, tpR: p.targetRR, maxBars, ...over };
};

// Horizon de rejeu : au-delà, la position est coupée au close (sortie 'time'). Le live tient ses scalps
// ~6 min en médiane et ses swings ~2 h, mais on laisse la place aux runners : 8 h de M1 pour l'intraday,
// 5 jours de bougies pour le swing.
const SCALP_BARS = 8 * 60;
const SWING_BARS = 5 * 24 * 60;

const SW = sym === 'BTCUSD' ? BTC_SWING : GOLD_SWING;
const BUG_FIX_DAY = '2026-08-04'; // avant : BE swing 0,15 R par accident (purge peaks/custom, manage.ts) ; après : la config
const VARIANTS: Record<string, Array<{ name: string; exit: Exit }>> = {
  swing: [
    { name: `PROD VÉCUE (BE 0,15 avant le 04/08 par bug, ${SW.beTrigger} après)`, exit: swingExit(SW, SWING_BARS, { beBefore: { until: BUG_FIX_DAY, be: 0.15 } }) },
    { name: `PROD CONFIG (BE ${SW.beTrigger} R · paliers · trail ${SW.trailDist} R)`, exit: swingExit(SW, SWING_BARS) },
    { name: 'BE 0,15 R (reste identique)', exit: swingExit(SW, SWING_BARS, { be: 0.15 }) },
    { name: 'BE 1 R (reste identique)', exit: swingExit(SW, SWING_BARS, { be: 1 }) },
    { name: 'sans BE ni paliers, trail seul', exit: swingExit(SW, SWING_BARS, { be: undefined, ladder: undefined }) },
    { name: 'brut : SL −1R / TP +1R, aucune gestion', exit: swingRaw(1) },
    { name: 'brut : SL −1R / TP +2R', exit: swingRaw(2) },
    { name: 'brut : SL −1R / TP +3R', exit: swingRaw(3) },
  ],
  scalp: [
    { name: 'PROD S2 (BE 0,10 · 3 paliers · trail 0,30/0,18 · TP 1R)', exit: scalpExit('2', SCALP_BARS) },
    { name: 'PROD S3 (BE 0,08 · TP 1,5R)', exit: scalpExit('3', SCALP_BARS) },
    { name: 'S2 sans paliers ni trail (BE 0,10 · TP 1R)', exit: scalpExit('2', SCALP_BARS, { ladder: undefined, trailActivate: undefined }) },
    { name: 'BE 0,5 R · TP 1R, sans paliers', exit: { be: 0.5, tpR: 1, maxBars: SCALP_BARS } },
    { name: 'brut : SL −1R / TP +1R, aucune gestion', exit: { tpR: 1, maxBars: SCALP_BARS } },
    { name: 'brut : SL −1R / TP +2R', exit: { tpR: 2, maxBars: SCALP_BARS } },
    { name: 'brut : SL −1R / TP +0,5R', exit: { tpR: 0.5, maxBars: SCALP_BARS } },
  ],
};
VARIANTS.breakout = VARIANTS.scalp;

/** Première bougie M1 dont la minute contient l'entrée (recherche binaire). */
const startIndex = (t: number): number => {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].time + 60_000 <= t) lo = m + 1; else hi = m; }
  return lo;
};

const riskOf = (t: LiveTrade): number => (t.sl0 == null ? 0 : Math.abs(t.entry - t.sl0));
const riskOk = (t: LiveTrade): boolean => {
  const d = riskOf(t);
  if (!(d >= spec.riskMin && d <= spec.riskMax)) return false;
  const dir = t.dir === 'long' ? 1 : -1;
  return dir * (t.entry - t.sl0!) > 0; // stop du bon côté de l'entrée
};
/** Bougie du REMPLISSAGE : première bougie M1 à partir de opened_at (bougie du signal) dont l'amplitude contient
 *  le prix d'entrée réel. −1 si introuvable dans les 70 minutes (trade non rejouable, compté à part). */
const FILL_WINDOW = 70;
const fillCache = new Map<LiveTrade, number>();
const SIGNAL_TF_MS = (t: LiveTrade) => { const l = layerOf(t.ref); return (l === 'trend' ? 0 : l === 'swing' ? 60 : 5) * 60_000; }; // bougie du signal : H1 (swing) ou M5 ; la tendance D1 entre au marché à l'heure enregistrée
const fillIndex = (t: LiveTrade): number => {
  const c = fillCache.get(t);
  if (c !== undefined) return c;
  const i0 = startIndex(new Date(t.openedAt).getTime() + SIGNAL_TF_MS(t));
  let found = -1;
  for (let i = i0; i < bars.length && i < i0 + FILL_WINDOW; i++)
    if (t.entry >= bars[i].low - spec.fillTol && t.entry <= bars[i].high + spec.fillTol) { found = i; break; }
  fillCache.set(t, found);
  return found;
};

function replay(t: LiveTrade, ex: Exit): Outcome | null {
  const dir = t.dir === 'long' ? 1 : -1;
  const riskDist = riskOf(t);
  if (!(riskDist > 0)) return null;
  const i0 = fillIndex(t);
  if (i0 < 0) return null;
  const be = ex.beBefore && t.openedAt < ex.beBefore.until ? ex.beBefore.be : ex.be;
  const costR = (spec.commissionPerLot / spec.contractSize) / riskDist; // commission par lot, ramenée en R
  const slipR = spec.slippage / riskDist;
  let stop = t.sl0!, peak = t.entry;
  const tp = ex.tpR ? t.entry + dir * ex.tpR * riskDist : undefined;
  for (let i = i0; i < bars.length && i - i0 < ex.maxBars; i++) {
    const b = bars[i];
    const hitStop = dir === 1 ? b.low <= stop : b.high >= stop;
    const hitTp = tp !== undefined && (dir === 1 ? b.high >= tp : b.low <= tp);
    if (hitStop) {
      const above = dir * (stop - t.entry);
      const r = above / riskDist - costR - slipR;
      return { r, reason: above > 0.1 * riskDist ? 'trail' : above >= -1e-9 ? 'be' : 'sl', bars: i - i0 + 1 };
    }
    if (hitTp) return { r: ex.tpR! - costR, reason: 'tp', bars: i - i0 + 1 };
    peak = dir === 1 ? Math.max(peak, b.high) : Math.min(peak, b.low);
    const fav = dir * (peak - t.entry);
    const lift = (lvl: number) => { stop = dir === 1 ? Math.max(stop, lvl) : Math.min(stop, lvl); };
    if (be && fav >= be * riskDist) lift(t.entry + dir * (ex.beOffset ?? 0.05) * riskDist);
    if (ex.ladder) for (const [trig, lock] of ex.ladder) if (fav >= trig * riskDist) lift(t.entry + dir * lock * riskDist);
    if (ex.trailActivate && ex.trailDist && fav >= ex.trailActivate * riskDist) lift(peak - dir * ex.trailDist * riskDist);
    if (ex.weekendFlatLosers && isFri20(b.time) && dir * (b.close - t.entry) < 0)
      return { r: (dir * (b.close - t.entry)) / riskDist - costR, reason: 'wkd', bars: i - i0 + 1 };
  }
  const last = bars[Math.min(bars.length - 1, i0 + ex.maxBars - 1)];
  return { r: (dir * (last.close - t.entry)) / riskDist - costR, reason: 'time', bars: ex.maxBars };
}

/** Excursion favorable max (en R) avant que le stop initial −1R soit touché, sur l'horizon. */
function excursion(t: LiveTrade, maxBars: number): { mfe: number; mae: number } | null {
  const dir = t.dir === 'long' ? 1 : -1;
  const riskDist = riskOf(t);
  if (!(riskDist > 0)) return null;
  const i0 = fillIndex(t);
  if (i0 < 0) return null;
  let mfe = 0, mae = 0;
  for (let i = i0; i < bars.length && i - i0 < maxBars; i++) {
    const b = bars[i];
    mae = Math.max(mae, (dir * (t.entry - (dir === 1 ? b.low : b.high))) / riskDist);
    if (mae >= 1) break; // stop initial touché : ce qui vient après n'existe pas pour ce trade
    mfe = Math.max(mfe, (dir * ((dir === 1 ? b.high : b.low) - t.entry)) / riskDist);
  }
  return { mfe, mae: Math.min(mae, 1) };
}

const monthOf = (iso: string) => iso.slice(0, 7);
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0) + '%';
const f1 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1);
const f2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);
const money = (x: number) => (x >= 0 ? '+' : '−') + Math.abs(Math.round(x)).toLocaleString('fr-FR') + ' $';

const rows = fixture.rows.filter((t) => t.symbol === sym && t.closedAt >= since && (!onlyLayer || layerOf(t.ref) === onlyLayer) && (onlyStrat === undefined || t.strategy === onlyStrat));
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
console.log(`\n================  TRIBUNAL DES ENTRÉES — ${sym} · trades live depuis ${since} (fixture du ${fixture.generatedAt.slice(0, 10)})  ================`);
console.log(`M1 : ${bars.length} bougies, ${dayStr(bars[0].time)} → ${dayStr(bars[bars.length - 1].time)} · ${rows.length} trades live retenus`);

const layers = [...new Set(rows.map((t) => layerOf(t.ref)))].sort();
for (const layer of layers) {
  const all = rows.filter((t) => layerOf(t.ref) === layer);
  const maxBars = layer === 'swing' || layer === 'trend' ? SWING_BARS : SCALP_BARS;
  const noStop = all.filter((t) => !(riskOf(t) > 0)).length;
  const badStop = all.filter((t) => riskOf(t) > 0 && !riskOk(t)).length;
  const noFill = all.filter((t) => riskOk(t) && fillIndex(t) < 0).length;
  const ok = all.filter((t) => riskOk(t) && fillIndex(t) >= 0);
  const months = [...new Set(ok.map((t) => monthOf(t.closedAt)))].sort();
  const livePnl = all.reduce((s, t) => s + t.pnl, 0);
  // R live = P&L réel / risque initial au lot réel — pas la colonne `r` (calculée sur le stop courant).
  const liveR = (t: LiveTrade) => t.pnl / (riskOf(t) * t.lot * spec.contractSize);
  const byStrat = new Map<number, { n: number; pnl: number }>();
  for (const t of all) { const s = byStrat.get(t.strategy) ?? { n: 0, pnl: 0 }; s.n++; s.pnl += t.pnl; byStrat.set(t.strategy, s); }

  console.log(`\n────────  ${sym} · ${layer.toUpperCase()}  ·  ${all.length} trades live · ${money(livePnl)}  ·  ${[...byStrat.entries()].sort().map(([s, v]) => `S${s} ${v.n} tr ${money(v.pnl)}`).join(' · ')}  ────────`);
  console.log(`rejouables : ${ok.length}/${all.length} (exclus : ${noStop} sans stop initial · ${badStop} stop aberrant · ${noFill} prix d'entrée introuvable dans le M1 sous 70 min) · risque initial médian ${(() => { const d = ok.map(riskOf).sort((a, b) => a - b); return (d[Math.floor(d.length / 2)] ?? 0).toFixed(2); })()} $`);
  if (!ok.length) continue;

  // 1) EDGE DES ENTRÉES — indépendant de toute gestion.
  const exc = ok.map((t) => excursion(t, maxBars)!).filter(Boolean);
  const p1 = exc.filter((e) => e.mfe >= 1).length, p2 = exc.filter((e) => e.mfe >= 2).length, p05 = exc.filter((e) => e.mfe >= 0.5).length;
  const mfes = exc.map((e) => e.mfe).sort((a, b) => a - b);
  const med = mfes[Math.floor(mfes.length / 2)] ?? 0;
  console.log(`\nEDGE DES ENTRÉES (avant que le stop initial −1R soit touché, horizon ${layer === 'swing' ? '5 j' : '8 h'}) :`);
  console.log(`  touchent +0,5R : ${pct(p05, exc.length)} (hasard ≈ 67 %) · +1R : ${pct(p1, exc.length)} (hasard ≈ 50 %) · +2R : ${pct(p2, exc.length)} (hasard ≈ 33 %) · MFE médiane ${med.toFixed(2)} R`);
  const verdict = p1 / exc.length > 0.55 ? '✅ les entrées ont un avantage — le problème est la SORTIE' : p1 / exc.length < 0.47 ? '❌ les entrées sont sous le hasard — aucune gestion ne sauvera cette couche' : '⚠️ au niveau du hasard — l\'edge, s\'il existe, ne paie pas les coûts';
  console.log(`  → ${verdict}`);

  // 2) VARIANTES DE SORTIE sur les mêmes entrées, détail par mois.
  const head = `${'sortie'.padEnd(52)} ${'n'.padStart(4)} ${'R tot'.padStart(7)} ${'R/tr'.padStart(6)} ${'win'.padStart(4)}  ${'sl'.padStart(4)} ${'be'.padStart(4)} ${'trl'.padStart(4)} ${'tp'.padStart(4)} ${'tim'.padStart(4)} ${'wkd'.padStart(4)}  ${months.map((m) => m.slice(5).padStart(6)).join(' ')}  ${'$ lots live'.padStart(12)}`;
  console.log('\n' + head);
  const liveRs = ok.map(liveR);
  const liveLine = (() => {
    const tot = liveRs.reduce((s, r) => s + r, 0);
    const byM = months.map((m) => ok.filter((t) => monthOf(t.closedAt) === m).reduce((s, t) => s + liveR(t), 0));
    const cnt = (k: string) => ok.filter((t) => t.reason === k).length;
    const other = ok.length - cnt('sl') - cnt('be') - cnt('trail') - cnt('tp');
    return `${`LIVE (enregistré · ${pct(other, ok.length)} autres sorties)`.padEnd(52)} ${String(ok.length).padStart(4)} ${f1(tot).padStart(7)} ${f2(tot / ok.length).padStart(6)} ${pct(liveRs.filter((r) => r > 0).length, ok.length).padStart(4)}  ${pct(cnt('sl'), ok.length).padStart(4)} ${pct(cnt('be'), ok.length).padStart(4)} ${pct(cnt('trail'), ok.length).padStart(4)} ${pct(cnt('tp'), ok.length).padStart(4)} ${'—'.padStart(4)} ${pct(cnt('wkd'), ok.length).padStart(4)}  ${byM.map((x) => f1(x).padStart(6)).join(' ')}  ${money(ok.reduce((s, t) => s + t.pnl, 0)).padStart(12)}`;
  })();
  console.log(liveLine);
  const liveTot = liveRs.reduce((s, r) => s + r, 0);
  const liveSl = ok.filter((t) => t.reason === 'sl').length / ok.length;
  let ref: { name: string; rPer: number; sl: number } | null = null;
  for (const v of VARIANTS[layer]) {
    const outs = ok.map((t) => ({ t, o: replay(t, v.exit)! }));
    const tot = outs.reduce((s, x) => s + x.o.r, 0);
    const wins = outs.filter((x) => x.o.r > 0).length;
    const cnt = (k: Reason) => outs.filter((x) => x.o.reason === k).length;
    if (!ref) ref = { name: v.name, rPer: tot / outs.length, sl: cnt('sl') / outs.length }; // 1ʳᵉ variante = la prod telle que vécue
    const byM = months.map((m) => outs.filter((x) => monthOf(x.t.closedAt) === m).reduce((s, x) => s + x.o.r, 0));
    const usd = outs.reduce((s, x) => s + x.o.r * riskOf(x.t) * x.t.lot * spec.contractSize, 0);
    console.log(`${v.name.padEnd(52)} ${String(outs.length).padStart(4)} ${f1(tot).padStart(7)} ${f2(tot / outs.length).padStart(6)} ${pct(wins, outs.length).padStart(4)}  ${pct(cnt('sl'), outs.length).padStart(4)} ${pct(cnt('be'), outs.length).padStart(4)} ${pct(cnt('trail'), outs.length).padStart(4)} ${pct(cnt('tp'), outs.length).padStart(4)} ${pct(cnt('time'), outs.length).padStart(4)} ${pct(cnt('wkd'), outs.length).padStart(4)}  ${byM.map((x) => f1(x).padStart(6)).join(' ')}  ${money(usd).padStart(12)}`);
  }
  // TEST DE SINCÉRITÉ : la prod rejouée (1ʳᵉ variante) doit ressembler au live — R par trade et part de stops pleins.
  if (ref) {
    const dR = ref.rPer - liveTot / ok.length, dSl = ref.sl - liveSl;
    const verdict = Math.abs(dR) <= 0.05 && Math.abs(dSl) <= 0.10 ? '✅ le rejeu est crédible' : Math.abs(dR) <= 0.10 && Math.abs(dSl) <= 0.20 ? '⚠️ écart notable — lire les variantes avec cette marge' : '❌ le rejeu ne reproduit pas le live — aucune conclusion';
    console.log(`SINCÉRITÉ (prod rejouée vs live) : R/trade ${f2(ref.rPer)} vs ${f2(liveTot / ok.length)} (Δ ${f2(dR)}) · stops pleins ${pct(ref.sl * 100, 100)} vs ${pct(liveSl * 100, 100)} → ${verdict}`);
  }
  console.log(`Lecture : une variante ne compte que si elle gagne sur CHAQUE mois, et d'au moins la marge du test de sincérité.`);

  // 3) L'EDGE PAR SESSION — si les entrées valent quelque chose à certaines heures et rien à d'autres,
  //    le problème est QUAND on entre, pas COMMENT on sort. Heure = celle du remplissage, en UTC.
  const SESS: Array<[string, number, number]> = [['Asie 22–07h', 22, 7], ['Londres 07–12h', 7, 12], ['New York 12–17h', 12, 17], ['soir 17–22h', 17, 22]];
  const hourOf = (t: LiveTrade) => new Date(bars[fillIndex(t)].time).getUTCHours();
  const inSess = (h: number, a: number, b: number) => (a < b ? h >= a && h < b : h >= a || h < b);
  const raw1: Exit = { tpR: 1, maxBars, weekendFlatLosers: layer === 'swing' };
  console.log(`\nEDGE PAR SESSION (heure du remplissage, UTC) :`);
  console.log(`${'session'.padEnd(18)} ${'n'.padStart(4)} ${'+1R'.padStart(5)} ${'+2R'.padStart(5)} ${'live R/tr'.padStart(10)} ${'brut ±1R R/tr'.padStart(14)} ${'live $'.padStart(10)}`);
  for (const [name, a, b] of SESS) {
    const sub = ok.filter((t) => inSess(hourOf(t), a, b));
    if (!sub.length) continue;
    const e = sub.map((t) => excursion(t, maxBars)!);
    const lr = sub.reduce((s, t) => s + liveR(t), 0) / sub.length;
    const br = sub.reduce((s, t) => s + replay(t, raw1)!.r, 0) / sub.length;
    console.log(`${name.padEnd(18)} ${String(sub.length).padStart(4)} ${pct(e.filter((x) => x.mfe >= 1).length, e.length).padStart(5)} ${pct(e.filter((x) => x.mfe >= 2).length, e.length).padStart(5)} ${f2(lr).padStart(10)} ${f2(br).padStart(14)} ${money(sub.reduce((s, t) => s + t.pnl, 0)).padStart(10)}`);
  }
}
console.log('');
