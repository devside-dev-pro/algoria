// COUCHE DE TENDANCE JOURNALIÈRE — cassure de canal Donchian sur bougies D1 (03/09/2026).
//
// POURQUOI ELLE EXISTE. Le diagnostic du 02/09 (docs/PLAN-DIAGNOSTIC.md, backtest/edge-sessions.ts,
// backtest/edge-lab.ts) a établi que les trois générateurs de signaux en production — scalp de confluence,
// cassure M5, tendance H1 — touchent +1R avant −1R dans 46 à 52 % des cas sur deux ans, à toutes les
// sessions, sur l'or comme sur le BTC : des piles ou face, qui perdent les coûts. Neuf familles de règles
// intraday testées ensuite sont au même niveau. La SEULE règle qui sort de la ligne de base, hors
// échantillon, sur 18 ans d'or et 14 ans de BTC, est celle-ci (backtest/edge-lab-d1.ts, trend-d1.ts,
// trend-portfolio.ts) :
//   · +1R avant −1R : or 58 % contre 43 % de base (canal 50 j), BTC 62 % contre 41 % ;
//   · portefeuille or + BTC, 1 % de risque par trade, swaps réels du broker, 2012 → 2026 :
//     +14,8 %/an · 3 années négatives sur 15 (pire −1,4 %) · pire perte depuis un sommet depuis 2014 −21 % ·
//     plus longue période sans nouveau sommet 1 444 jours · ~9 trades par an et par marché.
// Ce que ça N'EST PAS : un moteur qui trade tous les jours. C'est ~9 entrées par an et par marché, tenues des
// semaines, avec des années plates. On le vend en R, pas en pourcentage de trades gagnants (37 % sur l'or).
//
// RÈGLES — les mêmes que backtest/trend-d1.ts, sans en changer une (un réglage vérifié qu'on modifie en
// passant en production n'est plus vérifié) :
//   · décision UNE fois par bougie journalière CLÔTURÉE, sur les bougies D1 du broker (celles du backtest) ;
//   · entrée : clôture au-dessus du plus-haut des N jours précédents → long ; sous le plus-bas → short ;
//     exécutée AU MARCHÉ à l'ouverture suivante (le backtest entre à l'open du lendemain) ;
//   · stop initial : slAtr × ATR(atrLen) sous/sur le prix d'entrée, TENU PAR LE BROKER ;
//   · sortie : clôture au-delà du canal opposé de exitN jours → fermeture à l'ouverture suivante ; sinon le
//     stop est remonté sur ce canal, jamais à reculons ;
//   · taille : riskPct de l'ÉQUITÉ, soit lot = risque / (distance du stop × taille du contrat) ;
//   · une position de tendance à la fois par marché ; pas de breakeven, pas de palier, pas de trailing
//     intraday : la gestion tick par tick de manage.ts est neutralisée sur ces positions (beTrigger 0), et la
//     protection avant annonce aussi — remonter le stop d'un trade de plusieurs semaines pour un CPI, c'est
//     sortir de la tendance à chaque publication.
import type { Bar, Confluence, Mode, Signal } from './types';

export interface TrendConfig {
  N: number; // canal d'ENTRÉE (jours) — plus-haut / plus-bas des N bougies précédentes
  exitN: number; // canal de SORTIE (jours) — le stop suit ce niveau ; clôture au-delà → sortie
  slAtr: number; // stop initial (× ATR journalier)
  atrLen: number; // longueur de l'ATR (jours)
  riskPct: number; // fraction de l'équité risquée par trade (0.01 = 1 %)
  minBars: number; // historique D1 minimal avant de décider
}

/** Réglage validé (backtest/trend-portfolio.ts) — IDENTIQUE sur les deux marchés, c'est voulu : un seul
 *  jeu de paramètres, pas un par marché ajusté après coup. */
export const GOLD_TREND: TrendConfig = { N: 50, exitN: 25, slAtr: 2, atrLen: 20, riskPct: 0.01, minBars: 260 };
export const BTC_TREND: TrendConfig = { ...GOLD_TREND };

const DAY_MS = 86_400_000;

/** ATR simple (moyenne des vraies étendues) sur les `len` dernières bougies — même formule que le backtest. */
export function trendAtr(bars: Bar[], len: number): number {
  const n = bars.length;
  if (!n) return 0;
  const from = Math.max(0, n - len);
  let s = 0;
  for (let i = from; i < n; i++) {
    const b = bars[i];
    s += i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low;
  }
  return s / (n - from);
}

/** Plus-haut des `n` bougies qui PRÉCÈDENT l'index `end` (exclu) — bars[end-n, end). */
export const channelHigh = (bars: Bar[], n: number, end = bars.length): number => {
  let h = -Infinity;
  for (let k = Math.max(0, end - n); k < end; k++) h = Math.max(h, bars[k].high);
  return h;
};
export const channelLow = (bars: Bar[], n: number, end = bars.length): number => {
  let l = Infinity;
  for (let k = Math.max(0, end - n); k < end; k++) l = Math.min(l, bars[k].low);
  return l;
};

