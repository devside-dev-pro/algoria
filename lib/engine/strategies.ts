// PROFILS DE STRATÉGIE — un runner = un master = UNE stratégie, choisie par l'env ALGORIA_STRATEGY (1|2|3).
// Défaut '2' = le comportement live actuel à l'identique (zéro changement tant que la variable n'est pas posée).
// Le lot copieur est FIXE (0.01 côté client) : le levier de risque du membre, c'est le CHOIX de stratégie.
//
// Étude 2/6→14/7 (M5 gold réel, 8 258 bougies, jours rouges inclus, master $70k lot 1, par JOURNÉE) :
//   S1 (thr .25 · RR 0.4 · sans Asie · +1%/−3%) : 67% de jours verts · série rouge max 3 j · rouge moyen −$990 · net +$7 807
//     ⚠️ CETTE S1 N'EXISTE PLUS (reconstruite le 21/08 — voir son bloc dans STRATEGIES). Le backtest lui
//     promettait +$7 807 ; le RÉEL a rendu −$5 361 sur 162 trades. L'écart s'est logé dans le TP à 0.4R,
//     dont l'espérance mesurée en rejeu est nulle. On garde la ligne comme archive, pas comme description :
//     tout ce qu'elle dit de S1 (RR 0.4, +1%/−3%, « banker vite ») est périmé. Restent vrais : sans Asie,
//     sans swing — « journée bouclée » est bien incompatible avec une position tenue des jours.
//   S2 (live actuel : thr .25 · RR 1.0 · +4%/−4%) : 53% verts · net +$7 045 — la référence.
//   S3 (thr .20 · RR 1.0 · +8%/−6%) : 58% verts · net +$24 496 sur la fenêtre — MAIS seuil bas = sur-trading
//     historiquement fragile hors échantillon → à re-valider sur une fenêtre longue avant tout client réel.
export interface StrategyProfile {
  id: 1 | 2 | 3;
  key: 'steady' | 'balanced' | 'turbo';
  label: string;
  thresholdScalp: number; // seuil de confiance scalp (plus haut = plus sélectif)
  targetRR: number; // TP en multiple du SL
  // R:R MINIMUM accepté après le clamp structure (TP posé sur le premier mur S/R). Étude 2/6→20/7 (robuste
  // sur les DEUX moitiés) : à 0.2, les trades « +197$ pour risquer 800$ » saignent les mois difficiles
  // (juillet −8 814$) ; à 0.75, juillet passe POSITIF (+2 621$) et le net total ×4.5 (+1 999→+9 174$).
  // S1 est passée de 0.2 à 0.75 le 21/08 : elle était la DERNIÈRE sur 0.2, et son live a payé exactement ce
  // que l'étude annonçait. Le motif qui l'en exemptait (« son design EST le petit TP rapide ») est tombé
  // avec le TP court lui-même. S3 : étude à part.
  minRR: number;
  // ARMEMENT DU BREAKEVEN (× riskDist) — LE levier des « gros stops », étude 10/08 sur 853 signaux scalp
  // XAUUSD RÉELS (02/07→10/08) dont le chemin a été rejoué bougie à bougie en M1 (59 314 bougies), en ne
  // changeant QUE la gestion de sortie. Le constat de départ, mesuré en base depuis le 05/07 : 119 trades
  // (18%) partent au stop plein et coûtent −126,8R pendant que 313 break-even (48%) rapportent +19,3R au
  // total — UN stop plein annule 17 break-even. La vanne qui agit dessus est l'armement du BE, et elle est
  // monotone (BE armé → stops pleins → % de trades verts → espérance/trade, les DEUX moitiés positives) :
  //   0.35R → 228 stops · 73.2% verts · +0.043R      0.15R → 150 stops · 82.4% verts · +0.041R  (ex-live)
  //   0.10R → 128 stops · 85.0% verts · +0.050R ✅    0.08R → 120 stops · 85.9% verts · +0.050R
  // 0.10 retenu sur S1/S2 : −15% de stops pleins et la MEILLEURE première moitié de toute la grille
  // (+0.0269 avec le trailing 0.45/0.25). 0.08 réservé à S3 (labo, 1 seul membre live).
  // ⚠️ Le verrou posé par manageBreakeven est à entrée +0.05R (BE+, couvre les coûts) : il DOIT rester
  // strictement sous beTrigger, sinon le stop se retrouve au-dessus du prix au moment où il s'arme —
  // infaisable chez le broker (et un simulateur naïf y encaisse un gain fictif : piège rencontré le 10/08).
  beTrigger?: number;
  // PALIERS DE VERROUILLAGE — [pic atteint, niveau verrouillé] en multiples de R. Réponse au reproche que les
  // membres formulent le mieux : « mes gains font 1,15$ et mes pertes 35$ ». Ce n'est pas une impression, c'est
  // un TROU dans la gestion : entre le BE (verrou +0.05R) et l'activation du trailing, RIEN ne remonte le stop.
  // Un trade qui monte à +0.40R puis se retourne ressort donc à +0.05R, quel que soit le chemin parcouru.
  // Étude 10/08, 853 signaux scalp XAUUSD réels rejoués bougie à bougie en M1, en ne changeant QUE la sortie :
  //   sorties entre 0 et +0.10R (les « miettes »)   465 → 220
  //   espérance / trade                          +0.0505 → +0.0676R   (1ʳᵉ moitié +0.027 → +0.047)
  //   stops pleins                                   130 → 130        ← INCHANGÉ, et c'est le point clé
  // Les paliers n'agissent qu'au-dessus de +0.10R : ils ne peuvent pas transformer un gagnant en perdant.
  // Plateau vérifié sur le voisinage (crans 0.18-0.22 × trail 0.30-0.35) : +0.062 à +0.068R, pas un pic isolé.
  // ⚠️ Espacer les crans d'AU MOINS 0.05R : manage.ts:72 ignore tout stop qui n'avance pas de 5% du risque.
  // Un premier cran verrouillant à 0.10R juste après le BE à 0.05R tomberait pile sur la limite et serait
  // silencieusement sauté (piège rencontré le 10/08 — d'où le premier cran à 0.12).
  ladder?: Array<[number, number]>;
  // TRAILING LOCK scalp (au-delà du BE) : SL suit à peak − trailDist×R dès peak ≥ trailActivate×R.
  // LE correctif de la géométrie « gains minuscules / pertes pleines » : avec TP à 1R, la plupart des trades
  // touchent +0.15R (BE) puis se font sortir à ~0$ — le trailing convertit ces scratchs en +0.2-0.3R verrouillés.
  // Étude 2/6→20/7 (plateau 24/24 combinaisons robustes sur les deux moitiés) :
  //   S2 : net +9 174→+14 957$ · juillet −1 722→+1 885$ · jours verts 61→63% · gain moyen réel ~+305$
  //   S3 (avec minRR 0.75) : net +22 619$ · juin +20 708/juil +1 910 ✅ (sa config minRR 0.2 : juil −8 929 ❌)
  // S1 ÉTAIT non concernée (son TP à 0.4R était atteint avant tout déclenchement) — elle l'est depuis le
  // 21/08 : sous TP 1.0R, le trailing 0.30/0.18 est précisément ce qui devait manquer à ses 73 sorties à +29 $.
  trailActivate?: number;
  trailDist?: number;
  // GATE RÉGIME (décorrélation, étude 22/7) : la stratégie ne scalpe que SON régime de marché.
  //   S3 'trend' : net +26 313→+27 155$, juillet +1 910→+4 569$, trades partagés avec S2 168→135. ✅
  //   S1 'range' TESTÉ ET TUÉ : −10 806$ (les deux moitiés rouges) — les rejets en range seuls n'ont pas
  //   d'edge ; S1 reste non-gatée. ⚠️ Sa faible corrélation (0.31-0.37) tenait aux sessions ET au TP court ;
  //   ce dernier ayant disparu le 21/08, elle va se rapprocher de S2 — seul le filtre de sessions l'en écarte
  //   encore. Contrepartie assumée de la reconstruction, à mesurer une fois qu'elle aura assez de trades.
  //   Constat honnête : S2×S3 restent frères (corr 0.89) tant qu'ils partagent le même générateur de
  //   signaux — la VRAIE décorrélation demandera une famille de signaux différente (labo à venir).
  regimeGate?: 'trend' | 'range';
  // DÉCORRÉLATION PHASE 2 (étude 24/7) — famille de signaux INTRADAY de la stratégie :
  //   'scalp' (défaut) = confluence sur les REJETS de niveaux · 'breakout' = cassures Donchian.
  // Le scalp et le breakout ne peuvent PAS tirer au même instant (un niveau tient→rejet OU casse→breakout) :
  // basculer S3 en 'breakout' N32 fait CHUTER sa corrélation avec S2 de 0.89→0.15 et les trades partagés de
  // ~135→25, en RESTANT robuste (deux moitiés vertes, tout le voisinage N26-44) et fréquent (8.7 trades/j → S3
  // garde son identité TURBO). Quand intraday='breakout', le scalp de confluence s'éteint et le breakout devient
  // le moteur intraday principal (au lieu de couche additive). breakoutN = fenêtre Donchian (défaut 96).
  // PLUS UTILISÉ depuis le 10/08 : aucune stratégie ne pose intraday (le breakout est coupé partout, voir le
  // bloc au-dessus de STRATEGIES). Le champ reste câblé pour pouvoir revenir sans rien recoder.
  intraday?: 'scalp' | 'breakout';
  breakoutN?: number;
  // PLAFOND DES STOPS (× ATR) — étude 22/7 : les stops « monstres » (800-1000$+) effraient les VIP. Serrer la
  // LARGEUR (slAtrMult) tue l'edge (re-confirmé : tout ≤1.0/cap 2.5 casse juillet), mais REFUSER les setups à
  // stop extrême paie : cap 3.2→2.8 sur S2 : net +19 701→+23 336$, verts 66→71%, perte moyenne −13%, pire
  // trade −2 425→−2 036$ (ligne cap 2.8 robuste sur mult 1.05-1.2). S3 : +25 910→+28 681$, verts 64→72%.
  // S1 : le cap 2.8 la dégradait (7 622→6 071$) « parce que son TP court vit des setups à stop large » —
  // motif adossé au TP à 0.4R, supprimé le 21/08. Elle passe donc à 2.8 comme S2/S3. C'est le paramètre le
  // moins bien étayé de sa reconstruction : à re-tester EN PREMIER si ses chiffres déçoivent.
  maxStopAtr?: number;
  tradeAsia: boolean; // trader la session Asie ?
  dailyProfitTargetPct: number; // objectif du jour → latch dayDone
  maxDailyLossPct: number; // plancher du jour → latch dayDone
  // RATCHET JOURNALIER : pic du jour ≥ trigger → la journée se coupe si l'equity retombe au floor (latch 'lock').
  // Le « +1 600$ à 6h qui finit à +36$ » (vécu le 22/7). Étude 2/6→20/7, split-half ✅, aucune cellule de la
  // grille (trig 1.5-3% × floor 0.5-1.5%) ne fait pire que sans : S2 +14 957→+19 701$ (jours verts 63→66%,
  // pire jour −2 554→−1 969$) · S3 +22 619→+26 313$. S1 non concernée (son objectif +1% latch avant).
  dayLockTriggerPct?: number;
  dayLockFloorPct?: number;
  swing: boolean; // couche positions de fond (H1, tenues des jours)
  breakout: boolean; // 2ᵉ stratégie intraday (cassures Donchian) — false PARTOUT depuis le 10/08 (voir le bloc au-dessus de STRATEGIES)
  // FILTRE DE SESSION scalp (étude 29/07, validé Mathieu « go tout ») : AUCUNE nouvelle entrée du scalp
  // de confluence dont l'heure UTC tombe dans [from, to). Les positions déjà ouvertes vivent leur vie
  // (les overnights restent intacts). Preuves : live 20→29/07 = scalp S2/S3 −12,7k$ sur 07-17h (Asie flat,
  // nuit verte) ; walk-forward 7 folds / 35 jours test : « sans 12-17 » +9 198$ vs PROD −405$ ; vert à
  // coûts ×2.5. Ne touche PAS au breakout (son moteur a sa propre étude) ni au swing (H1).
  blockScalpEntryUtcHours?: Array<[number, number]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAKOUT COUPÉ SUR LES TROIS STRATÉGIES (10/08/2026, décision Mathieu)
//
// Le live, mesuré en base :
//   • cumul depuis le 05/07 : 151 trades · −12 551$ · 64% de réussite (le taux de réussite est bon, la
//     géométrie ne l'est pas — les pertes sont plus grosses que les gains) ;
//   • semaine 27/07→02/08 : 49 trades · −3 752$ · 67% ;
//   • semaine 03/08→09/08 : 29 trades · −5 711$ · 45%.
//   Sur ces deux semaines, breakout + swing = −9 906$ pendant que le scalp fait +3 833$.
//
// Le hors-échantillon, mesuré le 10/08 sur 719 signaux XAUUSD RÉELS (juin→août) dont le chemin a été rejoué
// bougie à bougie en M5, en ne changeant QUE la sortie (mêmes entrées, mêmes stops) :
//   RR testés   0.3    0.5    0.75   1.0    1.5    2.0    3.0   (espérance en R par trade)
//   breakout  −0.211 −0.150 −0.090 −0.067 +0.017 +0.060 +0.120
//   scalp     −0.123 −0.075 −0.063 −0.029 −0.005 −0.013 +0.167
//   swing     +0.066 +0.096 +0.062 −0.011 −0.017 +0.180 +0.124
//   Le breakout est la pire des trois couches sur tout le bas de la grille, et il n'y a AUCUN réglage de
//   sortie qui le sauve dans la zone où il tradait réellement. On ne coupe donc pas sur une mauvaise
//   semaine : on coupe sur une couche dont l'espérance est négative quelle que soit la sortie choisie.
//
// Ce que ça change concrètement : `breakout: false` partout → INSTRUMENTS ne construit plus la couche
// (instruments.ts) et le bloc breakout du runner ne tire plus (runner/index.ts). S3 perdait du même coup son
// SEUL moteur intraday : on lui rend le scalp de confluence en retirant intraday/breakoutN (voir S3).
// GOLD_BREAKOUT et breakoutSignal restent en place, inutilisés — remettre `breakout: true` suffit à revenir.
// Les positions breakout déjà ouvertes au moment du déploiement continuent d'être gérées normalement
// (ensureManagement les réadopte par leur ref `-bk-`) : on coupe les ENTRÉES, pas la gestion des sorties.
// ─────────────────────────────────────────────────────────────────────────────
export const STRATEGIES: Record<string, StrategyProfile> = {
  // ═══ S1 RECONSTRUITE LE 21/08/2026 (décision Mathieu) ════════════════════════════════════════════════
  // Elle sort de six semaines à −5 361 $ sur 162 trades, avec 82% de réussite. Ce n'est pas un paradoxe,
  // c'est une géométrie : gain moyen +130 $, perte moyenne −779 $ — 1 pour 6, quand 82% de réussite exige
  // de rester sous 1 pour 4,5. 73 trades (45%) sortaient au breakeven pour +29 $ pendant que 25 stops
  // pleins coûtaient −826 $ pièce : UN stop annulait vingt-huit break-even.
  //
  // CE QUE J'AVAIS ACCUSÉ À TORT — les caps asymétriques +1%/−3%. Rejeu des 162 trades réels en ne
  // changeant QUE le plancher (un trade déjà ouvert finit sa course, les suivants ne sont pas pris) :
  //   −3% (live) −5 509 $ · −2,5% −4 153 $ · −2% −2 024 $ · −1,5% −4 015 $ · −1% −3 968 $
  // Aucun plancher ne la rend rentable, et la courbe n'est pas monotone : sur 24 journées, choisir −2%
  // aurait été du sur-ajustement au bruit. L'asymétrie aggravait, elle ne causait pas.
  //
  // LA VRAIE CAUSE, UN SEUL PARAMÈTRE : `targetRR: 0.4`. L'étude du 10/08 consignée plus haut (853 signaux
  // réels rejoués bougie à bougie en M1, en ne changeant QUE la sortie) est sans équivoque sur cet axe —
  // le taux de réussite est fixé par le BE, PAS par le TP (82.4% de verts que le TP soit à 0.4R ou 2.0R),
  // et seule l'espérance bouge : 0.4R → +0.001R · 1.0R → +0.041R · 1.5R → +0.050R. Un TP à 0.4R a une
  // espérance NULLE avant les coûts. Couper les gagnants tôt ne fabrique aucun trade vert de plus : ça
  // rétrécit les gains pendant que les stops, eux, ne bougent pas. C'était l'identité de S1 ET son défaut.
  //
  // S1 adopte donc la sortie ÉPROUVÉE de S2, et le transfert est légitime : les deux partagent déjà le
  // même générateur de signaux — `thresholdScalp` 0.25 et `beTrigger` 0.10 sont identiques. Seule la
  // sortie différait, et c'est exactement la variable que l'étude faisait varier.
  //   · targetRR 0.4 → 1.0 et minRR 0.2 → 0.75 (S1 était la DERNIÈRE sur 0.2, que l'étude 2/6→20/7
  //     condamnait : « +197$ pour risquer 800$ », juillet −8 814 $ ; à 0.75 juillet passe positif).
  //   · paliers + trailing 0.30/0.18 : la réponse directe aux 73 sorties à +29 $.
  //   · maxStopAtr 2.8 : refuse les setups à stop extrême. ⚠️ SEUL paramètre dont l'évidence S1-spécifique
  //     pointait dans l'autre sens (« cap 2.8 la dégrade, 7 622→6 071 $ ») — mais ce constat était adossé
  //     au TP court qu'on supprime justement : « son TP court vit des setups à stop large ». Sous TP 1.0R,
  //     c'est la mesure S2/S3 qui s'applique (pire trade −2 425 → −2 036 $). À re-vérifier en premier si
  //     les chiffres déçoivent.
  //   · blocage 12-17 UTC : mesuré sur ses PROPRES trades — 46 entrées dans cette fenêtre, −1 960 $.
  //     (Honnêteté : S1 perdait dans toutes les fenêtres, −30 $/trade dehors contre −43 $ dedans. Ce
  //     blocage aide, il ne sauve rien à lui seul.)
  //
  // CE QU'ELLE GARDE, et qui fait vraiment son identité : pas d'Asie, pas de swing — donc rien qui dort
  // la nuit, la journée est réellement bouclée — et des caps SYMÉTRIQUES, la correction de fond.
  // Le niveau 3%/3% n'est PAS optimisé sur les données (24 journées, ce serait du sur-ajustement) : il est
  // choisi pour que le plancher absorbe ~2,5 stops pleins. Plus serré étrangle la stratégie — à ±1,5% un
  // SEUL stop moyen (−826 $) suffisait à fermer la journée, et S1 n'aurait quasiment plus tradé.
  // C'est le RATCHET qui tient désormais la promesse « prendre un petit gain puis s'arrêter » : armé dès
  // +1,5% de pic, il ferme la journée en vert si l'equity retombe à +1,0%, donc bien avant l'objectif à 3%.
  // Un objectif dur bas ne protégeait rien ; un ratchet, si.
  // ⚠️ dayLockTrigger DOIT rester sous dailyProfitTarget, sinon la journée latche à l'objectif avant que le
  // ratchet puisse s'armer et le ratchet devient du code mort.
  //
  // NON VALIDÉE EN RÉEL : cette config n'a jamais tourné. S1 reste donc CACHÉE aux membres (voir
  // lib/member/maintenance.ts) pendant qu'elle trade sur le master — zéro membre attaché, donc test en
  // avant à exposition client nulle. Rouverture aux membres et retour de S2 à $500 seulement sur chiffres.
  '1': { id: 1, key: 'steady', label: 'S1 STEADY — small daily target, tight caps', thresholdScalp: 0.25, targetRR: 1.0, minRR: 0.75, beTrigger: 0.10, ladder: [[0.18, 0.12], [0.28, 0.20], [0.38, 0.30]], trailActivate: 0.30, trailDist: 0.18, maxStopAtr: 2.8, tradeAsia: false, dailyProfitTargetPct: 0.03, maxDailyLossPct: 0.03, dayLockTriggerPct: 0.015, dayLockFloorPct: 0.010, swing: false, breakout: false, blockScalpEntryUtcHours: [[12, 17]] },
  // S2 : BE armé à 0.10 + trailing resserré à 0.45/0.25 — la ligne la plus robuste de la grille du 10/08
  // (+0.0502R, première moitié +0.0269, seconde +0.0779, 128 stops pleins au lieu de 150, 85.0% de verts).
  '2': { id: 2, key: 'balanced', label: 'S2 BALANCED — the reference engine', thresholdScalp: 0.25, targetRR: 1.0, minRR: 0.75, beTrigger: 0.10, ladder: [[0.18, 0.12], [0.28, 0.20], [0.38, 0.30]], trailActivate: 0.30, trailDist: 0.18, maxStopAtr: 2.8, tradeAsia: true, dailyProfitTargetPct: 0.04, maxDailyLossPct: 0.04, dayLockTriggerPct: 0.02, dayLockFloorPct: 0.015, swing: true, breakout: false, blockScalpEntryUtcHours: [[12, 17]] },
  // S3 : étude dédiée faite (20-21/7) — minRR 0.2 saignait juillet (−8 929$ au backtest) ; 0.75 + trailing
  // rendent les deux moitiés positives. Reste TURBO par son seuil bas (0.20 → ~2× plus de trades que S2) et ses caps larges.
  // RETOUR AU MOTEUR SCALP (10/08, décision Mathieu — voir le bloc BREAKOUT COUPÉ ci-dessous). Le passage en
  // intraday='breakout' du 24/07 avait un bon motif (décorrélation S2/S3 : corr 0.89→0.15) mais le moteur retenu
  // perd de l'argent, et un moteur décorrélé qui saigne ne décorrèle rien d'utile. En retirant intraday/breakoutN,
  // le scalp de confluence se rallume et S3 retrouve EXACTEMENT la config étudiée les 20-21/07 (seuil 0.20 ·
  // minRR 0.75 · trailing 0.6/0.35 · cap stop 2.8), dont les deux moitiés d'échantillon étaient positives.
  // Ce n'est donc pas une config neuve : c'est celle d'avant la phase 2. Reste TURBO par sa fréquence (seuil 0.20
  // = ~2× les trades de S2) et ses caps larges (±8/−6). Swing de fond conservé.
  // Contrepartie ASSUMÉE et connue : S2 et S3 repartagent le même générateur de signaux (corr ~0.89). La vraie
  // décorrélation demande une AUTRE famille de signaux — chantier ouvert, pas résolu ici.
  // S3 = LABORATOIRE (décision Mathieu 10/08) : 1 seul membre live, donc c'est elle qui porte le réglage le
  // plus agressif de la grille. BE armé à 0.08 (120 stops pleins, 85.9% de verts — le plus bas/haut mesurés)
  // et TP poussé à 1.5R. Le rejeu est SANS ÉQUIVOQUE sur l'axe TP : à BE/trailing constants, le % de trades
  // verts vaut 82.4% que le TP soit à 0.4R ou à 2.0R (le BE fixe le taux de réussite, PAS le TP) — seule
  // l'espérance bouge, et elle MONTE avec le TP : 0.4R +0.001 (1ʳᵉ moitié négative) · 0.5R +0.013 (1ʳᵉ moitié
  // négative) · 0.75R +0.028 · 1.0R +0.041 · 1.5R +0.050 · 2.0R +0.055. Couper le TP ne fabrique donc aucun
  // trade vert de plus : ça ne fait que rétrécir les gagnants pendant que les stops, eux, ne bougent pas.
  // ⚠️ Le rejeu pose un TP FIXE en R ; en live le clamp structure ramène une partie des TP sur le premier mur
  // (minRR 0.75 filtre le reste). targetRR 1.5 pousse donc dans le bon sens sans reproduire la ligne à
  // l'identique — c'est bien pour ça que S3 est le labo et pas S2.
  '3': { id: 3, key: 'turbo', label: 'S3 TURBO — high-frequency scalp, wide caps', thresholdScalp: 0.2, targetRR: 1.5, minRR: 0.75, beTrigger: 0.08, ladder: [[0.18, 0.12], [0.28, 0.20], [0.38, 0.30]], trailActivate: 0.30, trailDist: 0.18, maxStopAtr: 2.8, tradeAsia: true, dailyProfitTargetPct: 0.08, maxDailyLossPct: 0.06, dayLockTriggerPct: 0.02, dayLockFloorPct: 0.01, swing: true, breakout: false, blockScalpEntryUtcHours: [[12, 17]] },
};

/** Stratégie du runner courant (env ALGORIA_STRATEGY, défaut 2 = comportement actuel). */
export const ACTIVE_STRATEGY: StrategyProfile = STRATEGIES[process.env.ALGORIA_STRATEGY ?? '2'] ?? STRATEGIES['2'];
