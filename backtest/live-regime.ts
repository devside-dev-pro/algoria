// LES VRAIS TRADES, DÉCOUPÉS PAR RÉGIME DE MARCHÉ (06/09/2026).
//
// LA QUESTION. Août : S2 +10 899 $. Depuis le 23/08 : −20 562 $ en 14 jours, deux journées vertes sur douze.
// Même moteur, mêmes réglages. Soit le scalp n'a jamais eu d'edge et août était de la variance, soit il ne
// marche que dans UN régime (l'or en tendance) et meurt dans l'autre (range, volatilité qui s'écrase ou qui
// explose). Ce labo ne simule rien : il prend chaque trade LIVE (backtest/fixtures/live-trades.json, export
// scripts/pull-live-trades.ts) et le range dans le régime du jour, lu sur les bougies JOURNALIÈRES du broker
// CLÔTURÉES AVANT l'entrée (aucune fuite du futur : on ne sait le matin que ce que la veille a fermé).
//
// CE QU'ON MESURE, par tranche : nombre de trades, P&L net (compte master, 1 lot), gain/perte moyens, stops
// pleins, et R quand le stop initial du signal est connu (sl0). Puis « si on avait filtré » : le P&L gardé
// contre le P&L évité, pour chaque filtre candidat. Un filtre n'a de valeur que s'il enlève beaucoup de rouge
// en gardant l'essentiel du vert — ET s'il tient sur les deux mois, pas seulement sur celui qu'on regarde.
//
//   npx tsx backtest/live-regime.ts XAUUSD --since 2026-07-01 --strategy 2,3
import { existsSync, readFileSync } from 'node:fs';
import type { Bar } from '../lib/engine/types';
import type { LiveTrade } from '../scripts/pull-live-trades';

const argv = process.argv.slice(2);
const sym = argv.find((a) => !a.startsWith('--')) ?? 'XAUUSD';
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const since = opt('since', '2026-07-01');
const strategies = opt('strategy', '2,3').split(',').map(Number);
const CONTRACT = sym === 'BTCUSD' ? 1 : 100; // $ par unité de prix pour 1 lot

const barsPath = `backtest/.cache/${sym}-D1-15.json`;
const tradesPath = 'backtest/fixtures/live-trades.json';
for (const f of [barsPath, tradesPath]) if (!existsSync(f)) { console.error(`${f} absent`); process.exit(1); }
const bars = (JSON.parse(readFileSync(barsPath, 'utf8')) as Bar[]).sort((a, b) => a.time - b.time);
const parsed = JSON.parse(readFileSync(tradesPath, 'utf8')) as LiveTrade[] | { rows: LiveTrade[] };
const all: LiveTrade[] = Array.isArray(parsed) ? parsed : parsed.rows;
const trades = all.filter((t) => t.symbol === sym && strategies.includes(Number(t.strategy)) && t.closedAt >= since && t.pnl != null && t.openedAt);
if (!trades.length) { console.error('aucun trade à juger'); process.exit(1); }

// ===== Indicateurs journaliers, causaux =====
const n = bars.length;
const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low));
const wilder = (src: number[], len: number) => { const out = new Array<number>(n).fill(0); let s = 0; for (let i = 0; i < n; i++) { s = i < len ? s + src[i] : s - s / len + src[i]; out[i] = i < len ? s / (i + 1) : s / len; } return out; };
const atr14 = wilder(tr, 14);
const atr20 = wilder(tr, 20);
// ADX 14 (Wilder)
const plusDM = new Array<number>(n).fill(0), minusDM = new Array<number>(n).fill(0);
for (let i = 1; i < n; i++) { const up = bars[i].high - bars[i - 1].high; const dn = bars[i - 1].low - bars[i].low; plusDM[i] = up > dn && up > 0 ? up : 0; minusDM[i] = dn > up && dn > 0 ? dn : 0; }
const sPlus = wilder(plusDM, 14), sMinus = wilder(minusDM, 14);
const dx = bars.map((_, i) => { const p = atr14[i] ? (100 * sPlus[i]) / atr14[i] : 0; const m = atr14[i] ? (100 * sMinus[i]) / atr14[i] : 0; return p + m ? (100 * Math.abs(p - m)) / (p + m) : 0; });
const adx = wilder(dx, 14);
const sma = (len: number) => { const out = new Array<number>(n).fill(0); let s = 0; for (let i = 0; i < n; i++) { s += bars[i].close; if (i >= len) s -= bars[i - len].close; out[i] = s / Math.min(len, i + 1); } return out; };
const sma20 = sma(20), sma50 = sma(50);
const atrPctile = (i: number) => { const w = atr20.slice(Math.max(0, i - 250), i + 1); const below = w.filter((v) => v < atr20[i]).length; return Math.round((100 * below) / Math.max(1, w.length - 1)); };
const donch = (i: number, len: number) => { let hi = -Infinity, lo = Infinity; for (let k = Math.max(0, i - len + 1); k <= i; k++) { hi = Math.max(hi, bars[k].high); lo = Math.min(lo, bars[k].low); } return { hi, lo }; };

