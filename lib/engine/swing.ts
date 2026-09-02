// COUCHE SWING — la stratégie "de fond" d'Algoria : positions H1 tenues des JOURS (week-end inclus),
// SL structurel, objectif loin, stop remonté par paliers (breakeven puis trailing — seuils par marché,
// voir beTrigger de chaque config ci-dessous : 0.5R sur l'or depuis #296, 1R sur BTC et NAS). Complète le scalp
// (spectacle intraday) sans le toucher : slot de position séparé, lots dédiés.
// Validée par le labo (backtest/lab.ts <SYM> H1, portes moitiés+tiers+week-end) :
//   BTCUSD  breakout N24 trail2.5 — 2.7 ans · 56% win · PF 2.02 · +39% à 1% de risque · DD 9.2% · week-end PF 2.7
//   XAUUSD  sw-trend   trail2.5 — 1.75 an · 57% win · PF 2.21 · +88% · DD 11.4% · en position 67% du temps
import type { Bar, Confluence, Mode, Signal } from './types';

export interface SwingConfig {
  kind: 'breakout' | 'trend';
  N?: number; // fenêtre Donchian en HEURES (kind breakout)
  confirmAtr: number; // marge anti-mèche (× ATR H1)
  slAtr: number; // stop structurel (× ATR H1)
  tpAtr: number; // objectif LOIN (× ATR H1) — le trailing sort en général avant
  lot: number; // lot FIXE dédié à la couche swing
  beTrigger: number; // breakeven à × riskDist (1R — un swing a besoin d'air)
  trailActivate: number; // trailing activé à × riskDist
  trailDist: number; // distance du trailing (× riskDist) — les "paliers" qui sécurisent
  // PALIERS de verrouillage : [plus-haut atteint en R, niveau de SL verrouillé en R]. Combiné (max) avec le BE
  // et le trailing, jamais dans le mauvais sens. Backtesté (backtest/swing-ladder.ts) : sur GOLD, verrouiller
  // +0.5R à 2R garde le PF (1.72) et monte le rendement (+189%→+251%) — évite le « beau trade qui rentre à BE ».
  ladder?: [number, number][];
  /**
   * Heure UTC à partir de laquelle on refuse une NOUVELLE entrée swing le vendredi.
   *
   * Était codée en dur à 12h dans le runner, pour TOUS les marchés (assurance week-end du 29/07). Le
   * walk-forward du 02/09 montre que les deux marchés veulent l'inverse l'un de l'autre, et de loin :
   *
   *          coupure ven.    12h        18h        19h      aucune
   *   OR       11 313 $   14 072 $   14 403 $   14 018 $     → plus TARD vaut mieux
   *   BTC       7 313 $    5 200 $    4 783 $    4 331 $     → plus TÔT vaut mieux (gradient monotone)
   *
   * Le paramètre unique était donc juste pour le BTC et coûtait ~2 759 $ sur l'or, dans les 4 folds sur 4.
   *
   * POURQUOI L'OR EST À 18h ET NON 19h, qui sort pourtant premier : prendre le maximum de trois valeurs
   * testées est exactement le sur-ajustement que backtest/walkforward.ts existe pour empêcher. 18h se
   * justifie SANS la donnée — l'incident du 26/07 (deux shorts ouverts à 19h, −1 850 $ chacun au ré-open
   * du dimanche) est couvert avec une heure de marge. Et 18h et 19h sont sur le même plateau : 331 $ les
   * séparent, contre 2 759 $ qui les séparent de 12h. On choisit l'heure défendable, pas la plus haute.
   *
   * L'or ferme à 21h UTC : couper à 20h ne bloque plus rien (357 trades, comme sans règle du tout).
   */
  noEntryFriFromUtc?: number;
}

/** BTC — cassure du range 24h (labo : PF 2.02 sur 2.7 ans, robuste tiers + week-end).
 *  Lot 1 (choix produit) : 1R = 2×ATR H1 (~250-380$) × lot — à 0.5 les gains faisaient ~250-380$, maigres
 *  dans l'historique face au gold ; à 1 les sorties ~1R tombent dans la cible 500-800$. Revers assumé :
 *  un SL plein pèse pareil (~500-760$). */
