import { readFileSync } from 'node:fs';
// WALK-FORWARD — le vaccin contre l'overfitting (étude 28/07). Le péché originel des configs actuelles :
// chaque paramètre a été choisi PARCE QU'il embellissait la fenêtre juin-juillet (le « net » des commentaires
// grimpe +9k → +23k sur la MÊME fenêtre). Ici : on règle sur la fenêtre A (tune), on évalue UNIQUEMENT sur
// la fenêtre B suivante (test, jamais vue), et on roule. La somme des fenêtres TEST est la seule performance
// qu'on a le droit de croire. RÈGLE D'OR : aucun changement de config ne passe en live s'il ne bat pas la
// prod sur les fenêtres test.
//   npx tsx backtest/walkforward.ts            → scalp M5 (S2 par défaut, grille de configs)
//   npx tsx backtest/walkforward.ts breakout   → breakout M5 (variantes + filtres de régime)
//   npx tsx backtest/walkforward.ts swing         → swing H1 sur l'or (variantes d'exit)
//   npx tsx backtest/walkforward.ts swing BTCUSD  → le MÊME jeu de candidats sur le BTC
//   npx tsx backtest/walkforward.ts all        → les trois
import { backtest, type SimParams } from './simulator';
import { metrics } from './metrics';
import { FEATURES } from '../lib/engine/features';
import { STRATEGIES } from '../lib/engine/strategies';
import { computeIndicators, labBacktest, SPECS, START, type Exits, type StrategyDef } from './labcore';
import { cfgFor, ctxFor, simFor, SIM_BASE } from './wiring';
import { simBreakout, BK_COSTS, BK_START, type BkOpts } from './breakout-core';
import { GOLD_BREAKOUT, type BreakoutConfig } from '../lib/engine/breakout';
import type { EngineConfig } from '../lib/engine/config';
import type { Bar } from '../lib/engine/types';


// FREQUENCE — information, PAS verdict (precision Mathieu, 01/08). Les « 4-6 » de S1 et « 10-20 » de S2
// sont des ORDRES DE GRANDEUR communiques au client, pas des objectifs a tenir : le marche offre ce qu'il
// offre, et un mois calme donnera moins de trades sans que rien ne soit casse. J'en avais fait un critere
// eliminatoire — c'etait une erreur de lecture de la spec.
// Ce que la colonne sert vraiment : distinguer deux candidats de P&L comparable (celui qui trade tous les
// jours n'est pas le meme produit que celui qui trade une fois par semaine), et reperer d'un coup d'oeil
// un candidat qui « gagne » simplement parce qu'il a cesse de jouer. On decrit, on ne sanctionne pas.
// Repere par COUCHE, pas par strategie : en live, S2 tient sa moyenne avec scalp ~6,5 + breakout ~4,5 +
// swing ~3 — d'ou la marge pour retrecir l'une si l'autre compense.
const volTag = (n: number, days: number) => {
  const perDay = days > 0 ? n / days : 0;
  const tag = perDay >= 5 ? 'quotidien' : perDay >= 2 ? 'regulier' : perDay >= 0.5 ? 'rare' : 'quasi a l\'arret';
  return `${perDay.toFixed(1)}/j ${tag}`;
};

const load = (f: string): Bar[] => JSON.parse(readFileSync(`backtest/.cache/${f}`, 'utf8'));
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

