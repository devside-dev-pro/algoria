import { DEFAULT_CONFIG } from '../../lib/engine/config';
import { logNote, updateTradeStop } from '../../lib/supabase/sync';

// Gestion LIVE post-entrée, par position :
// - défaut (scalp/manuel) : breakeven précoce (beTrigger 0.15) — win rate 86% → 93% au backtest.
// - CUSTOM (stratégie breakout) : breakeven TARDIF + TRAILING — une cassure a besoin d'air, la sécuriser
//   trop tôt tue l'edge validé (labo : BE 0.8R, trailing 1.2R activé à 1.2R).
// Le riskDist custom est FIGÉ à l'entrée (après un BE, |open−SL| ne mesure plus le risque initial).
// newsGuard false : la protection avant annonce NE touche PAS cette position (couche de tendance D1 — remonter
// le stop d'un trade de plusieurs semaines pour un CPI, c'est en sortir à chaque publication). Défaut : true.
interface Mgmt { beTrigger: number; trailActivate?: number; trailDist?: number; riskDist: number; ladder?: [number, number][]; newsGuard?: boolean }
const custom = new Map<string, Mgmt>(); // ticket → gestion spécifique (posée par le runner à l'exécution)
const peaks = new Map<string, number>(); // ticket → meilleur prix atteint (pour le trailing)
const done = new Map<string, true>(); // breakeven déjà appliqué
const newsSecured = new Set<string>(); // `ticket|annonce` déjà sécurisé avant une publication (une note, pas dix)
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

/**
 * @param newsGuard  titre de l'annonce USD fort impact IMMINENTE, sinon null.
 *
 * PROTECTION AVANT PUBLICATION (12/08, demande Mathieu : « serrer les SL et ne pas prendre de position
 * avant/après »). Le lockout du calendrier ne bloquait que les ENTRÉES ; une position déjà ouverte
 * traversait le CPI avec son stop d'origine — un swing or à 1×ATR prenait la bougie en plein.
 *
 * Quand une annonce approche, toute position EN PROFIT passe au breakeven+ immédiatement, sans attendre
 * son beTrigger. Le trade ne peut plus perdre pendant la publication ; s'il continue, paliers et trailing
 * reprennent la main normalement derrière.
 *
 * Une position EN PERTE n'est PAS touchée, volontairement : resserrer un stop juste avant une annonce,
 * c'est se faire sortir par l'agitation qui précède, sur le niveau qu'on venait de rapprocher, et souvent
 * pour rien. On sécurise ce qui est acquis, on ne transforme pas une perte latente en perte certaine.
 */
