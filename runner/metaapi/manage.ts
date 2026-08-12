import { DEFAULT_CONFIG } from '../../lib/engine/config';
import { logNote, updateTradeStop } from '../../lib/supabase/sync';

// Gestion LIVE post-entrée, par position :
// - défaut (scalp/manuel) : breakeven précoce (beTrigger 0.15) — win rate 86% → 93% au backtest.
// - CUSTOM (stratégie breakout) : breakeven TARDIF + TRAILING — une cassure a besoin d'air, la sécuriser
//   trop tôt tue l'edge validé (labo : BE 0.8R, trailing 1.2R activé à 1.2R).
// Le riskDist custom est FIGÉ à l'entrée (après un BE, |open−SL| ne mesure plus le risque initial).
interface Mgmt { beTrigger: number; trailActivate?: number; trailDist?: number; riskDist: number; ladder?: [number, number][] }
const custom = new Map<string, Mgmt>(); // ticket → gestion spécifique (posée par le runner à l'exécution)
const peaks = new Map<string, number>(); // ticket → meilleur prix atteint (pour le trailing)
const done = new Map<string, true>(); // breakeven déjà appliqué
const r2 = (x: number) => Math.round(x * 100) / 100;

/** À appeler juste après l'exécution d'un trade géré différemment du défaut (ex. breakout). */
export function rememberManagement(ticket: string, m: Mgmt) {
  custom.set(ticket, m);
}

/**
 * Cette position a-t-elle sa gestion custom ? (→ restauration après redémarrage, voir runner/index.ts)
 *
 * `custom` vit en MÉMOIRE du process. Le runner redémarre à chaque déploiement, et un swing tient des JOURS :
 * sans restauration, la position survivante retombait sur le défaut scalp — breakeven à 0.15R au lieu de 1R,
 * et surtout NI palier NI trailing (les deux branches sont sautées quand `mgmt` est absent). Le stop se figeait
 * donc au breakeven pour le reste de la vie du trade, en silence. Vu en clair le 03/08 sur le swing or S2 :
 * stop posé à BE deux minutes après l'entrée, plus jamais remonté, alors que le trade est monté à 2.1R.
 */
export const hasManagement = (ticket: string): boolean => custom.has(ticket);

