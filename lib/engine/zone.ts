// COUCHE « ZONE » — cassure du range de la VEILLE puis retest, sur M5 (06/09/2026).
//
// D'OÙ ÇA VIENT. Décision Mathieu du 06/09 : « on ne crée rien nous-mêmes, on prend un truc déjà prêt ».
// Cinq dépôts publics analysés ; les règles lisibles de deux EA rejouées sur deux ans de nos bougies M5
// (backtest/ea-arena.ts). Celle-ci est la variante A′ de blackXAU « H4 Zone Retest » v1.22 (phatnomenal) :
// la même entrée, SANS son trailing à 1 $ (qui la transforme en scalp et ramène le résultat à zéro depuis juin).
//
// CE QUE LE LABO A DIT — à relire avant d'y attacher un membre, et à ne pas embellir :
//   · 2 ans (oct 2024 → sept 2026), 1 lot, coûts 0,32 $/oz : 271 trades · 35 % gagnants · +55 644 $ · PF 1,15 ·
//     pire creux −49 941 $ (≈ le solde du master) · 14 mois verts sur 24 ;
//   · la même entrée avec une direction AU HASARD fait +44 810 $ : l'essentiel du gain, c'est l'or qui monte
//     sur la période, pas la règle. La direction apporte ~+11 k$ sur 271 trades ;
//   · depuis le 1er juin 2026 : 40 trades · +27 837 $ · PF 1,40 · creux −29 013 $. Trop peu de trades pour
//     conclure. Un membre à 0,01 lot divise tout par 100 : le pire creux vaut −500 $ sur un compte à 200 $.
// Mathieu a vu ces chiffres et a décidé de la connecter (« Go la connecter »). Opt-in : ZONE_XAUUSD=1.
//
// RÈGLES (les mêmes que l'arène, sans en changer une) :
//   · zone = plus-haut / plus-bas du JOUR BROKER précédent (les bougies D1 du broker, la dernière close) ;
//   · sur chaque M5 CLÔTURÉE, dans la session 7 h-22 h heure broker : cassure haussière si open ≤ zoneHigh <
//     close et (corps ≥ 50 % de la bougie OU corps ≥ 2 $) ; symétrique à la baisse. On passe alors en ATTENTE
//     de retest, 24 h au plus ; un changement de jour broker annule l'attente ;
//   · retest = une M5 close dont le plus-bas (resp. plus-haut) touche le bord de la zone → entrée, si la
//     clôture H1 est au-dessus de l'EMA50 ET de l'EMA200 H1 (resp. en dessous). Une seule chance : le retest
//     refusé par l'EMA n'est pas réessayé ;
//   · SL = entrée − 1,5 × ATR(H1, 14) de la DERNIÈRE H1 CLOSE, TP = entrée + 3 × ATR. Tenus par le broker ;
//     aucun breakeven, aucun palier, aucun trailing, aucune protection avant annonce ;
//   · une position de zone à la fois ; lot FIXE ; les positions traversent la nuit et le week-end.
//
// ÉCARTS ASSUMÉS AVEC L'ARÈNE (dits ici pour ne pas être découverts plus tard) :
//   1. l'arène testait le filtre EMA sur la clôture de l'heure ENTIÈRE qui contient la M5 — une anticipation
//      de 0 à 55 min. Ici (et dans l'arène corrigée du 06/09) on prend l'EMA prolongée avec la clôture M5
//      courante : causal, calculable en live ;
//   2. l'arène entrait AU NIVEAU de la zone ; en live on entre au marché sur la clôture de la M5 de retest.
//      Le prix a déjà touché le niveau et peut s'en être écarté de quelques dollars, dans un sens ou l'autre ;
//   3. l'arène ne connaissait ni spread max, ni kill switch, ni veto portefeuille : le live les applique.
import type { Bar, Confluence, Mode, Signal } from './types';

export interface ZoneConfig {
  sessionFrom: number; // première heure broker (incluse) où une cassure compte
  sessionTo: number; // dernière heure broker (incluse)
  bodyMinFrac: number; // corps ≥ fraction de la bougie de cassure
  bodyMinAbs: number; // ou corps ≥ ce montant ($)
  retestMaxMs: number; // délai maximal entre cassure et retest
  emaFast: number; // EMA H1 rapide
  emaSlow: number; // EMA H1 lente
  atrLen: number; // ATR H1 (moyenne mobile de Wilder, comme l'arène)
  slAtr: number; // stop (× ATR H1)
  tpAtr: number; // objectif (× ATR H1)
  lot: number; // lot FIXE
  minH1Bars: number; // historique H1 minimal avant de décider (EMA200 a besoin d'air)
}

