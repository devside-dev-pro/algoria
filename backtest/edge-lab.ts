// LABO D'EDGE — chercher un signal qui passe la barre, pour de vrai (03/09/2026).
//
// LA BARRE, FIXÉE AVANT DE REGARDER : sur deux ans de M5, semestre par semestre, hors échantillon, une règle
// d'entrée doit
//   1. toucher +1R avant −1R dans ≥ 55 % des cas, sur CHAQUE semestre jugé (n ≥ 60), et
//   2. battre la ligne de base du MÊME semestre (entrées au hasard, même stop) d'au moins 5 points, et
//   3. garder une espérance positive après coûts à TP 1R ou à TP 2R, sur chaque semestre.
// Trois conditions, toutes obligatoires. Le tribunal des entrées (replay.ts) a montré que les trois générateurs
// de prod font 49 % sur deux ans à toutes les heures — indiscernables du hasard. On ne remplace pas un signal
// vide par un autre signal non mesuré : tout candidat passe ici d'abord, avec des paramètres CONVENTIONNELS
// posés avant de voir les données, jamais optimisés sur elles. Ce qui tombe tombe, sans discussion.
//
// CE QU'ON MESURE ET POURQUOI C'EST HONNÊTE : seule l'ENTRÉE est jugée. Trajet M5 réel après l'entrée, stop
// initial figé, aucune gestion. Une règle qui ne passe pas cette barre ne sera sauvée par aucune sortie ; une
// règle qui la passe laisse de la place à la gestion. Coûts : spread 0,2 + glissement 0,05 + commission
// 7 $/lot (= 0,07 $/once), ramenés en R par la distance du stop.
//
// FAMILLES TESTÉES (chacune a une raison d'exister, aucune n'est l'une des trois de prod) :
//   A. Cassure du range d'ouverture (Londres 07h, New York 13h30 UTC) — l'ouverture d'une place fixe une
//      fourchette, la sortie de cette fourchette engage les flux de la session.
//   B. Compression puis expansion — quand les 12 dernières bougies tiennent dans une boîte étroite (< 2 ATR,
//      soit moins de la moitié de l'amplitude normale d'une heure),
//      la sortie de la boîte va souvent plus loin que le bruit.
//   C. Momentum de fond — le rendement des 5 derniers jours donne la direction ; on entre chaque jour à 07h UTC
//      dans ce sens, stop 1,5 ATR(H1), horizon 3 jours. C'est la seule structure que la ligne de base a montrée.
//   D. Retour à la moyenne en Asie — écart > 2 σ à la moyenne 20 bougies entre 22h et 06h UTC : on prend le
//      contre-pied, stop 1 ATR, horizon 2 h. Le scalp de prod « vivait » aux heures calmes ; on teste l'idée nue.
//   E. VWAP (demande Mathieu, 03/09) — E1 : rebond sur le VWAP de session dans le sens de la tendance (prix au-dessus
//      du VWAP depuis 1 h, la bougie le touche et clôture au-dessus → long ; symétrique en short) ; E2 : retour au
//      VWAP (clôture à plus de 1,5 ATR du VWAP → contre-pied vers le VWAP).
//   F. Divergence RSI 14 — nouveau plus-bas sur 24 bougies alors que le RSI fait un plus-bas plus haut (≥ 5 pts) que
//      sur le creux précédent, bougie de confirmation haussière → long ; symétrique en short.
//   P. Pullback RSI 14 horaire (< 30 / > 70) dans la tendance de 50 jours — stop 1,5 ATR(H1) horizon 1 j, ou stop 1 ATR horizon 4 h.
//   Z. Ligne de base — une entrée toutes les 4 h, long et short, stop 1 ATR. Le vrai hasard de chaque semestre.
//
//   npx tsx backtest/edge-lab.ts                (XAUUSD)
//   npx tsx backtest/edge-lab.ts BTCUSD         (nécessite backtest/.cache/BTCUSD-M5-15.json)
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';

