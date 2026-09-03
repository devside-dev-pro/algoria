// LE SCALP D'OUVERTURE DE MATHIEU, MIS À L'ÉPREUVE (03/09/2026).
//
// Sa description : « j'ouvre MT5, j'envoie 2/3 scalps sur le master à 15h30 à l'open [13h30 UTC], je vise des
// récupérations ou je suis le mouvement, pas de TP pas de SL, je ferme dès que l'or prend 5 pts ». Et l'idée
// produit : « un bon bot de scalp pourrait faire 50 trades par jour, RR de 1 ou 2 et c'est plié ».
//
// On ne peut pas rejouer une lecture discrétionnaire. On peut rejouer ses DEUX gestes mécaniques, à SON heure,
// avec SES objectifs, sur les bougies M1 réelles du broker (juin → septembre 2026), et regarder ce que donne
// chaque façon de sortir — y compris « sans stop », qui est ce qu'il fait vraiment :
//   · SUIVRE  : direction de la première bougie M1 de 13h30 (ou des 5 premières minutes), entrée à la suivante ;
//   · FADER   : l'inverse (la « récupération » après la pointe d'ouverture) ;
//   · sorties : objectif 5 pts avec stop 5 / 10 / 20 pts, ou SANS stop (on tient jusqu'à +5 ou la fin de séance
//     21h UTC) — pour celle-là on mesure la pire excursion adverse, c'est-à-dire ce qu'un compte doit encaisser ;
//   · le BOT DE QUANTITÉ : dès qu'on est plat entre 13h31 et 16h UTC, on entre dans le sens de la dernière M1,
//     objectif 5 pts, stop 5 (ou 10) — combien de trades par jour, et combien ça rapporte ;
//   · TÉMOIN  : les mêmes gestes à TOUTES les heures pleines — si 13h30 n'est pas différente des autres, ce n'est
//     pas l'heure qui fait l'argent.
// Coûts : 0,32 $/oz aller-retour (spread 0,2 + glissement 0,05 + commission 0,07), lot 1 = 100 oz.
// Le stop est testé AVANT l'objectif dans une même bougie (pessimiste, comme partout dans le labo).
//
//   node scripts/pull-cache.mjs XAUUSD M1 && npx tsx backtest/scalp-open.ts
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';

const sym = 'XAUUSD';
const path = `backtest/.cache/${sym}-M1-15.json`;
if (!existsSync(path)) { console.error(`${path} absent → node scripts/pull-cache.mjs ${sym} M1`); process.exit(1); }
const bars = (JSON.parse(readFileSync(path, 'utf8')) as Bar[]).sort((a, b) => a.time - b.time);
const COST = 0.32; // $/oz aller-retour
const LOT_OZ = 100;
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const hm = (t: number) => { const d = new Date(t); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const f0 = (x: number) => (x >= 0 ? '+' : '') + Math.round(x).toLocaleString('fr-FR');
const f1 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1);

// bougies par jour (lundi → vendredi uniquement)
const days = new Map<string, Bar[]>();
for (const b of bars) { const d = new Date(b.time); const wd = d.getUTCDay(); if (wd === 0 || wd === 6) continue; const k = dayStr(b.time); (days.get(k) ?? days.set(k, []).get(k)!).push(b); }
const dayList = [...days.keys()].sort();