// TRAIL ÉLARGI (activate 2.0, dist 3.0 au lieu de 2.5/2.5) : le breakout BTC a besoin d'encore plus d'air —
// backtest 2.7 ans → PF 2.02→2.25, +39%→+48% (petit échantillon 72 trades, amélioration probable). Config-only.
export const BTC_SWING: SwingConfig = { kind: 'breakout', N: 24, confirmAtr: 0.15, slAtr: 2, tpAtr: 16, lot: 1, beTrigger: 1, trailActivate: 2.0, trailDist: 3.0, noEntryFriFromUtc: 12 };
/** OR — suivi de tendance EMA longues + reprise après repli.
 *  STOP RESSERRÉ slAtr 1 (au lieu de 2) : le copieur des clients est en LOT FIXE, donc le risque client =
 *  largeur du stop × SON lot, indépendant du lot master. Un stop 2×ATR (~37 pts) = −187$ sur un compte 500$
 *  (37% en un trade) ; à 1×ATR (~18 pts) ça tombe à −93$ (19%). L'edge tient : backtest 637j gold H1 →
 *  PF 1.79, robuste sur les 3 tiers (T1 1.28 · T2 2.23 · T3 1.69) ; il ne s'écroule qu'en dessous
 *  (slAtr 0.5 → PF 1.29, DD 27%).
 *
 *  LOT 1 (07/08, était 0.5) — ALIGNÉ SUR TOUTES LES AUTRES COUCHES. Le raisonnement précédent (« 0.5
 *  rapproche la fraction copiée du scalp ») était FAUX de bout en bout : le copieur STH envoie un lot FIXE
 *  par receveur, identique quelle que soit la couche. Le lot du master n'a donc AUCUNE influence sur ce que
 *  prend le client — un swing master à 0.5 et un swing master à 1 produisent exactement le même trade sur
 *  son compte. Il n'y a jamais eu de « fraction copiée » à ajuster.
 *
 *  Ce que 0.5 changeait vraiment, c'était deux choses, toutes deux nuisibles :
 *    • l'HISTORIQUE mentait — le master affichait −982$ là où le client encaissait l'équivalent d'un
 *      −1964$ master. La douleur du swing était divisée par deux à l'écran, et c'est cet écran qui sert
 *      de référence aux membres ;
 *    • les CAPS JOURNALIERS se déclenchaient deux fois trop tard sur cette couche — ils comptent en
 *      dollars master, donc un swing perdant ne consommait que la moitié du budget de perte qu'il coûtait
 *      réellement au client. Le garde-fou censé protéger les comptes protégeait mal.
 *  Contrepartie assumée : un stop plein passe de ~935$ à ~1870$ sur le maître, soit ~67% du cap journalier
 *  S2 en un seul trade. C'est le vrai poids de ce trade chez le client — il est désormais affiché tel quel. */