const sym = process.argv[2] ?? 'XAUUSD';
const path = `backtest/.cache/${sym}-M5-15.json`;
if (!existsSync(path)) { console.error(`${path} absent → node scripts/pull-cache.mjs ${sym} M5`); process.exit(1); }
const bars = JSON.parse(readFileSync(path, 'utf8')) as Bar[];
const COST: Record<string, number> = { XAUUSD: 0.2 + 0.05 + 0.07, BTCUSD: 10 + 5 + 0 }; // $ par unité, aller-retour
const cost = COST[sym] ?? COST.XAUUSD;
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const half = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${d.getUTCMonth() < 6 ? 'H1' : 'H2'}`; };
const hourUtc = (t: number) => new Date(t).getUTCHours();
const minUtc = (t: number) => new Date(t).getUTCMinutes();
const dayKey = (t: number) => Math.floor(t / 86_400_000);

// ===== Indicateurs causaux (valeur en i = bougies ≤ i) =====
const n = bars.length;
const atr = new Array<number>(n).fill(0); // ATR14 simple sur M5
{
  const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low));
  let sum = 0;
  for (let i = 0; i < n; i++) { sum += tr[i]; if (i >= 14) sum -= tr[i - 14]; atr[i] = sum / Math.min(14, i + 1); }
}
const atrH1 = atr.map((a) => a * Math.sqrt(12)); // approximation : ATR M5 × √12 ≈ ATR horaire
const sma20 = new Array<number>(n).fill(0), sd20 = new Array<number>(n).fill(0);
{ let s = 0, s2 = 0; for (let i = 0; i < n; i++) { const c = bars[i].close; s += c; s2 += c * c; if (i >= 20) { const o = bars[i - 20].close; s -= o; s2 -= o * o; } const k = Math.min(20, i + 1); const m = s / k; sma20[i] = m; sd20[i] = Math.sqrt(Math.max(0, s2 / k - m * m)); } }
// VWAP de session (ancré au jour UTC) et RSI 14 — pour les familles E et F
const vwap = new Array<number>(n).fill(0);
{ let day = -1, pv = 0, vv = 0; for (let i = 0; i < n; i++) { const d = dayKey(bars[i].time); if (d !== day) { day = d; pv = 0; vv = 0; } const tp = (bars[i].high + bars[i].low + bars[i].close) / 3; const v = Math.max(1, bars[i].volume); pv += tp * v; vv += v; vwap[i] = pv / vv; } }
const rsi = new Array<number>(n).fill(50);
{ let ag = 0, al = 0; for (let i = 1; i < n; i++) { const ch = bars[i].close - bars[i - 1].close; const g = Math.max(0, ch), l = Math.max(0, -ch); if (i <= 14) { ag += g / 14; al += l / 14; } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; } rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
// clôture d'il y a ~5 jours de bourse (1 440 bougies M5 = 5 × 288), pour le momentum de fond
const closeAgo = (i: number, k: number) => (i - k >= 0 ? bars[i - k].close : NaN);

// RSI 14 HORAIRE (clôtures de la dernière M5 de chaque heure, valeur reportée sur les M5 suivantes) et moyenne
// des clôtures sur ~50 jours de bourse (50 × 288 M5) — pour la famille P (pullback dans la tendance de fond).
const rsiH1 = new Array<number>(n).fill(50);
{ let ag = 0, al = 0, k = 0, prev = NaN, cur = 50; for (let i = 0; i < n; i++) { if (minUtc(bars[i].time) === 55) { const c = bars[i].close; if (!Number.isNaN(prev)) { const ch = c - prev; const g = Math.max(0, ch), l = Math.max(0, -ch); k++; if (k <= 14) { ag += g / 14; al += l / 14; } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; } cur = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } prev = c; } rsiH1[i] = cur; } }
const sma50d = new Array<number>(n).fill(0);
{ const W = 50 * 288; let s = 0; for (let i = 0; i < n; i++) { s += bars[i].close; if (i >= W) s -= bars[i - W].close; sma50d[i] = s / Math.min(W, i + 1); } }

// ===== La mesure : +1R / +2R touchés avant −1R, sur le trajet M5 à partir de la bougie SUIVANTE (entrée à son open) =====
interface Entry { i: number; dir: 1 | -1; risk: number }
interface Out { i: number; dir: 1 | -1; risk: number; mfe: number; stopped: boolean; endR: number }
function measure(e: Entry, maxBars: number): Out | null {
  const i0 = e.i + 1;
  if (i0 >= n || !(e.risk > 0)) return null;
  const entry = bars[i0].open;
  let best = 0, stopped = false, endR = 0;
  for (let i = i0; i < n && i - i0 < maxBars; i++) {
    const b = bars[i];
    const adverse = (e.dir * (entry - (e.dir === 1 ? b.low : b.high))) / e.risk;
    if (adverse >= 1) { stopped = true; break; }
    endR = (e.dir * (b.close - entry)) / e.risk; // où en est le trade si l'horizon s'arrête ici
    best = Math.max(best, (e.dir * ((e.dir === 1 ? b.high : b.low) - entry)) / e.risk);
  }
  return { i: i0, dir: e.dir, risk: e.risk, mfe: best, stopped, endR };
}

// ===== Candidats — paramètres conventionnels, posés avant de regarder =====
interface Cand { key: string; name: string; horizon: number; gen: () => Entry[] }
const CANDS: Cand[] = [];

// A. Cassure du range d'ouverture : fourchette des 30 premières minutes, entrée à la première clôture M5 hors
//    fourchette dans les 3 h qui suivent, stop = autre côté de la fourchette (borné à [0,5 ; 2] ATR), un trade/jour/place.
for (const [label, h, m] of [['Londres 07h', 7, 0], ['New York 13h30', 13, 30]] as Array<[string, number, number]>) {
  CANDS.push({ key: `A-${label}`, name: `A · cassure du range d'ouverture ${label} (30 min, stop = autre côté)`, horizon: 8 * 12, gen: () => {
    const out: Entry[] = []; let day = -1, hi = 0, lo = 0, formed = false, done = false;
    for (let i = 1; i < n; i++) {
      const b = bars[i]; const d = dayKey(b.time);
      if (d !== day) { day = d; hi = 0; lo = 0; formed = false; done = false; }
      const mins = hourUtc(b.time) * 60 + minUtc(b.time), open = h * 60 + m;
      if (mins >= open && mins < open + 30) { hi = hi ? Math.max(hi, b.high) : b.high; lo = lo ? Math.min(lo, b.low) : b.low; if (mins >= open + 25) formed = true; continue; }
      if (!formed || done || mins < open + 30 || mins > open + 210) continue;
      const range = hi - lo; if (!(range > 0)) continue;
      const clamp = (x: number) => Math.min(2 * atr[i], Math.max(0.5 * atr[i], x));
      if (b.close > hi) { out.push({ i, dir: 1, risk: clamp(b.close - lo) }); done = true; }
      else if (b.close < lo) { out.push({ i, dir: -1, risk: clamp(hi - b.close) }); done = true; }
    }
    return out;
  } });
}