export async function manageBreakeven(stream: any, terminal: any, symbol: string) {
  const positions = (terminal.positions ?? []).filter((p: any) => p.symbol === symbol);
  // NETTOYAGE (04/08) : l'ensemble des positions encore vivantes se construit sur TOUS LES SYMBOLES, pas
  // seulement celui qu'on gère. `custom`, `peaks` et `done` sont des tables de MODULE, partagées par tous
  // les instruments ; les purger avec la liste du seul symbole courant revenait à effacer les entrées de
  // l'autre. Deux instruments tournent en parallèle (l'or et le BTC), chacun avec son tick à la seconde :
  // le tick BTC détruisait donc la gestion de l'or et réciproquement, EN CONTINU. Conséquences observées :
  // les paliers et le trailing ne se déclenchaient jamais (leurs branches sont sautées quand `mgmt` est
  // absent) et `peaks` repartait de zéro, donc le plus-haut atteint était perdu à chaque seconde — un stop
  // ne montait plus jamais au-delà du breakeven. C'est la cause DOMINANTE du swing or du 03/08 monté à
  // 2,1R et rentré à +502$ avec son stop resté au breakeven, bien avant le redémarrage du runner.
  const stillOpen = new Set<string>(((terminal.positions ?? []) as any[]).map((p: any) => String(p.id)));

  for (const p of positions) {
    const id = String(p.id);
    const long = p.type === 'POSITION_TYPE_BUY';
    const dir = long ? 1 : -1;
    const sl = p.stopLoss;
    if (sl == null) continue; // pas de SL → on ne touche pas (ordres nus des modes show)
    const mgmt = custom.get(id);
    const riskDist = mgmt?.riskDist ?? Math.abs(p.openPrice - sl);
    if (!riskDist) continue;
    const cur = p.currentPrice ?? p.openPrice;
    const profit = dir * (cur - p.openPrice);
    // meilleur prix atteint (le trailing + les paliers suivent le PLUS-HAUT, pas le prix courant)
    const prevPeak = peaks.get(id) ?? p.openPrice;
    const peak = long ? Math.max(prevPeak, cur) : Math.min(prevPeak, cur);
    peaks.set(id, peak);
    const peakR = (dir * (peak - p.openPrice)) / riskDist;

    // ── STOP VOULU (en R) = max de : BE, paliers de verrouillage, trailing. Jamais dans le mauvais sens.
    //    Identique à backtest/swing-ladder.ts. Le BE reste sur le PROFIT COURANT (préserve le scalp au défaut).
    const beTrigger = mgmt?.beTrigger ?? DEFAULT_CONFIG.beTrigger ?? 0;
    let wantR = -Infinity;
    if (beTrigger && profit >= beTrigger * riskDist) wantR = Math.max(wantR, 0.05); // BE+ (couvre les coûts)
    if (mgmt?.ladder) for (const [t, l] of mgmt.ladder) if (peakR >= t) wantR = Math.max(wantR, l); // paliers
    if (mgmt?.trailActivate != null && mgmt?.trailDist != null && peakR >= mgmt.trailActivate) wantR = Math.max(wantR, peakR - mgmt.trailDist); // trailing
    if (wantR === -Infinity) continue; // rien à sécuriser encore

    const wantSL = r2(p.openPrice + dir * wantR * riskDist);
    // anti-spam : on ne modifie que si le SL avance d'au moins 5% du risque (et jamais à reculons)
    if (long ? wantSL <= sl + 0.05 * riskDist : wantSL >= sl - 0.05 * riskDist) continue;

    const firstSecure = !done.has(id); // 1er passage au-dessus de BE → une note ; ensuite silencieux
    done.set(id, true);
    try {
      await stream.modifyPosition(id, wantSL, p.takeProfit);
      console.log(`[algoria] stop → pos ${id} SL=${wantSL} (${wantR.toFixed(2)}R)`);
      void updateTradeStop(id, wantSL); // le cockpit fait suivre la zone SL en direct
      if (firstSecure && wantR >= 0) void logNote(`stop secured · ${long ? 'long' : 'short'} · SL → ${wantSL} (+${wantR.toFixed(2)}R) · trade can't lose now`, 'order');
    } catch (e) {
      if (firstSecure) done.delete(id); // échec au 1er passage → on réessaiera
      console.error('[algoria] stop update échec:', (e as { message?: string })?.message ?? e);
    }
  }

  // NETTOYAGE — uniquement si le broker a VRAIMENT répondu (12/08). `stillOpen` se construit sur
  // terminal.positions ; pendant une déconnexion cette liste revient VIDE, et le nettoyage effaçait alors
  // la gestion de TOUTES les positions d'un coup. Les orphelines retombaient sur le défaut scalp (BE 0.15R)
  // et se faisaient verrouiller au breakeven avant que la restauration ne les rattrape — un stop ne
  // redescendant jamais, le trade était figé pour de bon. Cinq déconnexions relevées le 10/08.
  // Une liste vide est infiniment plus souvent une déconnexion qu'une clôture simultanée de tout le book :
  // dans le doute on garde la gestion. Le coût est nul — les tickets ne se réutilisent pas, et le prochain
  // cycle où le broker répond nettoie ce qui doit l'être.
  if (stillOpen.size === 0) return;
  for (const id of done.keys()) if (!stillOpen.has(id)) done.delete(id);
  for (const id of peaks.keys()) if (!stillOpen.has(id)) peaks.delete(id);
  for (const id of custom.keys()) if (!stillOpen.has(id)) custom.delete(id);
}