interface Trade { day: string; dir: 1 | -1; entry: number; exit: number; pts: number; mae: number; mfe: number; minutes: number; how: 'tp' | 'sl' | 'time' }
/** Simule une entrée à l'OPEN de la bougie `i0` (dans le tableau du jour), sortie objectif/stop/heure limite. */
function sim(db: Bar[], i0: number, dir: 1 | -1, tp: number, sl: number | null, untilMin: number): Trade | null {
  if (i0 >= db.length) return null;
  const entry = db[i0].open;
  let mae = 0, mfe = 0;
  for (let i = i0; i < db.length; i++) {
    const b = db[i];
    const adverse = dir === 1 ? entry - b.low : b.high - entry;
    const favor = dir === 1 ? b.high - entry : entry - b.low;
    mae = Math.max(mae, adverse); mfe = Math.max(mfe, favor);
    if (sl != null && adverse >= sl) return { day: dayStr(b.time), dir, entry, exit: entry - dir * sl, pts: -sl - COST, mae, mfe, minutes: i - i0, how: 'sl' };
    if (favor >= tp) return { day: dayStr(b.time), dir, entry, exit: entry + dir * tp, pts: tp - COST, mae, mfe, minutes: i - i0, how: 'tp' };
    if (hm(b.time) >= untilMin || i === db.length - 1) return { day: dayStr(b.time), dir, entry, exit: b.close, pts: dir * (b.close - entry) - COST, mae, mfe, minutes: i - i0, how: 'time' };
  }
  return null;
}
const idxAt = (db: Bar[], minutes: number) => db.findIndex((b) => hm(b.time) >= minutes);

function report(name: string, trades: Trade[], extra = '') {
  if (!trades.length) { console.log(`${name.padEnd(58)} aucun trade`); return; }
  const n = trades.length;
  const pts = trades.reduce((s, t) => s + t.pts, 0);
  const wins = trades.filter((t) => t.pts > 0).length;
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.pts);
  const dayVals = [...byDay.values()];
  const greenDays = dayVals.filter((v) => v > 0).length;
  const worstDay = Math.min(...dayVals);
  const worstTrade = Math.min(...trades.map((t) => t.pts));
  const maes = trades.map((t) => t.mae).sort((a, b) => a - b);
  const maeP90 = maes[Math.floor(0.9 * (n - 1))];
  const maeMax = maes[n - 1];
  console.log(`${name.padEnd(58)} ${String(n).padStart(4)} tr · ${Math.round((100 * wins) / n).toString().padStart(3)} % gagnants · ${(pts / n).toFixed(2).padStart(6)} pt/trade · ${f0(pts * LOT_OZ).padStart(9)} $ (lot 1) · ${Math.round((100 * greenDays) / dayVals.length)} % jours verts · pire jour ${f0(worstDay * LOT_OZ)} $ · pire trade ${f0(worstTrade * LOT_OZ)} $ · excursion adverse p90 ${maeP90.toFixed(1)} pt, max ${maeMax.toFixed(1)} pt${extra}`);
}

console.log(`\n================  SCALP D'OUVERTURE — ${sym} M1 · ${dayList.length} jours ouvrés · ${dayList[0]} → ${dayList[dayList.length - 1]} · coût ${COST} $/oz · lot 1 = ${LOT_OZ} oz  ================`);
const OPEN = 13 * 60 + 30; // 13h30 UTC = 15h30 Paris
const CLOSE = 21 * 60;

// ── 1) Le geste de Mathieu à 13h30 : suivre / fader la première minute, puis les 5 premières minutes
const firstMove = (db: Bar[], fromMin: number, nBars: number): { dir: 1 | -1; i: number } | null => {
  const i = idxAt(db, fromMin); if (i < 0 || i + nBars >= db.length) return null;
  const move = db[i + nBars - 1].close - db[i].open; if (Math.abs(move) < 0.3) return null; // pas de sens lisible
  return { dir: move > 0 ? 1 : -1, i: i + nBars };
};
const EXITS: Array<{ label: string; tp: number; sl: number | null }> = [
  { label: 'objectif 5 · stop 5', tp: 5, sl: 5 },
  { label: 'objectif 5 · stop 10', tp: 5, sl: 10 },
  { label: 'objectif 5 · stop 20', tp: 5, sl: 20 },
  { label: 'objectif 5 · SANS STOP (fin de séance)', tp: 5, sl: null },
  { label: 'objectif 10 · stop 10', tp: 10, sl: 10 },
  { label: 'objectif 10 · SANS STOP (fin de séance)', tp: 10, sl: null },
];
for (const [label, nBars] of [['première minute', 1], ['5 premières minutes', 5]] as Array<[string, number]>) {
  console.log(`\n── 13h30 UTC · signal = ${label} ──`);
  for (const side of ['SUIVRE', 'FADER'] as const) {
    for (const ex of EXITS) {
      const trades: Trade[] = [];
      for (const d of dayList) { const db = days.get(d)!; const fm = firstMove(db, OPEN, nBars); if (!fm) continue; const t = sim(db, fm.i, side === 'SUIVRE' ? fm.dir : (-fm.dir as 1 | -1), ex.tp, ex.sl, CLOSE); if (t) trades.push(t); }
      report(`${side} · ${ex.label}`, trades);
    }
  }
}