// B. Compression puis expansion : les 12 dernières bougies (1 h) tiennent dans < 2 ATR (amplitude normale d'une heure ≈ 3,5 ATR) ; on entre à la première
//    clôture hors de la boîte, stop = autre côté de la boîte (borné comme ci-dessus), au plus une entrée par boîte.
CANDS.push({ key: 'B', name: 'B · compression (1 h dans < 2 ATR) puis cassure de la boîte', horizon: 4 * 12, gen: () => {
  const out: Entry[] = []; let cool = 0;
  for (let i = 30; i < n; i++) {
    if (cool > 0) { cool--; continue; }
    let hi = -Infinity, lo = Infinity;
    for (let k = i - 12; k < i; k++) { hi = Math.max(hi, bars[k].high); lo = Math.min(lo, bars[k].low); }
    if (!(hi - lo < 2 * atr[i]) || !(hi > lo)) continue;
    const b = bars[i];
    const clamp = (x: number) => Math.min(2 * atr[i], Math.max(0.5 * atr[i], x));
    if (b.close > hi) { out.push({ i, dir: 1, risk: clamp(b.close - lo) }); cool = 12; }
    else if (b.close < lo) { out.push({ i, dir: -1, risk: clamp(hi - b.close) }); cool = 12; }
  }
  return out;
} });

