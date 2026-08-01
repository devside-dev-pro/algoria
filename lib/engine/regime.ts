// DÉTECTEUR DE RÉGIME — « le trend following nous tue quand le marché range » (Mathieu, 01/08).
//
// Le problème est réel et connu : une stratégie de suivi de tendance perd mécaniquement en marché
// latéral, parce que chaque faux départ paie le spread et le stop. Les couches breakout (Donchian) et
// confluence d'Algoria sont exactement dans ce cas. Un filtre de régime ne prédit rien : il refuse
// simplement d'ouvrir quand le marché n'a pas la propriété dont la stratégie a besoin.
//
// DEUX MESURES, volontairement redondantes et de familles différentes :
//  · ADX de Wilder — force de tendance issue des mouvements directionnels. Convention de place :
//    < 20 = latéral, > 25 = tendance établie. Réagit lentement, tient bien la durée.
//  · EFFICIENCY RATIO de Kaufman — |déplacement net| / |chemin parcouru| sur n bougies. 1 = ligne
//    droite, 0 = agitation qui revient à son point de départ. Réagit vite, sans paramètre de lissage.
//    C'est la mesure la plus honnête du « ça range » : elle compare ce que le prix a FAIT à ce qu'il a
//    PARCOURU pour le faire.
//
// Les deux sont CAUSALES : la valeur en i n'utilise que les bougies ≤ i. C'est la condition pour que le
// filtre soit backtestable sans mentir — et pour qu'une seule implémentation serve le sim ET le live.
import type { Bar } from './types';
import { adx } from './indicators';

export interface RegimeFilter {
  /** ADX minimum pour autoriser une entrée (0/undefined = pas de contrainte ADX) */
  adxMin?: number;
  /** Efficiency Ratio minimum (0..1) pour autoriser une entrée */
  erMin?: number;
  /** fenêtre de l'Efficiency Ratio, en bougies (défaut 20) */
  erLookback?: number;
  /** période ADX (défaut 14) */
  adxPeriod?: number;
}

/**
 * Efficiency Ratio de Kaufman, causal.
 * ER[i] = |close[i] − close[i−n]| / Σ|close[k] − close[k−1]| sur les n dernières bougies.
 * Retourne 0 tant que l'historique est insuffisant : pas de valeur inventée, donc pas d'entrée
 * autorisée par défaut sur une fenêtre trop courte (le filtre est conservateur, jamais permissif).
 */
export function efficiencyRatio(bars: Bar[], n = 20): number[] {
  const len = bars.length;
  const out = new Array<number>(len).fill(0);
  if (len < n + 1) return out;
  // somme glissante du chemin parcouru (|variation| bougie à bougie)
  let path = 0;
  for (let i = 1; i <= n; i++) path += Math.abs(bars[i].close - bars[i - 1].close);
  for (let i = n; i < len; i++) {
    if (i > n) path += Math.abs(bars[i].close - bars[i - 1].close) - Math.abs(bars[i - n].close - bars[i - n - 1].close);
    const move = Math.abs(bars[i].close - bars[i - n].close);
    out[i] = path > 0 ? move / path : 0;
  }
  return out;
}

/** Lecture de régime sur une bougie — utile pour la télémétrie et l'affichage. */
export interface RegimeReading {
  adx: number;
  er: number;
  /** 'trend' = les deux mesures sont d'accord · 'range' = les deux disent non · 'mixed' = désaccord */
  label: 'trend' | 'range' | 'mixed';
}

/**
 * Masque d'autorisation d'entrée, une valeur par bougie : true = le régime convient.
 * Un seuil non renseigné n'impose rien — `{}` laisse donc tout passer (= comportement actuel).
 */
export function regimeMask(bars: Bar[], f: RegimeFilter): boolean[] {
  const needAdx = (f.adxMin ?? 0) > 0;
  const needEr = (f.erMin ?? 0) > 0;
  if (!needAdx && !needEr) return new Array<boolean>(bars.length).fill(true);
  const a = needAdx ? adx(bars, f.adxPeriod ?? 14) : null;
  const e = needEr ? efficiencyRatio(bars, f.erLookback ?? 20) : null;
  return bars.map((_, i) => (a ? a[i] >= (f.adxMin ?? 0) : true) && (e ? e[i] >= (f.erMin ?? 0) : true));
}

/**
 * Le régime autorise-t-il une entrée sur la DERNIÈRE bougie ? C'est la forme utilisée par le LIVE.
 * Volontairement écrit avec les mêmes fonctions et les mêmes comparaisons que regimeMask : une seule
 * définition du « oui », donc aucune dérive possible entre ce que le simulateur juge et ce que le runner
 * exécute. Un seuil absent n'impose rien.
 */
export function passesRegime(bars: Bar[], f: RegimeFilter): boolean {
  const needAdx = (f.adxMin ?? 0) > 0;
  const needEr = (f.erMin ?? 0) > 0;
  if (!needAdx && !needEr) return true;
  const i = bars.length - 1;
  if (i < 0) return false;
  if (needAdx && adx(bars, f.adxPeriod ?? 14)[i] < (f.adxMin ?? 0)) return false;
  if (needEr && efficiencyRatio(bars, f.erLookback ?? 20)[i] < (f.erMin ?? 0)) return false;
  return true;
}

/**
 * Lecture du régime sur la DERNIÈRE bougie d'une fenêtre — c'est la forme qu'utilisera le live.
 * Volontairement bâtie sur les mêmes fonctions que le masque : le live et le sim ne peuvent pas
 * diverger, puisqu'ils exécutent le même code sur les mêmes bougies.
 */
export function regimeAt(bars: Bar[], f: RegimeFilter = {}): RegimeReading {
  const i = bars.length - 1;
  if (i < 0) return { adx: 0, er: 0, label: 'range' };
  const a = adx(bars, f.adxPeriod ?? 14)[i] ?? 0;
  const e = efficiencyRatio(bars, f.erLookback ?? 20)[i] ?? 0;
  const trendy = a >= (f.adxMin ?? 20);
  const efficient = e >= (f.erMin ?? 0.25);
  return { adx: a, er: e, label: trendy && efficient ? 'trend' : !trendy && !efficient ? 'range' : 'mixed' };
}