// ── 2) « Un bon bot pourrait faire 50 trades par jour » : dès qu'on est plat, on suit la dernière M1, objectif 5
console.log(`\n── BOT DE QUANTITÉ · plat → entrée dans le sens de la dernière M1 · objectif 5 pts ──`);
for (const win of [{ label: '13h31 → 16h00 UTC (l\'ouverture US)', from: OPEN + 1, to: 16 * 60 }, { label: '07h00 → 21h00 UTC (toute la séance)', from: 7 * 60, to: 21 * 60 }]) {
  for (const sl of [5, 10, null]) {
    const trades: Trade[] = [];
    for (const d of dayList) {
      const db = days.get(d)!; let i = idxAt(db, win.from); if (i < 1) continue;
      while (i < db.length && hm(db[i].time) < win.to) {
        const prev = db[i - 1]; const move = prev.close - prev.open; if (Math.abs(move) < 0.1) { i++; continue; }
        const t = sim(db, i, move > 0 ? 1 : -1, 5, sl, win.to); if (!t) break; trades.push(t); i += t.minutes + 1;
      }
    }
    report(`${win.label} · stop ${sl ?? 'AUCUN (sortie à l\'heure limite)'}`, trades, ` · ${(trades.length / dayList.length).toFixed(1)} trades/jour`);
  }
}

// ── 3) Témoin : le même geste (suivre la première minute, objectif 5, stop 5 / sans stop) à toutes les heures pleines
console.log(`\n── TÉMOIN · SUIVRE la première minute de chaque heure pleine · objectif 5 ──`);
console.log(`${'heure UTC'.padEnd(10)} ${'stop 5 : pt/trade'.padStart(18)} ${'% gagnants'.padStart(11)}   ${'sans stop : pt/trade'.padStart(20)} ${'% gagnants'.padStart(11)} ${'MAE max'.padStart(8)}`);
for (let h = 7; h <= 20; h++) {
  const row: string[] = [];
  for (const sl of [5, null]) {
    const trades: Trade[] = [];
    for (const d of dayList) { const db = days.get(d)!; const fm = firstMove(db, h * 60, 1); if (!fm) continue; const t = sim(db, fm.i, fm.dir, 5, sl, CLOSE); if (t) trades.push(t); }
    const n = trades.length; const pts = trades.reduce((s, t) => s + t.pts, 0) / Math.max(1, n); const w = trades.filter((t) => t.pts > 0).length;
    row.push(`${pts.toFixed(2).padStart(sl ? 18 : 20)} ${(n ? Math.round((100 * w) / n) + ' %' : '—').padStart(11)}${sl ? '' : ' ' + Math.max(0, ...trades.map((t) => t.mae)).toFixed(1).padStart(8)}`);
  }
  console.log(`${(String(h).padStart(2, '0') + 'h00').padEnd(10)} ${row[0]}   ${row[1]}${h === 13 ? '   ← 13h00 ; l\'ouverture US est à 13h30, voir §1' : ''}`);
}
console.log('');