// B⁻. CONTRE-PIED de la cassure de boîte (pré-enregistré le 03/09 après la première passe : B est SOUS le hasard
//     sur les quatre semestres de l'or, 44-47 %, −5 pts partout ; un anti-edge régulier vaut un test de son contraire,
//     une fois, sans réglage). Même boîte, même stop en distance, direction inversée. Attention : le contraire de
//     45 % n'est pas 55 % — les trades qui n'atteignent ni +1R ni −1R dans l'horizon ne se retournent pas.
CANDS.push({ key: 'B-inv', name: 'B⁻ · contre-pied de la cassure de boîte (même boîte, même stop, direction inversée)', horizon: 4 * 12, gen: () => {
  const out: Entry[] = []; let cool = 0;
  for (let i = 30; i < n; i++) {
    if (cool > 0) { cool--; continue; }
    let hi = -Infinity, lo = Infinity;
    for (let k = i - 12; k < i; k++) { hi = Math.max(hi, bars[k].high); lo = Math.min(lo, bars[k].low); }
    if (!(hi - lo < 2 * atr[i]) || !(hi > lo)) continue;
    const b = bars[i];
    const clamp = (x: number) => Math.min(2 * atr[i], Math.max(0.5 * atr[i], x));
    if (b.close > hi) { out.push({ i, dir: -1, risk: clamp(b.close - lo) }); cool = 12; }
    else if (b.close < lo) { out.push({ i, dir: 1, risk: clamp(hi - b.close) }); cool = 12; }
  }
  return out;
} });

// C. Momentum de fond : à 07h00 UTC, direction = signe du rendement sur 5 jours de bourse ; stop 1,5 ATR(H1) ; horizon 3 jours.
for (const [label, k] of [['5 jours', 5 * 288], ['10 jours', 10 * 288]] as Array<[string, number]>) {
  CANDS.push({ key: `C-${label}`, name: `C · momentum de fond ${label}, entrée 07h UTC, stop 1,5 ATR(H1)`, horizon: 3 * 288, gen: () => {
    const out: Entry[] = []; let day = -1;
    for (let i = k; i < n; i++) {
      const b = bars[i]; const d = dayKey(b.time);
      if (d === day || hourUtc(b.time) !== 7 || minUtc(b.time) !== 0) continue;
      day = d;
      const r = b.close - closeAgo(i, k); if (!Number.isFinite(r) || r === 0) continue;
      out.push({ i, dir: r > 0 ? 1 : -1, risk: 1.5 * atrH1[i] });
    }
    return out;
  } });
}

// D. Retour à la moyenne en Asie : entre 22h et 06h UTC, clôture à plus de 2 σ de la moyenne 20 → contre-pied ; stop 1 ATR ; horizon 2 h ; 12 bougies de repos.
CANDS.push({ key: 'D', name: 'D · retour à la moyenne en Asie (écart > 2 σ, contre-pied, stop 1 ATR)', horizon: 2 * 12, gen: () => {
  const out: Entry[] = []; let cool = 0;
  for (let i = 30; i < n; i++) {
    if (cool > 0) { cool--; continue; }
    const h = hourUtc(bars[i].time); if (!(h >= 22 || h < 6)) continue;
    const z = sd20[i] > 0 ? (bars[i].close - sma20[i]) / sd20[i] : 0;
    if (z > 2) { out.push({ i, dir: -1, risk: atr[i] }); cool = 12; }
    else if (z < -2) { out.push({ i, dir: 1, risk: atr[i] }); cool = 12; }
  }
  return out;
} });

