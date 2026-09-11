// STRATÉGIES RETIRÉES DE LA CIRCULATION — source de vérité UNIQUE, partagée par l'app membre, l'API et le runner.
// Client-safe : aucune dépendance serveur, aucun secret.
//
// ⚠️ DEUX NOTIONS DISTINCTES, ET LES CONFONDRE COÛTE CHER (leçon du 20-21/08, voir plus bas) :
//
//   1. CACHÉE AUX MEMBRES (`inMaintenance`) — elle disparaît du sélecteur, ses trades passés disparaissent
//      du flux, et elle ne compte plus dans le minimum d'entrée annoncé. C'est une décision COMMERCIALE.
//   2. TRADING ARRÊTÉ (`tradingHalted`) — le runner n'ouvre plus AUCUNE position. C'est une décision
//      TECHNIQUE, et beaucoup plus violente : une stratégie à l'arrêt ne produit plus aucune donnée, donc
//      elle ne peut plus RIEN prouver. On ne peut pas corriger un défaut et vérifier la correction si le
//      moteur est éteint.
//
// Les positions déjà ouvertes restent gérées jusqu'à leur sortie normale dans les deux cas : on ne liquide
// jamais rien dans le dos des membres. Et les trades masqués ne sont PAS supprimés — c'est un filtrage
// d'affichage, réversible en retirant l'id de la liste. Décision Mathieu du 20/08 : « masquer, pas supprimer ».
//
// ── S1 STEADY : cachée aux membres, mais REMISE EN MARCHE le 21/08/2026 ─────────────────────────────────
// Le 20/08 elle a été mise en maintenance pleine (cachée ET arrêtée) parce qu'elle perdait. Diagnostic
// refait le 21/08 sur ses 162 trades live, et il corrige le précédent :
//
//   · Ce que j'avais désigné comme LE défaut — les caps journaliers asymétriques (+1%/−3%) — n'en était
//     pas la cause principale. Rejeu des 162 trades en ne changeant QUE le plancher : −5 509 $ (actuel)
//     → −2 024 $ au mieux (−2%), et la courbe n'est même pas monotone (−1,5% et −1% font PIRE que −2%).
//     Sur 24 journées c'est du bruit. Aucun plancher ne rend S1 rentable.
//   · Le vrai défaut est la GÉOMÉTRIE PAR TRADE. 82% de réussite, et elle perd quand même : gain moyen
//     +130 $ contre perte moyenne −779 $, soit 1 pour 6. À 82% il faut rester sous 1 pour 4,5.
//     45% des trades (73 sur 162) sortaient au breakeven pour +29 $ — un seul stop plein (−826 $) en
//     annulait vingt-huit.
//   · La cause tient en un paramètre : `targetRR: 0.4`. L'étude consignée dans strategies.ts (853 signaux
//     réels rejoués bougie à bougie en M1) est sans équivoque — le taux de réussite est fixé par le BE,
//     PAS par le TP, et l'espérance monte avec le TP : 0.4R → +0.001R, 1.0R → +0.041R. Un TP à 0.4R a une
//     espérance nulle avant les coûts. C'était l'identité de S1, et c'était le défaut.
//
// S1 tourne donc désormais avec la sortie éprouvée de S2 (voir strategies.ts) et garde ce qui la
// distingue vraiment : pas d'Asie, pas de swing, journée bouclée, caps symétriques.
//
// POURQUOI ELLE RESTE CACHÉE MALGRÉ TOUT : la nouvelle config n'a jamais tourné en réel. Zéro membre
// n'est attaché à S1 (les 33 sont passés sur S2 le 20/08), donc la laisser trader sur le master est un
// test en avant à exposition client NULLE. On la rouvrira aux membres — et on remontera le minimum de S2
// de $200 à $500, voir minimums.ts — quand ses chiffres le justifieront, pas avant.
//
// ── S3 TURBO AJOUTÉE LE 11/09/2026 : il n'y a plus qu'une stratégie ──────────────────────────────────
// Les membres ne suivent plus nos moteurs, ils suivent un compte externe (Algoria 2.0) via le copieur, et
// S1 comme S3 ont été supprimées de MetaApi. Leurs runners sont en CRASHED, leurs masters n'existent plus.
//
// S3 était pourtant TOUJOURS dans le sélecteur : un membre déclarant $1000 pouvait la choisir à l'étape 3,
// passer en `pending_copier`, et voir son branchement échouer sur « no master configured for S3 » — un
// message que personne ne lui montre. Il restait dans la file, sans stratégie qui tourne, sans explication.
// Avec 1 150 comptes en onboarding, ce n'était pas une hypothèse.
//
// On la CACHE plutôt que de la supprimer, exactement comme S1 : c'est réversible, ça sort du sélecteur, du
// flux et du minimum annoncé, et ça ne touche pas aux lignes déjà écrites (décision Mathieu du 20/08 :
// « masquer, pas supprimer »). Le retrait complet de la notion de stratégie est un chantier à part.
//
// Le « from $200 » de la pub est préservé : S2 porte déjà le palier $200 (voir minimums.ts), donc le
// minimum d'entrée annoncé ne bouge pas d'un dollar.
export const STRATEGIES_IN_MAINTENANCE: number[] = [1, 3];

// Stratégies dont le runner n'ouvre plus aucune position. VIDE depuis le 21/08 : S1 doit trader pour
// pouvoir prouver sa correction. Remettre un id ici est l'arrêt d'urgence — à réserver aux cas où une
// stratégie fait activement du mal, pas à ceux où elle est simplement en cours de correction.
export const STRATEGIES_TRADING_HALTED: number[] = [];

/** true si cette stratégie est cachée aux membres (sélecteur, flux de trades, minimum annoncé). */
export const inMaintenance = (id: number | null | undefined): boolean =>
  id != null && STRATEGIES_IN_MAINTENANCE.includes(Number(id));

/** true si le runner doit refuser d'ouvrir de nouvelles positions sur cette stratégie.
 *  Volontairement SÉPARÉ de `inMaintenance` : cacher un produit et éteindre son moteur sont deux
 *  décisions différentes, et une stratégie éteinte ne peut plus démontrer qu'elle est réparée. */
export const tradingHalted = (id: number | null | undefined): boolean =>
  id != null && STRATEGIES_TRADING_HALTED.includes(Number(id));