// PALIER +0.5R à 2R (ladder) : verrouille un petit profit sur les trades qui plafonnent à 2-2.5R au lieu de
// les laisser rentrer à BE — backtest 637j gold → PF 1.72 tenu, +189%→+251%. Trail 2.5R gardé (runners).
//
// BREAKEVEN 1R → 0.5R (12/08/2026, décision Mathieu : « passer de +1 000$ à −1 300$ sur un mouvement, ce
// n'est pas normal »). À 1R le swing n'a AUCUNE protection sur toute la première moitié de son parcours.
// Rejeu de 92 swings or réels (06/07→12/08, M5, 5 jours d'horizon, coûts déduits), en ne changeant QUE ce
// seuil — le reste (palier 2R, trailing 2.5/2.5) est identique d'une ligne à l'autre :
//   BE     espérance   % verts   STOPS PLEINS   gain moyen
//   1.00R   −0.105R      51%         43           0.813R   ← l'actuel, le pire du tableau
//   0.75R   −0.012R      61%         34           0.671R
//   0.50R   +0.043R      72%         24           0.490R   ← retenu
//   0.35R   −0.041R      79%         17           0.219R
//   0.25R   −0.048R      77%         16           0.205R
//   0.15R   +0.021R      80%         11           0.186R
// 0.5R est le meilleur du tableau et le seul dont les DEUX moitiés d'échantillon tiennent. Descendre plus
// bas (0.25, testé à la demande) effondre le gain moyen de 0.490R à 0.205R : on recréerait sur le swing le
// problème des « miettes » qu'on venait de corriger sur le scalp — beaucoup de verts qui ne rapportent rien.
// ⚠️ HONNÊTETÉ STATISTIQUE : sur 92 trades, les écarts d'ESPÉRANCE entre 0.15 et 0.50 sont dans le bruit
// (erreur-type ~0.09R). Ce qui est solide, et purement mécanique, c'est que le nombre de stops pleins baisse
// de façon MONOTONE quand on abaisse le seuil (43→34→24→17→16→11), et que 1R est nettement le pire.
// PALIERS 0.75/1/1.5/2 (19/08/2026, décision Mathieu). Le palier unique [[2, 0.5]] laissait un TROU entre
// 0.5R et 2R : sur toute cette portion, un swing n'était protégé qu'au breakeven. Constaté en direct le
// 19/08 — un swing or à +1,72R (+3 496$ master) avec son stop à +0,75 point, soit +75$ verrouillés ; sans
// intervention manuelle, un aller-retour rendait la totalité. C'est le MÊME défaut que celui corrigé le
// 12/08 sur le breakeven (« passer de +1 000$ à −1 300$ sur un mouvement, ce n'est pas normal »), un cran
// plus loin sur la courbe : le BE couvre le début du parcours, le trailing couvre la fin, et personne ne
// couvrait le milieu.
//
// Rejeu de 72 swings or RÉELS (06/07→19/08, bougies M1, horizon 3 j, remplissage conservateur — le stop est
// testé contre le sommet atteint AVANT la bougie), en ne changeant QUE l'échelle de paliers :
//   réglage                                    espérance   % verts   STOPS PLEINS   gain moyen
//   [[2,0.5]]                    ← l'actuel      0.138 R      78%          16          0.464 R
//   [[1,0.3],[2,0.5]]                            0.163 R      78%          16          0.495 R
//   [[1,0.5],[1.5,1],[2,1.5]]                    0.212 R      78%          16          0.559 R
//   [[0.75,0.3],[1,0.5],[1.5,1],[2,1.5]]         0.238 R      78%          16            —     ← retenu
//   trailing avancé à 1.5R (dist 1.0)            0.151 R      78%          16          0.480 R
//   trailing avancé à 1R  (dist 0.75)            0.132 R      78%          16          0.456 R
//
// ⚠️ HONNÊTETÉ STATISTIQUE : en comparaison APPARIÉE sur les mêmes 72 trades, le gain vaut +0.0996 R avec
// une erreur-type de 0.0699, soit t = 1.43 — PAS significatif. On ne retient donc PAS ce réglage sur son
// espérance. Ce qui est solide est mécanique :
//   • le nombre de STOPS PLEINS est IDENTIQUE (16) dans toutes les variantes, et le % de verts aussi (78%).
//     Normal : aucun de ces paliers n'agit en dessous de +0.5R, donc aucun ne peut transformer un gagnant
//     en perdant. Le risque à la baisse est INCHANGÉ — c'est un pari dont le pire cas est « sans effet ».
//   • l'asymétrie : 28 trades améliorés contre 4 dégradés (7 contre 1). Les 4 dégradés sont des trades où
//     le palier a verrouillé avant que le prix ne reparte — le prix de l'assurance, connu et accepté.
// ⚠️ Le harnais est OPTIMISTE en niveau absolu (+0.125 R simulé contre +0.004 R réellement constaté) : il
// ne modélise ni le spread, ni la commission, ni les caps journaliers, ni les fermetures manuelles.
// Corrélation rejeu/réel 0.70 sur 58 trades. Seules les COMPARAISONS entre lignes du tableau sont valides.
//
// PORTÉE : GOLD uniquement. BTC_SWING et NAS_SWING ne sont PAS touchés — ils n'ont pas été rejoués, et
// leur ATR, leur slAtr (2 au lieu de 1) et leur beTrigger (1R) donnent une géométrie différente.
//
// Effet de bord assumé : avec le palier 2R→1.5, le trailing (2.5/2.5) ne prend la main qu'au-delà de 4R
// (2.5 de distance ⇒ il ne dépasse 1.5R qu'à partir de peak 4R). En dessous, ce sont les paliers qui
// pilotent. Aucune variante « paliers + trailing resserré » n'a été retenue : la seule testée (trail 2.0,
// dist 1.0) ressort à t = 0.06, donc sans effet — on n'ajoute pas un changement non prouvé à un autre.
export const GOLD_SWING: SwingConfig = { kind: 'trend', confirmAtr: 0, slAtr: 1, tpAtr: 16, lot: 1, beTrigger: 0.5, trailActivate: 2.5, trailDist: 2.5, ladder: [[0.75, 0.3], [1, 0.5], [1.5, 1.0], [2, 1.5]], noEntryFriFromUtc: 18 };
/** NAS100 — cassure du range 72h (labo 2.2 ans : PF 1.94, +$3086, DD 6.9%, tiers ✅ · tenue moy 8.5 j). */
// NAS100 : PAS rejoué le 02/09 (aucun cache à jour), donc on lui laisse le 12h historique EXPLICITEMENT
// plutôt que de le faire hériter d'un défaut. Un marché non mesuré ne change pas de comportement.
export const NAS_SWING: SwingConfig = { kind: 'breakout', N: 72, confirmAtr: 0.15, slAtr: 2, tpAtr: 16, lot: 3, beTrigger: 1, trailActivate: 2.5, trailDist: 2.5, noEntryFriFromUtc: 12 };