// E1. Rebond sur le VWAP dans le sens de la tendance : 12 bougies au-dessus du VWAP, la bougie i le touche (low ≤ vwap)
//     et clôture au-dessus → long ; stop sous le plus-bas de la bougie − 0,2 ATR (borné 0,5–2 ATR) ; horizon 4 h ; 6 bougies de repos.
CANDS.push({ key: 'E1', name: 'E1 · rebond sur le VWAP de session dans le sens de la tendance (stop sous la bougie)', horizon: 4 * 12, gen: () => {
  const out: Entry[] = []; let cool = 0;
  const clampAt = (i: number, x: number) => Math.min(2 * atr[i], Math.max(0.5 * atr[i], x));
  for (let i = 30; i < n; i++) {
    if (cool > 0) { cool--; continue; }
    if (dayKey(bars[i].time) !== dayKey(bars[i - 12].time)) continue; // même session
    let above = true, below = true;
    for (let k = i - 12; k < i; k++) { if (bars[k].close <= vwap[k]) above = false; if (bars[k].close >= vwap[k]) below = false; }
    const b = bars[i];
    if (above && b.low <= vwap[i] && b.close > vwap[i]) { out.push({ i, dir: 1, risk: clampAt(i, b.close - b.low + 0.2 * atr[i]) }); cool = 6; }
    else if (below && b.high >= vwap[i] && b.close < vwap[i]) { out.push({ i, dir: -1, risk: clampAt(i, b.high - b.close + 0.2 * atr[i]) }); cool = 6; }
  }
  return out;
} });

// E2. Retour au VWAP : clôture à plus de 1,5 ATR du VWAP → contre-pied ; stop 1 ATR ; horizon 4 h ; 12 bougies de repos.
CANDS.push({ key: 'E2', name: 'E2 · retour au VWAP (écart > 1,5 ATR, contre-pied, stop 1 ATR)', horizon: 4 * 12, gen: () => {
  const out: Entry[] = []; let cool = 0;
  for (let i = 30; i < n; i++) {
    if (cool > 0) { cool--; continue; }
    const d = bars[i].close - vwap[i];
    if (d > 1.5 * atr[i]) { out.push({ i, dir: -1, risk: atr[i] }); cool = 12; }
    else if (d < -1.5 * atr[i]) { out.push({ i, dir: 1, risk: atr[i] }); cool = 12; }
  }
  return out;
} });

// F. Divergence RSI 14 : plus-bas des 24 dernières bougies sous le creux précédent (12 à 60 bougies avant) avec un RSI
//    plus haut d'au moins 5 points, et bougie de confirmation (clôture > ouverture) → long ; symétrique ; stop sous le
//    plus-bas − 0,5 ATR (borné) ; horizon 4 h ; 12 bougies de repos.
CANDS.push({ key: 'F', name: 'F · divergence RSI 14 (creux plus bas, RSI plus haut, bougie de confirmation)', horizon: 4 * 12, gen: () => {
  const out: Entry[] = []; let cool = 0;
  const clampAt = (i: number, x: number) => Math.min(2 * atr[i], Math.max(0.5 * atr[i], x));
  for (let i = 80; i < n; i++) {
    if (cool > 0) { cool--; continue; }
    const b = bars[i];
    // creux précédent : plus-bas entre i−60 et i−12
    let j = i - 60, jh = i - 60;
    for (let k = i - 60; k <= i - 12; k++) { if (bars[k].low < bars[j].low) j = k; if (bars[k].high > bars[jh].high) jh = k; }
    let recentLow = Infinity, recentHigh = -Infinity;
    for (let k = i - 11; k < i; k++) { recentLow = Math.min(recentLow, bars[k].low); recentHigh = Math.max(recentHigh, bars[k].high); }
    if (b.low < bars[j].low && b.low <= recentLow && rsi[i] > rsi[j] + 5 && b.close > b.open) { out.push({ i, dir: 1, risk: clampAt(i, b.close - b.low + 0.5 * atr[i]) }); cool = 12; }
    else if (b.high > bars[jh].high && b.high >= recentHigh && rsi[i] < rsi[jh] - 5 && b.close < b.open) { out.push({ i, dir: -1, risk: clampAt(i, b.high - b.close + 0.5 * atr[i]) }); cool = 12; }
  }
  return out;
} });