/** Réglage de l'arène, tel quel. Lot 1 = le master (le copieur redimensionne par compte membre). */
export const GOLD_ZONE: ZoneConfig = {
  sessionFrom: 7, sessionTo: 22, bodyMinFrac: 0.5, bodyMinAbs: 2, retestMaxMs: 86_400_000,
  emaFast: 50, emaSlow: 200, atrLen: 14, slAtr: 1.5, tpAtr: 3,
  lot: Number(process.env.ZONE_XAUUSD_LOT ?? 1) || 1,
  minH1Bars: 400,
};

/** État de la machine cassure → retest. Volontairement plat : journalisable, restaurable, testable. */
export interface ZoneState {
  zoneDay: number; // clé du jour broker dont la zone est chargée (−1 = rien)
  zh: number; // plus-haut de la veille
  zl: number; // plus-bas de la veille
  waiting: boolean; // une cassure attend son retest
  dir: 1 | -1; // sens de la cassure en attente
  bkTime: number; // heure d'ouverture de la M5 de cassure
}
export const ZONE_IDLE: ZoneState = { zoneDay: -1, zh: 0, zl: 0, waiting: false, dir: 1, bkTime: 0 };

const DAY_MS = 86_400_000;

/**
 * Décalage broker ↔ UTC déduit des bougies D1 du broker : une D1 ouvre à minuit heure broker, donc son heure
 * d'ouverture en UTC dit tout (ouverture 21:00 UTC → broker = UTC+3). Se recalibre seul aux changements d'heure.
 */
export function brokerOffsetMs(d1: Bar[]): number {
  const b = d1[d1.length - 1];
  if (!b) return 3 * 3_600_000; // à défaut : l'hypothèse de l'arène (UTC+3)
  const open = b.time % DAY_MS;
  return open === 0 ? 0 : DAY_MS - open;
}
export const brokerDay = (t: number, offsetMs: number): number => Math.floor((t + offsetMs) / DAY_MS);
export const brokerHour = (t: number, offsetMs: number): number => new Date(t + offsetMs).getUTCHours();

/** EMA classique sur les clôtures, valeur finale ; `extra` = une clôture supplémentaire (la M5 courante). */
export function emaLast(bars: Bar[], len: number, extra?: number): number {
  const k = 2 / (len + 1);
  let e = 0;
  for (let i = 0; i < bars.length; i++) e = i ? bars[i].close * k + e * (1 - k) : bars[i].close;
  return extra == null ? e : extra * k + e * (1 - k);
}

/** ATR de Wilder sur H1 (somme cumulée puis s − s/len + tr), même formule que l'arène ; valeur à la dernière bougie. */
export function wilderAtr(bars: Bar[], len: number): number {
  let s = 0; let atr = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const tr = i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low;
    s = i < len ? s + tr : s - s / len + tr;
    atr = i < len ? s / (i + 1) : s / len;
  }
  return atr;
}

export interface ZoneStepInput {
  m5: Bar; // la M5 qui vient de CLÔTURER
  h1Closed: Bar[]; // H1 CLOSES, la dernière exclue de rien : ce sont toutes des bougies terminées
  prevDay: { high: number; low: number } | null; // zone de la veille (null = pas encore connue)
  offsetMs: number; // décalage broker
  hasPosition: boolean; // une position de zone est déjà ouverte
}

/**
 * Un pas de la machine sur une M5 close. Renvoie le nouvel état et, éventuellement, une décision d'entrée
 * (`entry` = sens + ATR H1 servant au SL/TP ; le prix d'entrée réel est celui du marché, posé par l'appelant).
 * `skipped` explique un retest écarté (journal), sans être une erreur.
 */