const ema = (src: number[], n: number): number[] => {
  const k = 2 / (n + 1);
  const out = new Array(src.length);
  out[0] = src[0];
  for (let i = 1; i < src.length; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
  return out;
};

const atr14 = (bars: Bar[]): number => {
  const n = bars.length;
  const from = Math.max(1, n - 14);
  let sum = 0;
  for (let i = from; i < n; i++)
    sum += Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  return sum / (n - from);
};

/** Bougies H1 minimum requises avant de trader (les EMA longues du mode trend doivent être mûres). */
export const swingMinBars = (cfg: SwingConfig): number => (cfg.kind === 'trend' ? 620 : (cfg.N ?? 24) + 20);

/**
 * Détection sur CLÔTURE H1 (bars = historique H1, la dernière bougie vient de clore). Mêmes règles que le labo :
 * - breakout : clôture au-delà du plus haut/bas des N heures PRÉCÉDENTES (+ marge ATR anti-mèche) ;
 * - trend    : biais EMA(240/600) net + repli sous l'EMA21 dans les 2 dernières bougies + bougie de reprise.
 */
export function swingSignal(symbol: string, bars: Bar[], cfg: SwingConfig, mode: Mode, priceStep = 0.01): Signal | null {
  if (bars.length < swingMinBars(cfg)) return null;
  const b = bars[bars.length - 1];
  const a = atr14(bars);
  if (!a) return null;

  let direction: 'long' | 'short' | null = null;
  let note = '';
  if (cfg.kind === 'breakout') {
    const N = cfg.N ?? 24;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = bars.length - 1 - N; k < bars.length - 1; k++) {
      hi = Math.max(hi, bars[k].high);
      lo = Math.min(lo, bars[k].low);
    }
    if (b.close > hi + cfg.confirmAtr * a) { direction = 'long'; note = `${N}h high ${hi.toFixed(1)} broken`; }
    else if (b.close < lo - cfg.confirmAtr * a) { direction = 'short'; note = `${N}h low ${lo.toFixed(1)} broken`; }
  } else {
    const close = bars.map((x) => x.close);
    const eF = ema(close, 240);
    const eS = ema(close, 600);
    const e21 = ema(close, 21);
    const i = bars.length - 1;
    const bull = eF[i] > eS[i] * 1.001;
    const bear = eF[i] < eS[i] * 0.999;
    const dipped = bars[i - 1].low < e21[i - 1] || bars[i - 2].low < e21[i - 2];
    const popped = bars[i - 1].high > e21[i - 1] || bars[i - 2].high > e21[i - 2];
    if (bull && dipped && b.close > b.open && b.close > e21[i]) { direction = 'long'; note = 'uptrend pullback resumed'; }
    else if (bear && popped && b.close < b.open && b.close < e21[i]) { direction = 'short'; note = 'downtrend pullback resumed'; }
  }
  if (!direction) return null;

  const dec = Math.max(0, Math.round(-Math.log10(priceStep)));
  const roundP = (x: number) => +(Math.round(x / priceStep) * priceStep).toFixed(dec);
  const dir = direction === 'long' ? 1 : -1;
  const entry = roundP(b.close);
  const stopLoss = roundP(entry - dir * cfg.slAtr * a);
  const tp = roundP(entry + dir * cfg.tpAtr * a);
  const confluence: Confluence = {
    direction, rawScore: dir, alignment: 1, quality: 1, macro: 1, confidence: 0.75,
    contributions: [{ key: 'swing', weight: 1, score: dir, weighted: dir }],
  };
  return {
    id: `${symbol}-swing-${b.time}-${direction}`,
    symbol,
    time: b.time,
    direction,
    mode,
    confidence: 0.75,
    entry,
    stopLoss,
    takeProfits: [tp],
    riskReward: cfg.tpAtr / cfg.slAtr,
    lot: cfg.lot,
    rationale: [
      `SWING ${direction.toUpperCase()} (${cfg.kind}) — ${note}`,
      `H1 layer · SL ${cfg.slAtr}×ATR · target ${cfg.tpAtr}×ATR · BE at ${cfg.beTrigger}R then ${cfg.trailDist}R trailing — held for days`,
    ],
    confluence,
  };
}