// Z. Ligne de base : une entrée toutes les 4 h, long ET short, stop 1 ATR — le hasard de chaque semestre.
// P. PULLBACK DANS LA TENDANCE DE FOND (03/09, la « stratégie n°2 » du texte de Mathieu : « si la macro-tendance est
//    haussière, attendre que le RSI passe en survente sur 15 min ou 1 h pour acheter à prix réduit ») : tendance de
//    fond = clôture au-dessus (long) / en dessous (short) de la moyenne des clôtures sur 50 jours ; déclencheur =
//    RSI 14 HORAIRE < 30 (long) ou > 70 (short) ; stop 1,5 ATR(H1) ; horizon 1 jour (288 M5) ; 12 bougies de repos.
//    P-tight : la même avec un stop de 1 ATR(H1) et un horizon de 4 h — la version « scalp » de l'idée.
for (const [label, slK, hz] of [['stop 1,5 ATR(H1) · horizon 1 j', 1.5, 288], ['stop 1 ATR(H1) · horizon 4 h', 1, 4 * 12]] as Array<[string, number, number]>) {
  CANDS.push({ key: `P-${hz}`, name: `P · pullback RSI 14 horaire (< 30 / > 70) dans la tendance de 50 jours · ${label}`, horizon: hz, gen: () => {
    const out: Entry[] = []; let cool = 0;
    for (let i = 50 * 288; i < n; i++) {
      if (cool > 0) { cool--; continue; }
      const up = bars[i].close > sma50d[i], dn = bars[i].close < sma50d[i];
      if (up && rsiH1[i] < 30) { out.push({ i, dir: 1, risk: slK * atrH1[i] }); cool = 12; }
      else if (dn && rsiH1[i] > 70) { out.push({ i, dir: -1, risk: slK * atrH1[i] }); cool = 12; }
    }
    return out;
  } });
}

CANDS.push({ key: 'Z', name: 'Z · LIGNE DE BASE — entrées au hasard toutes les 4 h, stop 1 ATR', horizon: 8 * 12, gen: () => {
  const out: Entry[] = [];
  for (let i = 300; i < n; i += 48) { out.push({ i, dir: 1, risk: atr[i] }); out.push({ i, dir: -1, risk: atr[i] }); }
  return out;
} });

// ===== Rapport =====
const periods = [...new Set(bars.map((b) => half(b.time)))].sort();
type Cell = { n: number; p1: number; p2: number; costR: number; r1: number; r2: number };
const empty = (): Cell => ({ n: 0, p1: 0, p2: 0, costR: 0, r1: 0, r2: 0 });
// Résultat RÉEL d'un trade à TP fixe k : +k si le TP est touché, −1 si le stop l'est, sinon le résultat à
// l'horizon (le trade est coupé au close). Une entrée qui n'atteint ni l'un ni l'autre n'est pas une perte pleine.
const outcome = (o: Out, k: number) => (o.mfe >= k ? k : o.stopped ? -1 : o.endR);
const add = (c: Cell, o: Out) => { c.n++; if (o.mfe >= 1) c.p1++; if (o.mfe >= 2) c.p2++; c.costR += cost / o.risk; c.r1 += outcome(o, 1); c.r2 += outcome(o, 2); };
// espérance en R à TP fixe k, stop −1R, après coûts : p·k − (1−p)·1 − coût moyen
const exp1 = (c: Cell) => (c.n ? (c.r1 - c.costR) / c.n : 0); // espérance en R à TP 1R, après coûts
const exp2 = (c: Cell) => (c.n ? (c.r2 - c.costR) / c.n : 0); // idem à TP 2R
const f2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);