/** Index de la dernière bougie D1 CLÔTURÉE avant l'ouverture du trade (bougie du jour J-1 au plus tard). */
const dayStartUtc = (iso: string) => { const d = new Date(iso); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const lastClosedBefore = (openIso: string): number => { const t0 = dayStartUtc(openIso); let i = -1; for (let k = 0; k < n; k++) { if (bars[k].time < t0 - 3 * 3_600_000) i = k; else break; } return i; };

interface Judged { t: LiveTrade; r: number | null; full: boolean; adx: number; atrP: number; trend: 'up' | 'down' | 'flat'; align: 'with' | 'against' | 'flat'; posInCh: number; prevRange: number; hour: number; wd: number; month: string }
const judged: Judged[] = [];
for (const t of trades) {
  const i = lastClosedBefore(t.openedAt);
  if (i < 60) continue;
  const risk = t.sl0 != null ? Math.abs(t.entry - t.sl0) * CONTRACT * (t.lot || 1) : null;
  const r = risk ? t.pnl / risk : null;
  const trend: Judged['trend'] = bars[i].close > sma50[i] && sma20[i] > sma20[i - 5] ? 'up' : bars[i].close < sma50[i] && sma20[i] < sma20[i - 5] ? 'down' : 'flat';
  const align: Judged['align'] = trend === 'flat' ? 'flat' : (trend === 'up') === (t.dir === 'long') ? 'with' : 'against';
  const ch = donch(i, 20);
  const posInCh = ch.hi > ch.lo ? (bars[i].close - ch.lo) / (ch.hi - ch.lo) : 0.5;
  const d = new Date(t.openedAt);
  judged.push({ t, r, full: r != null ? r <= -0.85 : t.pnl < -700, adx: adx[i], atrP: atrPctile(i), trend, align, posInCh, prevRange: atr20[i] ? tr[i] / atr20[i] : 1, hour: d.getUTCHours(), wd: d.getUTCDay(), month: t.closedAt.slice(0, 7) });
}

// ===== Tableaux =====
const fmt = (v: number) => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US');
const line = (label: string, xs: Judged[]) => {
  if (!xs.length) return `${label.padEnd(26)} —`;
  const net = xs.reduce((a, x) => a + x.t.pnl, 0);
  const wins = xs.filter((x) => x.t.pnl > 0).length;
  const rs = xs.filter((x) => x.r != null);
  const avgR = rs.length ? rs.reduce((a, x) => a + (x.r as number), 0) / rs.length : null;
  const full = xs.filter((x) => x.full).length;
  return `${label.padEnd(26)} n ${String(xs.length).padStart(3)} · win ${String(Math.round((100 * wins) / xs.length)).padStart(3)}% · net ${fmt(net).padStart(8)} $ · /trade ${fmt(net / xs.length).padStart(6)} $ · R/tr ${avgR == null ? '   —' : (avgR >= 0 ? '+' : '') + avgR.toFixed(2)} · stops ${full}`;
};
const group = <K extends string>(title: string, key: (x: Judged) => K, order?: K[]) => {
  const m = new Map<K, Judged[]>();
  for (const x of judged) (m.get(key(x)) ?? m.set(key(x), []).get(key(x))!).push(x);
  const keys = order ?? ([...m.keys()].sort() as K[]);
  console.log(`\n── ${title}`);
  for (const k of keys) if (m.has(k)) console.log(line(String(k), m.get(k)!));
};

console.log(`LIVE × RÉGIME — ${sym} · stratégies ${strategies.join(',')} · depuis ${since} · ${judged.length} trades jugés (sur ${trades.length})`);
console.log(line('TOUS', judged));
group('par mois', (x) => x.month);
group('par stratégie', (x) => `S${x.t.strategy}`);
group('ADX14 J-1 (force de tendance)', (x) => (x.adx < 20 ? 'ADX < 20 (range)' : x.adx < 30 ? 'ADX 20-30' : 'ADX ≥ 30 (tendance)'), ['ADX < 20 (range)', 'ADX 20-30', 'ADX ≥ 30 (tendance)']);
group('ATR20 percentile (volatilité)', (x) => (x.atrP < 33 ? 'ATR bas (<33)' : x.atrP < 66 ? 'ATR moyen' : 'ATR haut (≥66)'), ['ATR bas (<33)', 'ATR moyen', 'ATR haut (≥66)']);
group('tendance D1 (SMA50 + pente SMA20)', (x) => x.trend, ['up', 'down', 'flat']);
group('sens du trade vs tendance D1', (x) => x.align, ['with', 'against', 'flat']);
group('position dans le canal 20 j', (x) => (x.posInCh > 0.8 ? 'haut du canal (>80%)' : x.posInCh < 0.2 ? 'bas du canal (<20%)' : 'milieu'), ['bas du canal (<20%)', 'milieu', 'haut du canal (>80%)']);
group('range de la veille / ATR20', (x) => (x.prevRange < 0.7 ? 'veille calme (<0.7)' : x.prevRange > 1.5 ? 'veille agitée (>1.5)' : 'veille normale'), ['veille calme (<0.7)', 'veille normale', 'veille agitée (>1.5)']);
group('heure d’entrée (UTC)', (x) => `${String(x.hour).padStart(2, '0')}h`);
group('jour de la semaine', (x) => ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][x.wd], ['lun', 'mar', 'mer', 'jeu', 'ven']);
group('sens', (x) => x.t.dir, ['long', 'short']);