// ===== SCALP M5 : grille de configs candidates (S2 comme base) =====
function scalpWF() {
  const bars = load('XAUUSD-M5-15.json');
  const profile = STRATEGIES['2'];
  // `profile` par candidat : sans ça, on ne testait que des BOUTS de S1 (RR + trailing) sur le châssis de S2,
  // en laissant de côté ce qui la définit — objectif du jour à +1 %, Asie coupée, plafond de stop par défaut.
  // « Façon S1 » n'était pas S1. Ici on peut enfin faire tourner le profil ENTIER, tel qu'il tourne en live.
  type Cand = { name: string; profile?: typeof profile; cfg?: Partial<EngineConfig>; sim?: Partial<SimParams> };
  const CANDS: Cand[] = [
    { name: 'PROD S2 (filtre 12-17 inclus)' },
    { name: 'RR0.4 minRR0.2 (façon S1)', cfg: { targetRR: 0.4, minRR: 0.2, trailActivate: undefined, trailDist: undefined } },
    { name: 'RR0.8 minRR0.5', cfg: { targetRR: 0.8, minRR: 0.5 } },
    { name: 'sans trailing', cfg: { trailActivate: undefined, trailDist: undefined } },
    { name: 'BE retardé 0.3→+0.1', sim: { beTrigger: 0.3, beOffset: 0.1 } },
    { name: 'seuil 0.30 (plus sélectif)', cfg: { threshold: { soft: 0.3, normal: 0.3, turbo: 0.3, scalp: 0.3 } } },
    // filtre de session (étude 29/07) : le live 20→29/07 perd −12,7k sur Londres+US-open, l'edge sim vit
    // la nuit/Asie. Les overnights restent intacts — on bloque seulement les NOUVELLES entrées de jour.
    { name: 'sans entrées 07-17 UTC', sim: { blockEntryHours: [[7, 17]] } },
    { name: 'sans entrées 12-17 UTC', sim: { blockEntryHours: [[12, 17]] } },
    // FILTRE DE RÉGIME (01/08). Deux familles de mesure, testées séparément avant d'être combinées :
    // si l'une seule suffit, on garde la plus simple. Seuils volontairement dans les conventions de
    // place (ADX 20/25, ER 0.25/0.35) plutôt qu'optimisés — un seuil choisi sur la donnée serait
    // exactement le péché que ce fichier existe pour empêcher.
    { name: 'régime ADX ≥ 20', sim: { regime: { adxMin: 20 } } },
    { name: 'régime ADX ≥ 25', sim: { regime: { adxMin: 25 } } },
    { name: 'régime ER ≥ 0.25', sim: { regime: { erMin: 0.25 } } },
    { name: 'régime ER ≥ 0.35', sim: { regime: { erMin: 0.35 } } },
    { name: 'régime ADX ≥ 20 + ER ≥ 0.25', sim: { regime: { adxMin: 20, erMin: 0.25 } } },
    { name: 'régime ADX ≥ 20 + nuit only', sim: { regime: { adxMin: 20 }, blockEntryHours: [[12, 17]] } },
    // POURQUOI S1 TIENT (01/08) — S1 fait +$308 en live sur 11 jours quand le scalp S2 fait −$7 098, avec le
    // MÊME générateur de signaux. La différence est entièrement dans le profil. On teste donc le profil
    // ENTIER, puis chaque différence isolée : si une seule d'entre elles porte le résultat, on veut savoir
    // laquelle — une config qu'on ne comprend pas est une config qu'on ne saura pas défendre le jour où
    // elle cassera.
    // NUIT vs JOUR (01/08, forensique sur les 358 trades scalp de juillet en base) :
    //   NUIT 19h-05h : 95 trades, +$10 411, 92 % de reussite
    //   JOUR 05h-19h : 263 trades, −$19 560, 74 %
    // La perte MOYENNE est la meme des deux cotes (−$726 vs −$751) : le jour ne perd pas plus gros, il
    // perd bien plus souvent. Le filtre actuel ne bloque que 12-17h — un tiers du jour perdant.
    // On ne teste PAS heure par heure (ce serait du sur-mesure sur un mois) : une seule frontiere de
    // session, deplacee de 2 h autour, pour verifier que le resultat ne tient pas a un reglage fin.
    { name: 'nuit seule 19h-05h', sim: { blockEntryHours: [[5, 19]] } },
    { name: 'nuit large 18h-06h', sim: { blockEntryHours: [[6, 18]] } },
    { name: 'nuit stricte 20h-04h', sim: { blockEntryHours: [[4, 20]] } },
    // GEOMETRIE (meme forensique) : gain moyen +$167, perte moyenne −$749 — une perte efface 4,5 gains.
    // Les 10 pires trades pesent −$12 179, soit PLUS que la perte du mois (−$9 149) : sans eux, +$3 030.
    // Tous sortent au stop avec une distance de 9,5 a 15 $/once, soit $950-1 500 de risque. maxStopAtr 2.8
    // ne les arrete pas. On serre le plafond — en sachant que trop serrer tue l'edge (deja vu le 22/07).
    { name: 'stop max 2.0 ATR', cfg: { maxStopAtr: 2.0 } },
    { name: 'stop max 1.5 ATR', cfg: { maxStopAtr: 1.5 } },
    // PLAFOND ABSOLU — hypothèse RÉFUTÉE le 01/08 (voir config.ts:maxStopPrice). Les valeurs 2/3/4 $
    // sortaient ZÉRO trade : les stops initiaux vivent entre 4 et 15 $, et l'analyse qui avait motivé ce
    // candidat lisait le stop FINAL (déplacé au breakeven) en croyant lire celui de l'entrée.
    // On garde 6 $ et 9 $ — les seules valeurs qui mordent vraiment sur la distribution réelle — comme
    // témoins. Le classement sur le vrai stop initial ne montre AUCUNE relation (le bucket ≥ 11 $ est le
    // plus rentable), donc on s'attend à ce qu'ils ne servent à rien : c'est le but, un candidat mort
    // qu'on laisse au tableau vaut mieux qu'une idée fausse qui revient dans six semaines.
    { name: 'stop max 6$ (absolu)', cfg: { maxStopPrice: 6 } },
    { name: 'stop max 9$ (absolu)', cfg: { maxStopPrice: 9 } },
    // CONFIANCE (01/08) — le vrai enseignement de la soirée. Croisé avec signals.confidence :
    //   < 0.30 : 82 trades  −$4 593  ·  0.30-0.40 : 104 trades  +$1 302
    //   0.40-0.50 : 73 trades −$1 313  ·  ≥ 0.50 :  66 trades   +$859
    // Le taux de réussite est PLAT à 82 % partout sauf sous 0.30. Le score de confiance ne classe donc
    // presque rien — sauf qu'en dessous de 0.30 il détruit. Or S3 entre à 0.20 et S2 à 0.25 : les deux
    // achètent en plein dans la seule zone franchement perdante.
    { name: 'seuil 0.32', cfg: { threshold: { soft: 0.32, normal: 0.32, turbo: 0.32, scalp: 0.32 } } },
    { name: 'seuil 0.36', cfg: { threshold: { soft: 0.36, normal: 0.36, turbo: 0.36, scalp: 0.36 } } },
    { name: 'nuit 19h-05h + stop max 2.0', cfg: { maxStopAtr: 2.0 }, sim: { blockEntryHours: [[5, 19]] } },
    { name: 'PROFIL S1 COMPLET', profile: STRATEGIES['1'] },
    { name: 'PROFIL S1 + nuit 19h-05h', profile: STRATEGIES['1'], sim: { blockEntryHours: [[5, 19]] } },
    { name: 'S2 + objectif jour +1%', cfg: { risk: { ...cfgFor(profile).risk, dailyProfitTargetPct: 0.01 } } },
    { name: 'S2 sans Asie', sim: {} }, // ctxOpts remplacé plus bas (tradeAsia piloté par le profil)
    { name: 'S2 + TP court 0.4R', cfg: { targetRR: 0.4, minRR: 0.2 } },
  ];
  // « S2 sans Asie » = même config moteur, contexte de S1 : c'est le seul candidat dont la différence vit
  // dans ctxOpts et pas dans la config — on l'aiguille ici plutôt que d'ajouter un champ pour un seul cas.
  const ctxOf = (c: Cand) => (c.name === 'S2 sans Asie' ? { ...ctxFor(profile), tradeAsia: false } : ctxFor(c.profile ?? profile));
  // folds : ~15 jours de tune → ~5 jours de test, en roulant (bornes par index de bougie)
  const days = [...new Set(bars.map((b) => dayStr(b.time)))].sort();
  const TUNE = 15, TEST = 5;
  console.log(`\n========== WALK-FORWARD SCALP (S2 base) — ${days.length} jours · tune ${TUNE} → test ${TEST} ==========`);
  console.log('fold  (tune → test)             choisi sur tune            tune $     TEST $   TEST PF');
  let oosTotal = 0, tuneIllusion = 0, folds = 0;
  const oosByCand = new Map<string, { pnl: number; n: number }>();
  for (let start = 0; start + TUNE + TEST <= days.length; start += TEST) {
    const tuneDays = new Set(days.slice(start, start + TUNE));
    const testDays = new Set(days.slice(start + TUNE, start + TUNE + TEST));
    const tuneBars = bars.filter((b) => tuneDays.has(dayStr(b.time)));
    const testBars = bars.filter((b) => testDays.has(dayStr(b.time)));
    if (tuneBars.length < 400 || testBars.length < 300) continue;
    let best: { c: Cand; net: number } | null = null;
    for (const c of CANDS) {
      const cfg = { ...cfgFor(c.profile ?? profile), ...(c.cfg ?? {}) };
      const m = metrics(backtest(tuneBars, FEATURES, cfg, { ...simFor(c.profile ?? profile), ...(c.sim ?? {}), ctxOpts: ctxOf(c) }), SIM_BASE.startBalance);
      if (!best || m.netPnl > best.net) best = { c, net: m.netPnl };
    }
    if (!best) continue;
    const cfg = { ...cfgFor(best.c.profile ?? profile), ...(best.c.cfg ?? {}) };
    const t = metrics(backtest(testBars, FEATURES, cfg, { ...simFor(best.c.profile ?? profile), ...(best.c.sim ?? {}), ctxOpts: ctxOf(best.c) }), SIM_BASE.startBalance);
    // OOS par candidat SANS sélection : chaque candidat évalué sur CHAQUE fenêtre test — le vrai classement
    for (const c of CANDS) {
      const tc = metrics(backtest(testBars, FEATURES, { ...cfgFor(c.profile ?? profile), ...(c.cfg ?? {}) }, { ...simFor(c.profile ?? profile), ...(c.sim ?? {}), ctxOpts: ctxOf(c) }), SIM_BASE.startBalance);
      const cur = oosByCand.get(c.name) ?? { pnl: 0, n: 0 };
      cur.pnl += tc.netPnl; cur.n += tc.trades;
      oosByCand.set(c.name, cur);
    }
    oosTotal += t.netPnl; tuneIllusion += best.net; folds++;
    console.log(
      `#${folds}`.padEnd(5), `(${days[start]}→${days[start + TUNE + TEST - 1]})`.padEnd(26),
      best.c.name.padEnd(26), ('$' + best.net.toFixed(0)).padStart(8), ('$' + t.netPnl.toFixed(0)).padStart(9),
      (t.profitFactor === Infinity ? '∞' : t.profitFactor.toFixed(2)).padStart(8),
    );
  }
  console.log(`\n→ ILLUSION in-sample (somme des tunes gagnants) : $${tuneIllusion.toFixed(0)}`);
  console.log(`→ RÉALITÉ out-of-sample (somme des fenêtres test) : $${oosTotal.toFixed(0)} — c'est CE chiffre qu'on a le droit de croire.`);
  console.log(`→ OOS par candidat (somme des fenêtres test, sans sélection) — sur ${folds * TEST} jours de test :`);
  for (const [name, v] of [...oosByCand.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
    console.log('   ', name.padEnd(30), ('$' + v.pnl.toFixed(0)).padStart(9), String(v.n).padStart(6), 'tr', volTag(v.n, folds * TEST).padStart(20));
  }
}

// ===== BREAKOUT M5 : la couche qui n'avait aucun walk-forward (01/08) =====
// Ses chiffres étaient TOUS in-sample, y compris le filtre de régime qui semblait prometteur (ADX ≥ 25 :
// espérance doublée, deux mois sur deux). « Semblait » est le mot : un résultat in-sample sur une couche
// dont la config a déjà été re-réglée in-sample une fois n'est pas une preuve, c'est une répétition du
// même péché. Ici on règle sur la fenêtre A et on n'évalue que sur la B, jamais vue.
// Gestion INTRA-BOUGIE partout : depuis le 01/08 le sim déplace le stop comme le live (à la seconde).
function breakoutWF() {
  const bars = load('XAUUSD-M5-15.json');
  type Cand = { name: string; cfg?: Partial<BreakoutConfig>; opts?: BkOpts };
  const CANDS: Cand[] = [
    { name: 'PROD (ADX ≥ 25 depuis le 01/08)' },
    { name: 'ANCIENNE (BE .8 · trail 1.2@1.2)', cfg: { beTrigger: 0.8, trailActivate: 1.2, trailDist: 1.2 } },
    { name: 'sans BE ni trailing', cfg: { beTrigger: 0, trailActivate: 0, trailDist: 0 } },
    { name: 'N48 (canal 4h)', cfg: { N: 48 } },
    { name: 'N192 (canal 16h)', cfg: { N: 192 } },
    // BALAYAGE ADX (01/08) : ADX ≥ 25 est sorti largement en tête (+$10 313 OOS sur 102 trades), mais un
    // seul point ne prouve rien — un pic isolé entouré de creux, c'est du bruit qu'on a pris pour un edge.
    // On balaie 20 → 30 : si la courbe monte puis redescend en douceur, c'est une propriété du marché ;
    // si 25 est un pic solitaire, c'est la valeur qui allait bien à juillet et rien de plus.
    // Depuis le 01/08, PROD = GOLD_BREAKOUT PORTE deja ADX >= 25 (pousse en live apres ce balayage).
    // Le temoin utile n'est donc plus « avec filtre » mais « SANS » — et les variantes de seuil passent par
    // cfg.regime, qui REMPLACE la valeur de prod (via opts, elles s'ajouteraient au filtre existant et on
    // mesurerait toujours 25).
    { name: 'SANS filtre de régime (ex-PROD)', cfg: { regime: undefined } },
    { name: 'régime ADX ≥ 20', cfg: { regime: { adxMin: 20 } } },
    { name: 'régime ADX ≥ 22', cfg: { regime: { adxMin: 22 } } },
    { name: 'régime ADX ≥ 28', cfg: { regime: { adxMin: 28 } } },
    { name: 'régime ADX ≥ 30', cfg: { regime: { adxMin: 30 } } },
    { name: 'régime ER ≥ 0.25 (sans ADX)', cfg: { regime: { erMin: 0.25 } } },
    { name: 'régime ER ≥ 0.35 (sans ADX)', cfg: { regime: { erMin: 0.35 } } },
    { name: 'régime ADX ≥ 25 + ER ≥ 0.25', cfg: { regime: { adxMin: 25, erMin: 0.25 } } },
    { name: 'pas d\'entrée ven ≥ 12h UTC', opts: { noEntryFriFrom: 12 } },
  ];
  const run = (bs: Bar[], c: Cand) => metrics(simBreakout(bs, { ...GOLD_BREAKOUT, ...(c.cfg ?? {}) }, BK_COSTS, { intrabarManage: true, ...(c.opts ?? {}) }), BK_START);
  const days = [...new Set(bars.map((b) => dayStr(b.time)))].sort();
  const TUNE = 15, TEST = 5;
  console.log(`\n========== WALK-FORWARD BREAKOUT (M5) — ${days.length} jours · tune ${TUNE} → test ${TEST} ==========`);
  console.log('fold  (tune → test)             choisi sur tune            tune $     TEST $   TEST n');
  let oosTotal = 0, tuneIllusion = 0, folds = 0;
  const oosByCand = new Map<string, { pnl: number; n: number }>();
  for (let start = 0; start + TUNE + TEST <= days.length; start += TEST) {
    const tuneDays = new Set(days.slice(start, start + TUNE));
    const testDays = new Set(days.slice(start + TUNE, start + TUNE + TEST));
    // le canal Donchian a besoin de N=96 bougies d'amorce : sans ce préfixe, chaque fenêtre démarrerait
    // aveugle et le premier tiers des jours ne produirait aucun signal (biais silencieux contre le test).
    const tuneBars = bars.filter((b) => tuneDays.has(dayStr(b.time)));
    const testBars = bars.filter((b) => testDays.has(dayStr(b.time)));
    if (tuneBars.length < 400 || testBars.length < 300) continue;
    let best: { c: Cand; net: number } | null = null;
    for (const c of CANDS) {
      const m = run(tuneBars, c);
      if (!best || m.netPnl > best.net) best = { c, net: m.netPnl };
    }
    if (!best) continue;
    const t = run(testBars, best.c);
    for (const c of CANDS) {
      const tc = run(testBars, c);
      const cur = oosByCand.get(c.name) ?? { pnl: 0, n: 0 };
      cur.pnl += tc.netPnl; cur.n += tc.trades;
      oosByCand.set(c.name, cur);
    }
    oosTotal += t.netPnl; tuneIllusion += best.net; folds++;
    console.log(
      `#${folds}`.padEnd(5), `(${days[start]}→${days[start + TUNE + TEST - 1]})`.padEnd(26),
      best.c.name.padEnd(26), ('$' + best.net.toFixed(0)).padStart(8), ('$' + t.netPnl.toFixed(0)).padStart(9), String(t.trades).padStart(7),
    );
  }
  console.log(`\n→ ILLUSION in-sample (somme des tunes gagnants) : $${tuneIllusion.toFixed(0)}`);
  console.log(`→ RÉALITÉ out-of-sample (somme des fenêtres test) : $${oosTotal.toFixed(0)}`);
  console.log(`→ OOS par candidat (somme des fenêtres test, sans sélection) — sur ${folds * TEST} jours de test :`);
  for (const [name, v] of [...oosByCand.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
    console.log('   ', name.padEnd(30), ('$' + v.pnl.toFixed(0)).padStart(9), String(v.n).padStart(6), 'tr', volTag(v.n, folds * TEST).padStart(20));
  }
}

// ===== SWING H1 : variantes d'exit en walk-forward (tune 9 mois → test 3 mois) =====
/**
 * REFUS DE MESURER SUR UNE SÉRIE TROUÉE (02/09/2026).
 *
 * Le cache est un simple tableau : deux bougies séparées de trois semaines y deviennent VOISINES. EMA(600),
 * EMA(50) et ATR14 traversent alors la discontinuité sans la voir, et une stratégie qui exige 700 bougies de
 * chauffe se met à « chauffer » sur un collage de fragments. Le backtest ne mesure plus une stratégie, il
 * mesure des trous — et il rend un chiffre parfaitement présentable, ce qui est le pire des cas.
 *
 * Constaté sur BTCUSD H1 : 46 vrais trous, 13 367 heures absentes sur 24 648, soit 54 % du calendrier.
 * (L'or est sain : 5 trous, 482 heures — d'où le fait que le walk-forward or tourne depuis juillet et que
 * celui du BTC n'ait jamais existé. Personne n'avait regardé la donnée avant de faire confiance au résultat.)
 *
 * On préfère donc ne RIEN rendre plutôt qu'un chiffre faux, et dire quoi lancer pour y remédier.
 * Les vides de forme week-end ne comptent pas : le marché était fermé, il n'y a rien à combler.
 */
function assertContiguous(bars: Bar[], tfMs: number, sym: string, tf: string) {
  const closeMs = 6 * 3_600_000; // au-delà : ce n'est plus une fermeture de marché, c'est un trou
  let holes = 0, missing = 0, worst = 0;
  for (let i = 1; i < bars.length; i++) {
    const gap = bars[i].time - bars[i - 1].time;
    if (gap > closeMs) { holes++; missing += gap / tfMs - 1; worst = Math.max(worst, gap / tfMs - 1); }
  }
  if (!holes) return;
  const span = (bars[bars.length - 1].time - bars[0].time) / tfMs;
  console.error(`\n⛔ ${sym} ${tf} : série trouée — ${holes} trous, ~${Math.round(missing)} bougies absentes sur ${Math.round(span)} (${Math.round((missing / span) * 100)} %), plus gros trou ${Math.round(worst)}.`);
  console.error("   Un walk-forward là-dessus mesurerait les trous, pas la stratégie. Rien n'est calculé.");
  console.error(`   Pour combler :  tsx scripts/backfill-gaps.ts ${sym} ${tf}`);
  console.error('   (à lancer là où api.metaapi.cloud est joignable — machine locale ou Railway), puis');
  console.error(`   rafraîchir le cache :  node scripts/pull-cache.mjs ${sym} ${tf}`);
  process.exit(1);
}

// SYMBOLE PARAMÉTRABLE (02/09/2026) — la fonction était câblée sur l'or de bout en bout (cache, SPECS,
// libellé). Le BTC est la moitié du produit et n'avait jamais eu de walk-forward ; il en a un dès que sa
// donnée est comblée. Les candidats restent IDENTIQUES d'un symbole à l'autre : on veut savoir si l'edge
// tient ailleurs, pas fabriquer un jeu de réglages par marché — ce serait exactement le sur-ajustement que
// ce fichier existe pour empêcher.
function swingWF(sym: 'XAUUSD' | 'BTCUSD' = 'XAUUSD') {
  const raw = load(`${sym}-H1-15.json`);
  assertContiguous(raw, 3_600_000, sym, 'H1');
  const ind = computeIndicators(raw);
  const bars = ind.bars;
  const trendDef = (exits: Exits, tpAtr: number): StrategyDef => ({
    family: 'sw', params: 't', minBars: 700, exits,
    onClose(i, d) {
      const { bars: b, atr, emaF, emaS, ema21 } = d; if (i < 601) return null; const bar = b[i], a = atr[i];
      const bull = emaF[i] > emaS[i] * 1.001, bear = emaF[i] < emaS[i] * 0.999;
      const dip = b[i - 1].low < ema21[i - 1] || b[i - 2].low < ema21[i - 2], pop = b[i - 1].high > ema21[i - 1] || b[i - 2].high > ema21[i - 2];
      if (bull && dip && bar.close > bar.open && bar.close > ema21[i]) return { direction: 'long', stopLoss: bar.close - a, takeProfit: bar.close + tpAtr * a };
      if (bear && pop && bar.close < bar.open && bar.close < ema21[i]) return { direction: 'short', stopLoss: bar.close + a, takeProfit: bar.close - tpAtr * a };
      return null;
    },
  });
  const CANDS: Array<{ name: string; tpAtr: number; exits: Exits }> = [
    { name: 'PROD (TP16 · ladder 2R→.5 · trail 2.5)', tpAtr: 16, exits: { be: 1, trailActivate: 2.5, trailDist: 2.5, ladder: [[2, 0.5]] } },
    { name: 'TP8 · trail 2@2', tpAtr: 8, exits: { be: 1, trailActivate: 2, trailDist: 2 } },
    { name: 'PROD + WE perdants + sans entrée ven 12h', tpAtr: 16, exits: { be: 1, trailActivate: 2.5, trailDist: 2.5, ladder: [[2, 0.5]], weekendFlatLosers: true, noEntryFriFrom: 12 } },
    { name: 'TP8 trail2@2 + WE perdants + ven 12h', tpAtr: 8, exits: { be: 1, trailActivate: 2, trailDist: 2, weekendFlatLosers: true, noEntryFriFrom: 12 } },
  ];
  const N = bars.length, TUNE = Math.floor(N * 0.43), TEST = Math.floor(N * 0.14); // ~9 mois / ~3 mois
  console.log(`\n========== WALK-FORWARD SWING ${sym} (H1, ${N} bougies) — tune ~9 mois → test ~3 mois ==========`);
  console.log('fold  test window                 choisi sur tune                          TEST $   TEST PF');
  let oos = 0, folds = 0;
  const oosByCand = new Map<string, number>();
  for (let start = 0; start + TUNE + TEST <= N; start += TEST) {
    const tuneBars = bars.slice(start, start + TUNE);
    const testBars = bars.slice(Math.max(0, start + TUNE - 700), start + TUNE + TEST); // 700 barres de warmup réutilisées
    let best: { c: (typeof CANDS)[number]; net: number } | null = null;
    for (const c of CANDS) {
      const m = metrics(labBacktest(computeIndicators(tuneBars), trendDef(c.exits, c.tpAtr), SPECS[sym]), START);
      if (!best || m.netPnl > best.net) best = { c, net: m.netPnl };
    }
    if (!best) continue;
    const t = metrics(labBacktest(computeIndicators(testBars), trendDef(best.c.exits, best.c.tpAtr), SPECS[sym]), START);
    oos += t.netPnl; folds++;
    for (const c of CANDS) {
      const tc = metrics(labBacktest(computeIndicators(testBars), trendDef(c.exits, c.tpAtr), SPECS[sym]), START);
      oosByCand.set(c.name, (oosByCand.get(c.name) ?? 0) + tc.netPnl);
    }
    console.log(`#${folds}`.padEnd(5), `${dayStr(testBars[700]?.time ?? testBars[0].time)}→${dayStr(testBars[testBars.length - 1].time)}`.padEnd(26), best.c.name.padEnd(40), ('$' + t.netPnl.toFixed(0)).padStart(8), (t.profitFactor === Infinity ? '∞' : t.profitFactor.toFixed(2)).padStart(8));
  }
  console.log(`\n→ OOS de la sélection par tune : $${oos.toFixed(0)} sur ${folds} folds`);
  console.log('→ OOS par candidat (somme des fenêtres test, sans sélection) :');
  for (const [name, v] of [...oosByCand.entries()].sort((a, b) => b[1] - a[1])) console.log('   ', name.padEnd(42), '$' + v.toFixed(0));
}

const which = process.argv[2] ?? 'scalp';
// `swing` reste l'or par défaut : aucune commande déjà utilisée ne change de sens. `swing BTCUSD` ajoute le BTC.
const swingSym = (process.argv[3] ?? '').toUpperCase() === 'BTCUSD' ? 'BTCUSD' : 'XAUUSD';
if (which === 'swing') swingWF(swingSym);
else if (which === 'breakout') breakoutWF();
else if (which === 'all') { scalpWF(); breakoutWF(); swingWF(); }
else scalpWF();
console.log('\n[walkforward] terminé — backtest only.');