console.log(`\n================  LABO D'EDGE — ${sym} M5 · ${bars.length} bougies · ${dayStr(bars[0].time)} → ${dayStr(bars[n - 1].time)}  ================`);
console.log(`Barre : +1R avant −1R ≥ 55 % sur chaque semestre jugé (n ≥ 60) · ≥ base + 5 pts · espérance après coûts > 0 (TP 1R ou 2R) sur chaque semestre.`);

const baseCells = new Map<string, Cell>();
// La ligne de base est calculée en premier : les autres candidats se comparent à elle, semestre par semestre.
for (const cand of [...CANDS].sort((a, b) => (a.key === 'Z' ? -1 : b.key === 'Z' ? 1 : 0))) {
  const outs = cand.gen().map((e) => measure(e, cand.horizon)).filter((o): o is Out => !!o);
  const byP = new Map<string, Cell>(); const byDir: Record<string, Cell> = { long: empty(), short: empty() }; const tot = empty();
  for (const o of outs) { const p = half(bars[o.i].time); if (!byP.has(p)) byP.set(p, empty()); add(byP.get(p)!, o); add(byDir[o.dir === 1 ? 'long' : 'short'], o); add(tot, o); }
  if (cand.key === 'Z') for (const [p, c] of byP) baseCells.set(p, c);
  console.log(`\n────────  ${cand.name}  ·  ${outs.length} entrées  ────────`);
  console.log(`${'semestre'.padEnd(10)} ${'n'.padStart(5)} ${'+1R'.padStart(5)} ${'+2R'.padStart(5)} ${'base'.padStart(5)} ${'E[TP1R]'.padStart(8)} ${'E[TP2R]'.padStart(8)}`);
  const judged: Array<{ ok: boolean }> = [];
  for (const p of periods) {
    const c = byP.get(p); if (!c || !c.n) continue;
    const base = baseCells.get(p);
    const b1 = base && base.n ? pct(base.p1, base.n) : NaN;
    const p1 = pct(c.p1, c.n);
    const ok = p1 >= 55 && (Number.isNaN(b1) || p1 >= b1 + 5) && (exp1(c) > 0 || exp2(c) > 0);
    if (c.n >= 60) judged.push({ ok });
    console.log(`${p.padEnd(10)} ${String(c.n).padStart(5)} ${(p1 + '%').padStart(5)} ${(pct(c.p2, c.n) + '%').padStart(5)} ${(Number.isNaN(b1) ? '—' : b1 + '%').padStart(5)} ${f2(exp1(c)).padStart(8)} ${f2(exp2(c)).padStart(8)}${c.n < 60 ? '   (trop peu)' : ok ? '   ✓' : '   ✗'}`);
  }
  console.log(`${'TOTAL'.padEnd(10)} ${String(tot.n).padStart(5)} ${(pct(tot.p1, tot.n) + '%').padStart(5)} ${(pct(tot.p2, tot.n) + '%').padStart(5)} ${''.padStart(5)} ${f2(exp1(tot)).padStart(8)} ${f2(exp2(tot)).padStart(8)}   long ${byDir.long.n} · ${pct(byDir.long.p1, byDir.long.n)} %  ·  short ${byDir.short.n} · ${pct(byDir.short.p1, byDir.short.n)} %`);
  if (cand.key !== 'Z') {
    const verdict = judged.length >= 3 && judged.every((j) => j.ok) ? '✅ PASSE LA BARRE sur chaque semestre jugé' : judged.length < 3 ? '— pas assez de semestres jugeables' : `✗ tombe (${judged.filter((j) => !j.ok).length}/${judged.length} semestres sous la barre)`;
    console.log(`VERDICT : ${verdict}`);
  }
}
console.log('');