export function zoneStep(st: ZoneState, i: ZoneStepInput, cfg: ZoneConfig): { state: ZoneState; entry?: { dir: 1 | -1; atr: number; level: number }; skipped?: string } {
  const b = i.m5;
  const d = brokerDay(b.time, i.offsetMs);
  let s: ZoneState = { ...st };
  if (d !== s.zoneDay) {
    if (!i.prevDay) return { state: s };
    s = { ...s, zoneDay: d, zh: i.prevDay.high, zl: i.prevDay.low, waiting: false };
  }
  const hr = brokerHour(b.time, i.offsetMs);
  if (hr < cfg.sessionFrom || hr > cfg.sessionTo) return { state: s };
  const body = Math.abs(b.close - b.open);
  const range = b.high - b.low;
  const ok = (range > 0 && body >= cfg.bodyMinFrac * range) || body >= cfg.bodyMinAbs;
  if (!s.waiting) {
    if (b.close > s.zh && b.open <= s.zh && ok) s = { ...s, waiting: true, dir: 1, bkTime: b.time };
    else if (b.close < s.zl && b.open >= s.zl && ok) s = { ...s, waiting: true, dir: -1, bkTime: b.time };
    return { state: s };
  }
  if (b.time - s.bkTime > cfg.retestMaxMs) return { state: { ...s, waiting: false } };
  const level = s.dir === 1 ? s.zh : s.zl;
  const touched = s.dir === 1 ? b.low <= level : b.high >= level;
  if (!touched || i.hasPosition) return { state: s };
  s = { ...s, waiting: false }; // le retest est consommé, accepté ou non
  if (i.h1Closed.length < cfg.minH1Bars) return { state: s, skipped: `H1 history ${i.h1Closed.length} < ${cfg.minH1Bars}` };
  const fast = emaLast(i.h1Closed, cfg.emaFast, b.close);
  const slow = emaLast(i.h1Closed, cfg.emaSlow, b.close);
  const emaOk = s.dir === 1 ? b.close > fast && b.close > slow : b.close < fast && b.close < slow;
  if (!emaOk) return { state: s, skipped: `retest ${s.dir === 1 ? 'long' : 'short'} at ${level} refused by H1 EMA (${cfg.emaFast}: ${fast.toFixed(2)} · ${cfg.emaSlow}: ${slow.toFixed(2)} · close ${b.close})` };
  const atr = wilderAtr(i.h1Closed, cfg.atrLen);
  if (!(atr > 0)) return { state: s, skipped: 'ATR H1 not available' };
  return { state: s, entry: { dir: s.dir, atr, level } };
}

/** Le signal exécutable : au marché (`price`), SL/TP à distance d'ATR, lot fixe. */
export function zoneSignal(symbol: string, e: { dir: 1 | -1; atr: number; level: number }, cfg: ZoneConfig, mode: Mode, price: number, priceStep = 0.01): Signal {
  const dec = Math.max(0, Math.round(-Math.log10(priceStep)));
  const roundP = (x: number) => +(Math.round(x / priceStep) * priceStep).toFixed(dec);
  const direction = e.dir === 1 ? 'long' : 'short';
  const entry = roundP(price);
  const stopLoss = roundP(entry - e.dir * cfg.slAtr * e.atr);
  const tp = roundP(entry + e.dir * cfg.tpAtr * e.atr);
  const confluence: Confluence = {
    direction, rawScore: e.dir, alignment: 1, quality: 1, macro: 1, confidence: 0.55,
    contributions: [{ key: 'zone', weight: 1, score: e.dir, weighted: e.dir }],
  };
  return {
    id: `${symbol}-zone-${Date.now()}-${direction}`,
    symbol,
    time: Date.now(),
    direction,
    mode,
    confidence: 0.55,
    entry,
    stopLoss,
    takeProfits: [tp],
    riskReward: cfg.tpAtr / cfg.slAtr,
    lot: cfg.lot,
    rationale: [
      `ZONE ${direction.toUpperCase()} — yesterday's ${direction === 'long' ? 'high' : 'low'} ${e.level.toFixed(dec)} broken on M5, then retested · H1 close ${direction === 'long' ? 'above' : 'below'} EMA${cfg.emaFast}/EMA${cfg.emaSlow}`,
      `SL ${cfg.slAtr}×ATR(H1,${cfg.atrLen}) = ${(cfg.slAtr * e.atr).toFixed(dec)} · TP ${cfg.tpAtr}×ATR · held by the broker, no trailing`,
    ],
    confluence,
  };
}
