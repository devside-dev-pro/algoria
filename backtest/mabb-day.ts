// REJOUER UNE JOURNÉE DE L'EA ET LA COMPARER AU COMPTE (26/10/2026) — Mathieu a fait tourner la v1.20 en démo Raise FX le
// 26/10 : 4 achats à 1 lot. Ce script rejoue la même journée avec le moteur des labos (mabb-core.ts) et le réglage de l'EA,
// pour vérifier trade par trade que le backtest décrit bien le robot réel.
//
//   npx tsx backtest/mabb-day.ts XAUUSD --day 2026-10-26        (bougies : node scripts/pull-cache.mjs XAUUSD M5)
import { brokerOffset } from './broker-time';
import { E, T, adx, atr, fmt, m5, ndi, pdi, run, sym, type Cfg } from './mabb-core';

const dayArg = process.argv[process.argv.indexOf('--day') + 1] ?? '2026-10-26';
const target = Math.floor(Date.parse(`${dayArg}T00:00:00Z`) / 86_400_000); // jour serveur, comme T.openDay
// l'EA v1.20 tel que réglé par défaut (InpDailyLossPct 4 % = 2 000 $ sur le compte maître de 50 000 $)
const V120: Cfg = { fast: 3, slow: 8, trend: 200, adxMin: 20, di: true, rr: 0.5, sl: 3, catchUp: true, maxBars: 18, dayLossPct: 4 };
// historique MT5 du compte démo de Mathieu le 26/10/2026 (capture d'écran) : heure serveur, prix, stop, TP, sortie, profit
const ACCOUNT = [
  { open: '09:55:00', entry: 4007.5, sl: 3997.71, tp: 4012.69, close: '11:02:06', exit: 4013.15, pnl: 565 },
  { open: '12:35:00', entry: 4017.63, sl: 4008.86, tp: 4022.03, close: '14:05:00', exit: 4014.2, pnl: -343 },
  { open: '14:30:00', entry: 4014.91, sl: 4008.08, tp: 4018.43, close: '14:50:44', exit: 4018.69, pnl: 378 },
  { open: '17:15:00', entry: 4005.3, sl: 3989.19, tp: 4013.27, close: '17:19:39', exit: 4013.33, pnl: 803 },
];

const hm = (t: number) => new Date(t + brokerOffset(t)).toISOString().slice(11, 16);
const bars = m5.map((_, i) => i).filter((i) => T.openDay[i] === target);
console.log(`JOURNÉE DU ${dayArg} REJOUÉE — ${sym} · ${bars.length} bougies M5 ce jour-là${bars.length ? ` (${hm(m5[bars[0]].time)} → ${hm(m5[bars[bars.length - 1]].time)} heure serveur)` : ''}`);
if (!bars.length) { console.log('   aucune bougie : le cache ne couvre pas ce jour.'); process.exit(0); }

const ts = run(V120).trades.filter((t) => t.day === target);
console.log(`\n── LE LABO (entrée au premier prix de la bougie qui suit le signal, comme l'EA)`);
for (const t of ts) {
  const i = m5.findIndex((b) => b.time === t.openT), out = t.why === 'sortie au temps' || t.why === 'mise à plat' ? `à ${hm(t.closeT + 300_000)}` : `pendant la bougie de ${hm(t.closeT)}`;
  console.log(`   ${hm(t.openT + 300_000)} ${t.dir === 1 ? 'achat' : 'vente'} ${t.catchUp ? '(rattrapage) ' : ''}à ${t.entry.toFixed(2)} · stop ${t.sl.toFixed(2)} · TP ${t.tp.toFixed(2)} → ${t.why} ${out} à ${t.exit.toFixed(2)} : ${fmt(t.pnl)} $`);
  console.log(`      bougie du signal ${hm(t.openT)} : EMA 3 ${E(3)[i].toFixed(2)} / EMA 8 ${E(8)[i].toFixed(2)} / EMA 200 ${E(200)[i].toFixed(2)} · ADX ${adx[i].toFixed(1)} (+DI ${pdi[i].toFixed(1)}, −DI ${ndi[i].toFixed(1)}) · ATR ${atr[i].toFixed(2)}`);
}
console.log(`   total labo : ${ts.length} trades, ${fmt(ts.reduce((a, t) => a + t.pnl, 0))} $ (coûts de 0,32 $/oz déduits)`);

console.log(`\n── LE COMPTE DÉMO (historique MT5)`);
for (const a of ACCOUNT) console.log(`   ${a.open.slice(0, 5)} achat à ${a.entry.toFixed(2)} · stop ${a.sl.toFixed(2)} · TP ${a.tp.toFixed(2)} → sortie à ${a.close.slice(0, 5)} à ${a.exit.toFixed(2)} : ${fmt(a.pnl)} $`);
console.log(`   total compte : ${ACCOUNT.length} trades, ${fmt(ACCOUNT.reduce((a, t) => a + t.pnl, 0))} $`);

console.log(`\n── TRADE PAR TRADE`);
for (const a of ACCOUNT) {
  const t = ts.find((x) => hm(x.openT + 300_000) === a.open.slice(0, 5));
  if (!t) { console.log(`   ${a.open.slice(0, 5)} : dans le compte, PAS dans le labo`); continue; }
  console.log(`   ${a.open.slice(0, 5)} : même heure · entrée ${(a.entry - t.entry).toFixed(2)} $ d'écart · stop ${(a.sl - t.sl).toFixed(2)} · TP ${(a.tp - t.tp).toFixed(2)} · labo ${t.why}, compte ${fmt(a.pnl)} $ contre ${fmt(t.pnl)} $ au labo`);
}
for (const t of ts) if (!ACCOUNT.some((a) => a.open.slice(0, 5) === hm(t.openT + 300_000))) console.log(`   ${hm(t.openT + 300_000)} : dans le labo, PAS dans le compte`);