// ===== « Si on avait filtré » — par mois, pour voir si le filtre tient dans les deux régimes =====
const filters: Array<[string, (x: Judged) => boolean]> = [
  ['ADX ≥ 20 seulement', (x) => x.adx >= 20],
  ['ADX ≥ 25 seulement', (x) => x.adx >= 25],
  ['ATR percentile < 66', (x) => x.atrP < 66],
  ['dans le sens de la tendance D1', (x) => x.align === 'with'],
  ['pas contre la tendance D1', (x) => x.align !== 'against'],
  ['veille pas agitée (≤1.5 ATR)', (x) => x.prevRange <= 1.5],
  ['pas en haut/bas du canal', (x) => x.posInCh >= 0.2 && x.posInCh <= 0.8],
  ['ADX ≥ 20 ET pas contre la tendance', (x) => x.adx >= 20 && x.align !== 'against'],
];
const months = [...new Set(judged.map((x) => x.month))].sort();
console.log('\n── SI ON AVAIT FILTRÉ (net gardé / net évité, par mois)');
console.log(`${'filtre'.padEnd(36)} ${months.map((m) => m.padStart(22)).join('')}   ${'TOTAL gardé'.padStart(12)} ${'évité'.padStart(9)} ${'trades'.padStart(7)}`);
for (const [label, keep] of filters) {
  const cells = months.map((m) => { const xs = judged.filter((x) => x.month === m); const k = xs.filter(keep); const kept = k.reduce((a, x) => a + x.t.pnl, 0); const avoided = xs.reduce((a, x) => a + x.t.pnl, 0) - kept; return `${fmt(kept).padStart(9)} /${fmt(avoided).padStart(9)}`; });
  const k = judged.filter(keep); const kept = k.reduce((a, x) => a + x.t.pnl, 0); const avoided = judged.reduce((a, x) => a + x.t.pnl, 0) - kept;
  console.log(`${label.padEnd(36)} ${cells.join('')}   ${fmt(kept).padStart(12)} ${fmt(avoided).padStart(9)} ${String(k.length).padStart(4)}/${judged.length}`);
}
console.log('\nLecture : un filtre utile garde le vert d’août ET évite le rouge de septembre. Un filtre qui n’aide que sur un mois a été trouvé après coup, pas avant.');
