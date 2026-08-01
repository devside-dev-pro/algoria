// VÉRIFICATION DU DÉTECTEUR DE RÉGIME — sur données SYNTHÉTIQUES, donc exécutable sans bougies réelles.
// Le filtre de régime ne vaut que s'il sait vraiment distinguer une tendance d'un marché latéral. Avant
// de le juger sur l'argent (walkforward.ts / breakout.ts), on le juge sur ce qu'il prétend mesurer :
// une rampe doit passer, une oscillation autour d'un prix fixe doit être refusée. Si ce fichier échoue,
// inutile de lire les dollars — le détecteur ne détecte rien.
//   npx tsx backtest/regime-check.ts
import { efficiencyRatio, regimeMask, regimeAt } from '../lib/engine/regime';
import { adx } from '../lib/engine/indicators';
import type { Bar } from '../lib/engine/types';

const T0 = Date.UTC(2026, 0, 5, 0, 0, 0);
const bar = (i: number, close: number, range: number): Bar => ({
  time: T0 + i * 300_000,
  open: close - range * 0.2,
  high: close + range / 2,
  low: close - range / 2,
  close,
  volume: 100,
});

/** rampe régulière + bruit : le prix va quelque part */
function trending(n: number, slope = 0.5): Bar[] {
  return Array.from({ length: n }, (_, i) => bar(i, 2000 + i * slope + Math.sin(i * 1.7) * 0.3, 1.2));
}
/** oscillation autour d'un prix fixe : le prix s'agite et revient */
function ranging(n: number, amp = 3): Bar[] {
  return Array.from({ length: n }, (_, i) => bar(i, 2000 + Math.sin(i / 2.3) * amp + Math.sin(i * 2.1) * amp * 0.4, 1.2));
}

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(ok ? '✅' : '❌', label.padEnd(52), detail);
  if (!ok) failures++;
};

const N = 400;
const up = trending(N);
const flat = ranging(N);

// ---- 1. Efficiency Ratio : ~1 sur une rampe, ~0 sur une oscillation
const erUp = efficiencyRatio(up, 20);
const erFlat = efficiencyRatio(flat, 20);
const mean = (a: number[]) => a.slice(100).reduce((s, v) => s + v, 0) / (a.length - 100);
check('ER élevé en tendance', mean(erUp) > 0.6, `ER moyen = ${mean(erUp).toFixed(2)}`);
check('ER faible en range', mean(erFlat) < 0.25, `ER moyen = ${mean(erFlat).toFixed(2)}`);

// ---- 2. ADX : au-dessus du seuil de place en tendance, en dessous en range
const adxUp = adx(up, 14);
const adxFlat = adx(flat, 14);
check('ADX > 25 en tendance', mean(adxUp) > 25, `ADX moyen = ${mean(adxUp).toFixed(1)}`);
check('ADX < 25 en range', mean(adxFlat) < 25, `ADX moyen = ${mean(adxFlat).toFixed(1)}`);

// ---- 3. Le masque : laisse passer la tendance, bloque le range
const passUp = regimeMask(up, { adxMin: 20, erMin: 0.25 }).slice(100).filter(Boolean).length / (N - 100);
const passFlat = regimeMask(flat, { adxMin: 20, erMin: 0.25 }).slice(100).filter(Boolean).length / (N - 100);
check('masque autorise la tendance', passUp > 0.8, `${(passUp * 100).toFixed(0)} % des bougies autorisées`);
check('masque bloque le range', passFlat < 0.2, `${(passFlat * 100).toFixed(0)} % des bougies autorisées`);

// ---- 4. Sans seuil : aucun effet (le filtre doit être strictement optionnel)
const none = regimeMask(flat, {});
check('sans seuil = aucun blocage', none.every(Boolean), `${none.filter(Boolean).length}/${none.length} autorisées`);

// ---- 5. CAUSALITÉ — la garantie qui rend le backtest honnête. La valeur en i doit être IDENTIQUE
// qu'on lui donne l'historique complet ou seulement les bougies jusqu'à i. Si ce test casse, le filtre
// lit le futur et tous les chiffres qui en découlent sont faux.
{
  const full = regimeMask(up, { adxMin: 20, erMin: 0.25 });
  let same = true;
  for (const i of [150, 220, 310, 399]) {
    const truncated = regimeMask(up.slice(0, i + 1), { adxMin: 20, erMin: 0.25 });
    if (truncated[i] !== full[i]) same = false;
  }
  check('causal (masque tronqué = masque complet)', same, 'aucune fuite du futur');
}

// ---- 6. Historique insuffisant → refus, jamais une valeur inventée
{
  const tiny = regimeMask(up.slice(0, 10), { adxMin: 20, erMin: 0.25 });
  check('fenêtre trop courte = refus', tiny.every((v) => !v), `${tiny.filter(Boolean).length} autorisée(s) sur 10`);
}

// ---- 7. regimeAt (la forme que prendra le live) est cohérent avec le masque
{
  const r = regimeAt(up, { adxMin: 20, erMin: 0.25 });
  const f = regimeAt(flat, { adxMin: 20, erMin: 0.25 });
  check('regimeAt étiquette la tendance', r.label === 'trend', `adx ${r.adx.toFixed(1)} · er ${r.er.toFixed(2)} → ${r.label}`);
  check('regimeAt étiquette le range', f.label === 'range', `adx ${f.adx.toFixed(1)} · er ${f.er.toFixed(2)} → ${f.label}`);
}

console.log(failures ? `\n❌ ${failures} vérification(s) en échec — ne pas se fier aux backtests de régime.` : '\n✅ détecteur de régime conforme — les backtests peuvent être lus.');
process.exit(failures ? 1 : 0);
