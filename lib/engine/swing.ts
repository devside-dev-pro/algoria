// COUCHE SWING — la stratégie "de fond" d'Algoria : positions H1 tenues des JOURS (week-end inclus),
// SL structurel, objectif loin, stop remonté par paliers (breakeven à 1R puis trailing). Complète le scalp
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
}

/** BTC — cassure du range 24h (labo : PF 2.02 sur 2.7 ans, robuste tiers + week-end).
 *  Lot 1 (choix produit) : 1R = 2×ATR H1 (~250-380$) × lot — à 0.5 les gains faisaient ~250-380$, maigres
 *  dans l'historique face au gold ; à 1 les sorties ~1R tombent dans la cible 500-800$. Revers assumé :
 *  un SL plein pèse pareil (~500-760$). */
// TRAIL ÉLARGI (activate 2.0, dist 3.0 au lieu de 2.5/2.5) : le breakout BTC a besoin d'encore plus d'air —
// backtest 2.7 ans → PF 2.02→2.25, +39%→+48% (petit échantillon 72 trades, amélioration probable). Config-only.
export const BTC_SWING: SwingConfig = { kind: 'breakout', N: 24, confirmAtr: 0.15, slAtr: 2, tpAtr: 16, lot: 1, beTrigger: 1, trailActivate: 2.0, trailDist: 3.0 };
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
export const GOLD_SWING: SwingConfig = { kind: 'trend', confirmAtr: 0, slAtr: 1, tpAtr: 16, lot: 1, beTrigger: 0.5, trailActivate: 2.5, trailDist: 2.5, ladder: [[2, 0.5]] };
/** NAS100 — cassure du range 72h (labo 2.2 ans : PF 1.94, +$3086, DD 6.9%, tiers ✅ · tenue moy 8.5 j). */
export const NAS_SWING: SwingConfig = { kind: 'breakout', N: 72, confirmAtr: 0.15, slAtr: 2, tpAtr: 16, lot: 3, beTrigger: 1, trailActivate: 2.5, trailDist: 2.5 };

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
      `H1 layer · SL ${cfg.slAtr}×ATR · target ${cfg.tpAtr}×ATR · BE at 1R then ${cfg.trailDist}R trailing — held for days`,
    ],
    confluence,
  };
}