/**
 * Ne garde que les bougies journalières CLÔTURÉES. Une bougie est close si une plus récente existe, ou si un
 * jour entier s'est écoulé depuis son ouverture. La dernière bougie renvoyée par le broker est en général celle
 * en cours : on ne décide jamais dessus (une cassure « à la clôture » n'existe qu'à la clôture).
 */
export function closedDailyBars(hist: Bar[], now = Date.now()): Bar[] {
  const bars = [...hist].sort((a, b) => a.time - b.time);
  return bars.filter((b, i) => i < bars.length - 1 || now >= b.time + DAY_MS);
}

/**
 * Signal d'ENTRÉE sur la dernière bougie D1 close. `price` = prix courant du marché : c'est le prix d'entrée
 * réel (au marché, à l'ouverture suivante), et le stop se mesure depuis lui — comme le backtest, qui pose le
 * stop à 2 ATR de l'OPEN du lendemain, pas de la clôture du signal.
 * Le lot est posé à 0 : il dépend de l'équité et de la spec du broker (voir trendLot), pas du moteur.
 */
export function trendSignal(symbol: string, closed: Bar[], cfg: TrendConfig, mode: Mode, price: number, priceStep = 0.01): Signal | null {
  if (closed.length < cfg.minBars) return null;
  const i = closed.length - 1;
  const b = closed[i];
  const hi = channelHigh(closed, cfg.N, i);
  const lo = channelLow(closed, cfg.N, i);
  const atr = trendAtr(closed, cfg.atrLen);
  if (!(atr > 0) || !(price > 0)) return null;
  let direction: 'long' | 'short' | null = null;
  if (b.close > hi) direction = 'long';
  else if (b.close < lo) direction = 'short';
  if (!direction) return null;

  const dec = Math.max(0, Math.round(-Math.log10(priceStep)));
  const roundP = (x: number) => +(Math.round(x / priceStep) * priceStep).toFixed(dec);
  const dir = direction === 'long' ? 1 : -1;
  const entry = roundP(price);
  const stopLoss = roundP(entry - dir * cfg.slAtr * atr);
  const confluence: Confluence = {
    direction, rawScore: dir, alignment: 1, quality: 1, macro: 1, confidence: 0.6,
    contributions: [{ key: 'trend', weight: 1, score: dir, weighted: dir }],
  };
  return {
    id: `${symbol}-trend-${b.time}-${direction}`,
    symbol,
    time: Date.now(), // heure d'OUVERTURE réelle (entrée au marché), pas celle de la bougie du signal
    direction,
    mode,
    confidence: 0.6,
    entry,
    stopLoss,
    takeProfits: [], // pas d'objectif : la sortie est le canal opposé de exitN jours
    riskReward: 0,
    lot: 0,
    rationale: [
      `TREND ${direction.toUpperCase()} — daily close ${b.close} ${direction === 'long' ? 'above' : 'below'} the ${cfg.N}-day ${direction === 'long' ? 'high' : 'low'} ${(direction === 'long' ? hi : lo).toFixed(dec)}`,
      `D1 layer · SL ${cfg.slAtr}×ATR(${cfg.atrLen}) = ${(cfg.slAtr * atr).toFixed(dec)} · exit on the ${cfg.exitN}-day channel (stop follows it, never backs off) · held for weeks`,
    ],
    confluence,
  };
}

/**
 * Décision de SORTIE / de remontée du stop sur la dernière bougie close, pour une position `dir` ouverte.
 *   exit  : la clôture est au-delà du canal opposé de exitN jours (bougies PRÉCÉDENTES, la dernière exclue) ;
 *   trail : le niveau de ce canal — nouveau stop si meilleur que l'actuel (l'appelant ne recule jamais).
 * Même fenêtre que le backtest : ll(i, EXIT) / hh(i, EXIT) sur [i−exitN, i).
 */
export function trendExit(closed: Bar[], cfg: TrendConfig, dir: 1 | -1): { exit: boolean; trail: number } {
  const i = closed.length - 1;
  const b = closed[i];
  const trail = dir === 1 ? channelLow(closed, cfg.exitN, i) : channelHigh(closed, cfg.exitN, i);
  const exit = dir === 1 ? b.close < trail : b.close > trail;
  return { exit, trail };
}

/**
 * Lot pour risquer `riskPct` de l'équité sur `riskDist` de prix : arrondi VERS LE BAS au pas du broker ; 0 si le
 * résultat passe sous le lot minimal — on ne prend pas un trade à 3 % de risque parce que le compte est petit,
 * on le saute et on le dit (le runner journalise le refus).
 */
export function trendLot(equity: number, riskPct: number, riskDist: number, contractSize: number, spec: { minVolume?: number; volumeStep?: number; maxVolume?: number } = {}): number {
  if (!(equity > 0) || !(riskDist > 0) || !(contractSize > 0)) return 0;
  const step = spec.volumeStep && spec.volumeStep > 0 ? spec.volumeStep : 0.01;
  const min = spec.minVolume && spec.minVolume > 0 ? spec.minVolume : 0.01;
  const max = spec.maxVolume && spec.maxVolume > 0 ? spec.maxVolume : 100;
  const raw = (equity * riskPct) / (riskDist * contractSize);
  const lot = Math.floor(raw / step + 1e-9) * step;
  if (lot < min - 1e-9) return 0;
  return Number(Math.min(lot, max).toFixed(2));
}