export async function manageBreakeven(stream: any, terminal: any, symbol: string, newsGuard: string | null = null) {
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
    // ANNONCE IMMINENTE : tout ce qui est en profit passe au breakeven+ sans attendre son beTrigger.
    const guarded = newsGuard != null && profit > 0 && mgmt?.newsGuard !== false;
    if (guarded) wantR = Math.max(wantR, 0.05);
    if (wantR === -Infinity) continue; // rien à sécuriser encore

    const wantSL = r2(p.openPrice + dir * wantR * riskDist);

    // ═══ DISTANCE MINIMALE AU PRIX — LE STOP DOIT AVOIR LE TEMPS DE VOYAGER (24/08/2026) ══════════════
    // Un stop posé à 0,2 point du marché est correct pour NOUS et inutile pour le membre. Nous émettons
    // l'ordre ; lui est à trois sauts de plus — runner → MetaApi → broker maître → STH → son broker. Quand
    // le prix traverse le niveau dans la seconde, le maître sort et le membre reste dedans avec son stop
    // D'ORIGINE. Il encaisse alors un stop plein pendant que l'app lui annonce un breakeven.
    //
    // Vécu le 24/08 sur le compte du membre #134, reconstitué trade par trade :
    //   06:21:16  « stop secured · SL → 4657.29 (+0.05R) »   ← +0,05R au-dessus de l'entrée, 1,33 pt du prix
    //   06:21:16  le maître sort à 4656.70 ...................  +13 $ (soit +0,13 $ à l'échelle du membre)
    //   06:23:42  le membre sort à 4646.44 ..................  −8,63 $  ← son stop d'origine, 10 pts plus bas
    // Ses quatre autres trades du jour ont suivi le maître À LA SECONDE. Celui-ci, non : l'écart entre le
    // déplacement du stop et la fermeture était de ZÉRO seconde. Sur ce seul trade il perd sa journée
    // entière (−9,25 $ au lieu de −0,49 $).
    //
    // POURQUOI ÇA ARRIVE : le breakeven s'arme sur le profit COURANT (`profit >= beTrigger * riskDist`) et
    // verrouille à +0,05R. Quand le profit franchit le seuil de 0,10R EN REDESCENDANT, l'écart entre le
    // stop posé et le prix vaut 0,05R — le minimum structurel de ce réglage. C'est précisément l'instant
    // où le prix va le plus vite. Mesuré sur les 586 déplacements enregistrés : 3 % sont suivis d'une
    // fermeture en moins de 2 secondes, 15 % en moins de 10.
    //
    // CE QU'ON FAIT : on ÉLOIGNE le stop au lieu de renoncer à le poser. Renoncer coûterait au maître un
    // stop plein (−940 $ en moyenne) là où il sortait à +41 $ — le remède serait pire que le mal. On le
    // pose donc au plus près à 0,05R du prix : le membre garde une protection copiable, le maître perd
    // au pire la marge BE+ sur ces cas-là. Le stop ne peut QUE s'éloigner du prix, jamais se resserrer :
    // ce garde-fou ne peut donc pas provoquer de sortie prématurée, seulement en éviter.
    //
    // Le 0,05R n'est pas un nombre inventé : c'est déjà l'écart que ce réglage produit naturellement
    // (verrou à 0,05R, armement à 0,10R) et le seuil anti-spam ci-dessous. Dans le cas normal — le prix a
    // couru loin au-delà du niveau — la borne ne mord pas et rien ne change.
    const minGap = 0.05 * riskDist;
    const gapToPrice = dir * (cur - wantSL); // >0 = stop du bon côté du marché
    const safeSL = gapToPrice >= minGap ? wantSL : r2(cur - dir * minGap);

    // anti-spam : on ne modifie que si le SL avance d'au moins 5% du risque (et jamais à reculons)
    if (long ? safeSL <= sl + 0.05 * riskDist : safeSL >= sl - 0.05 * riskDist) continue;

    const firstSecure = !done.has(id); // 1er passage au-dessus de BE → une note ; ensuite silencieux
    const newsKey = guarded ? `${id}|${newsGuard}` : null; // une seule note par position ET par annonce
    const firstGuard = newsKey != null && !newsSecured.has(newsKey);
    done.set(id, true);
    if (newsKey) newsSecured.add(newsKey);
    try {
      await stream.modifyPosition(id, safeSL, p.takeProfit);
      // L'ÉCART AU PRIX EST TRACÉ, et ce n'est pas cosmétique : c'est la donnée qui manquait le 24/08 pour
      // comprendre pourquoi un membre encaissait un stop plein sur un trade annoncé breakeven. Sans elle on
      // ne pouvait que supposer. Elle dit, pour chaque protection posée, si elle avait une chance d'arriver.
      const gapPosed = r2(dir * (cur - safeSL));
      const clamped = safeSL !== wantSL;
      console.log(`[algoria] stop → pos ${id} SL=${safeSL} (${wantR.toFixed(2)}R · ${gapPosed} du prix${clamped ? ` · ÉLOIGNÉ, voulu ${wantSL}` : ''})${guarded ? ` [news: ${newsGuard}]` : ''}`);
      void updateTradeStop(id, safeSL); // le cockpit fait suivre la zone SL en direct
      if (firstGuard) void logNote(`🛡️ ${newsGuard} is imminent — stop pulled up on the open ${long ? 'long' : 'short'} (SL → ${safeSL}) · this trade can't lose through the release`, 'order');
      else if (firstSecure && wantR >= 0) void logNote(`stop secured · ${long ? 'long' : 'short'} · SL → ${safeSL} (+${wantR.toFixed(2)}R · ${gapPosed} from price${clamped ? ' · widened so the copier can follow' : ''}) · trade can't lose now`, 'order');
    } catch (e) {
      if (firstSecure) done.delete(id); // échec au 1er passage → on réessaiera
      if (newsKey && firstGuard) newsSecured.delete(newsKey); // idem : la protection avant annonce doit repasser
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
  for (const k of newsSecured) if (!stillOpen.has(k.slice(0, k.indexOf('|')))) newsSecured.delete(k);
}
