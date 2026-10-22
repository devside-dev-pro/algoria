# EA MT5 — Algoria XAU MABB (or, court terme, 4 à 5 trades par jour)

`Experts/Algoria_XAU_MABB.mq5` est un Expert Advisor MetaTrader 5 autonome pour l'or, en dehors du runner.

**Réglages par défaut (v1.20) :**
- EMA courtes 3/8, filtrées par une EMA 200 de tendance ;
- filtre ADX(14) ≥ 20, avec confirmation +DI/−DI ;
- RR « négatif » de 0,5 : le TP vaut la moitié du stop (stop 3 ATR, TP 1,5 ATR) ;
- **sortie au temps** : un trade qui n'a touché ni son stop ni son TP au bout de 90 minutes est fermé ;
- lot fixe de 0,01 ;
- au plus 5 trades par jour, avec un objectif de 4.

Les signaux Bollinger restent disponibles en paramètre.

Les montants sont en $ **pour 1 lot**, coûts de 0,32 $/oz l'aller-retour déduits (0,20 de spread, 0,05 de
glissement, 0,07 de commission). Au lot par défaut de 0,01, il faut **diviser par 100**.

## Les 6 derniers mois (22/04 → 22/10/2026)

Le réglage est mesuré sur les seules bougies M5 de notre broker des 6 derniers mois (`backtest/mabb-6m.ts`). Cette
fenêtre est coupée en deux moitiés de 3 mois, à minuit heure serveur.

| v1.20 | PF | net (1 lot) | net (0,01 lot) | trades/jour | ≥ 4 trades | pire creux (1 lot) |
|---|---|---|---|---|---|---|
| 22/04 → 22/07 | 1,14 | +16 722 $ | +167 $ | 4,4 | 91 % des jours | −12 085 $ |
| 23/07 → 22/10 | 1,24 | +23 436 $ | +234 $ | 4,2 | 82 % | −11 568 $ |
| **6 mois** | **1,19** | **+40 157 $** | **+402 $** | 4,3 | 86 % | −12 902 $ |

Sur les 6 mois :
- 63 % des trades sont gagnants ;
- mois par mois : avril (à partir du 22) +7 115 $, mai +4 772 $, juin +12 766 $, juillet −2 003 $,
  août +12 918 $, septembre +9 849 $, octobre (jusqu'au 22) −5 260 $ ;
- la règle bat 20 tirages au hasard sur 20 (le même EA, avec un sens de trade tiré à pile ou face) ;
- avec 0,10 $ de spread en plus, elle reste à PF 1,16 (+34 517 $) ;
- 146 des 564 trades viennent du rattrapage, pour +6 669 $.

Sur les mêmes 6 mois, la v1.10 (EMA 50, sans sortie au temps) faisait PF 0,92 puis 1,07, soit 0,99 sur 6 mois
(−3 539 $), avec un pire creux de −28 994 $.

### Comment ce réglage a été trouvé

La règle a été écrite avant de voir les chiffres : on choisit sur une moitié, et un changement n'entre dans l'EA
que s'il fait mieux que la v1.10 **sur l'autre moitié**, celle qui n'a pas servi à le choisir.

- **Re-régler les EMA, l'ADX et le stop ne donne rien de fiable.** Le meilleur des 420 réglages de la grille sur
  une moitié est perdant sur l'autre :
  - choisi sur avril → juillet (EMA 3/8 + EMA 100, ADX ≥ 20 + DI, stop 2 ATR, PF 1,22), il fait PF 0,99 sur
    juillet → octobre, moins que la v1.10 (1,07) ;
  - choisi sur juillet → octobre (EMA 4/9 + EMA 200, ADX ≥ 20 sans DI, PF 1,37), il fait PF 0,96 sur
    avril → juillet. C'est mieux que la v1.10 (0,92), mais toujours perdant.

  Quelques réglages un peu plus bas dans le classement tiennent mieux, comme l'EMA 4/9 + EMA 200 avec DI (PF 1,13
  sur avril → juillet). Mais rien ne permettait de les désigner d'avance.
- **Deux changements font nettement mieux que la v1.10 sur les deux moitiés : une tendance plus lente et la sortie
  au temps.** Avec la tendance EMA 50 de la v1.10, la sortie au temps aide de 1 h à 2 h (à 30 min, elle ne fait que
  rejoindre la v1.10 sur juillet → octobre). Avec une tendance EMA 200 ou 600, toute sortie entre 30 min et 2 h
  fait mieux que la v1.10 sur les deux moitiés (PF avril → juillet / juillet → octobre) :

| sortie au temps | tendance EMA 50 | tendance EMA 200 | tendance EMA 600 |
|---|---|---|---|
| aucune | 0,92 / 1,07 | 0,98 / 1,21 | 1,00 / 1,09 |
| après 30 min | 1,10 / 1,07 | 1,21 / 1,19 | 1,19 / 1,12 |
| après 60 min | 1,07 / 1,16 | 1,15 / 1,18 | 1,12 / 1,17 |
| après 90 min | 1,04 / 1,20 | **1,14 / 1,24** | 1,08 / 1,15 |
| après 120 min | 1,00 / 1,18 | 1,05 / 1,20 | 1,04 / 1,16 |
| après 150 min | 0,96 / 1,16 | 1,00 / 1,20 | 0,99 / 1,16 |
| après 180 min | 0,92 / 1,06 | 0,96 / 1,13 | 0,95 / 1,09 |

- **Les deux choix automatiques vont dans le même sens.** Chaque famille d'amélioration a été adoptée ou non par
  la règle, dans les deux sens :
  - choisi sur juillet → octobre : tendance EMA 200, sortie après 90 min, break-even aux 3/4 du TP et bougie dans le
    sens du trade. Sur avril → juillet, ce réglage fait PF 1,06 contre 0,92 : il passe ;
  - choisi sur avril → juillet : six changements empilés (EMA 600, sortie après 30 min, stop 2 ATR, fenêtre
    9 h-19 h, break-even, rattrapage dès 11 h). Sur juillet → octobre, il fait PF 0,95 contre 1,07 : il échoue.

  Les deux ont pris une tendance plus lente et une sortie au temps. D'autres changements isolés font aussi mieux
  que la v1.10 sur les deux moitiés, mais plus faiblement : le break-even aux 3/4 du TP (0,94 / 1,13) et la fenêtre
  9 h-19 h (1,02 / 1,11, mais 3,3 trades par jour seulement sur juillet → octobre).
- **EMA 200 et 90 minutes sont au cœur de la zone.** Ensemble, ils font mieux que chacun seul sur les deux moitiés
  (EMA 200 seule : 0,98 / 1,21 ; sortie après 90 min seule : 1,04 / 1,20 ; les deux : 1,14 / 1,24). L'EA ne garde
  que ces deux changements, sans le break-even ni le filtre de bougie. Ce choix a été fait **après** avoir vu les 6 mois : ses chiffres sont donc optimistes par
  construction. C'est pourquoi ses voisins comptent plus que lui.

Pourquoi la sortie au temps aide, probablement : avec un stop deux fois plus loin que le TP, un trade qui n'a pas
atteint son TP au bout d'une heure ou deux a souvent perdu son élan. Le laisser filer jusqu'au stop coûte deux TP ;
le couper limite la perte. Avec les deux changements, le pire creux passe de −29 k$ (v1.10) à −13 k$.

### Ses voisins (un seul changement à la fois)

| changement | PF avril → juillet / juillet → octobre | net 6 mois (1 lot) | pire creux | ≥ 4 trades |
|---|---|---|---|---|
| **aucun (v1.20)** | 1,14 / 1,24 | +40 157 $ | −12 902 $ | 86 % |
| spread 0,30 $ (coûts 0,42 $/oz) | 1,12 / 1,21 | +34 517 $ | −13 532 $ | 86 % |
| spread 0,40 $ (coûts 0,52 $/oz) | 1,09 / 1,18 | +28 877 $ | −14 388 $ | 86 % |
| sortie après 60 min | 1,15 / 1,18 | +33 092 $ | −14 268 $ | 89 % |
| sortie après 120 min | 1,05 / 1,20 | +26 837 $ | −12 618 $ | 84 % |
| tendance EMA 100 | 1,13 / 1,16 | +32 121 $ | −15 020 $ | 85 % |
| tendance EMA 600 | 1,08 / 1,15 | +25 407 $ | −16 101 $ | 83 % |
| RR 0,4 | 1,15 / 1,18 | +32 391 $ | −13 573 $ | 87 % |
| RR 0,6 | 1,12 / 1,18 | +35 045 $ | −12 411 $ | 84 % |
| stop 2,5 ATR | 1,11 / 1,04 | +15 944 $ | −13 340 $ | 88 % |
| ADX ≥ 20 sans la confirmation DI | 1,03 / 1,11 | +16 448 $ | −22 222 $ | 96 % |
| sans rattrapage | 1,14 / 1,21 | +29 938 $ | −10 979 $ | 56 % |
| EMA 4/9 | 1,22 / 1,22 | +41 750 $ | −9 732 $ | 77 % |

Lecture :
- **Tous les voisins restent gagnants sur les deux moitiés.** Le résultat ne tient pas à une valeur exacte : c'est
  la grande différence avec la v1.10, qu'un seul changement faisait passer en perte sur 2 ans.
- **Les plus sensibles :** un stop de 2,5 ATR (PF 1,04 sur juillet → octobre) et le retrait de la confirmation DI
  (PF 1,03 sur avril → juillet, creux de −22 k$).
- **Le rattrapage sert surtout à tenir le quota.** Ses 146 trades rapportent +6 669 $. Sans lui, l'EA gagne moins
  (+29 938 $ contre +40 157 $), avec le même PF, et ne fait 4 trades que 56 % des jours, contre 86 %.
- **EMA 4/9 fait un peu mieux, et n'a pas été retenue.** Chercher le meilleur voisin, c'est finir par garder le plus
  chanceux.

### À retenir

- **6 mois, c'est court** : 564 trades. Deux moitiés de 3 mois gagnantes, avec des voisins tous gagnants, c'est
  encourageant, pas une preuve. L'annexe montre qu'un réglage peut gagner une année et perdre la suivante.
- **Le spread compte encore**, mais moins qu'avant : à 0,40 $ de spread moyen, PF 1,09 / 1,18.
- **Rien n'a encore tourné au Strategy Tester sur ticks réels.** C'est la prochaine étape (voir plus bas), avant la
  démo.

## Installer dans MT5 (Raise FX)

1. MT5 → *Fichier* → *Ouvrir le dossier des données* → `MQL5\Experts\`.
2. Y copier `Algoria_XAU_MABB.mq5`.
3. L'ouvrir dans MetaEditor (F4), puis compiler (F7). Il doit y avoir zéro erreur. L'EA n'a pas pu être compilé ici,
   faute de MT5 : c'est la première chose à vérifier.
4. Dans le Navigateur, clic droit → *Actualiser*. L'EA apparaît sous *Expert Advisors*.
5. Le glisser sur un graphique de l'or. Le nom du symbole dépend du compte (`XAUUSD`, `XAUUSD.r`, `GOLD`…).
   L'unité de temps du graphique n'a pas d'importance : l'EA lit `InpTimeframe` (M5).
6. Activer *Trading algorithmique* dans la barre d'outils.

À vérifier une fois sur le compte Raise FX :

- **Heure du serveur.** Les heures de l'EA sont celles du serveur MT5 :
  - entrées de 9 h à 22 h ;
  - rattrapage dès 14 h ;
  - tout fermé à 23 h, et dès 21 h le vendredi.

  Le labo suppose un serveur « clôture de New York » : UTC+3 pendant l'heure d'été américaine, UTC+2 le reste de
  l'année. C'est vérifié sur les bougies journalières de notre broker, qui ouvrent à minuit serveur : 5 225 sur 5 225
  depuis 2008, y compris les semaines où les heures d'été européenne et américaine diffèrent.
  Si le serveur de Raise FX suit une autre horloge, décaler toutes les heures d'autant. Pour le vérifier, la bougie
  journalière de l'or doit s'ouvrir à 00:00 dans MT5.
- **Spread moyen sur l'or.** Avec un TP de 1,5 ATR, chaque dixième de dollar de spread se paie sur chaque trade
  (voir les voisins plus haut). `InpMaxSpread` (0,50 $) ne bloque que les pics : il ne rend pas un spread moyen trop
  large rentable.
- **Compte en couverture (hedging) de préférence.** Sur un compte en compensation (netting), un trade manuel sur
  l'or se mélangerait à la position de l'EA.

## Le tester au Strategy Tester (à faire avant la démo)

*Affichage* → *Testeur de stratégie* :

| champ | valeur |
|---|---|
| Expert | `Algoria_XAU_MABB` |
| Symbole | l'or du compte Raise FX |
| Période | M5 |
| Dates | 2026.04.22 → aujourd'hui (les 6 mois du labo) |
| Modélisation | **Chaque tick basé sur des ticks réels** |
| Dépôt / levier | ceux du compte visé |

Pour comparer aux **agrégats** du labo (le labo ne sort pas de liste de trades), mettre :
- `InpFixedLots = 1` ;
- `InpDailyLossPct = 0` ;
- `InpMaxSpread = 0` ;
- `InpCloseBeforeEnd = 0`.

En fin de test, le Journal affiche une ligne du type
`Quota : … jours de session, minimum de 4 atteint … jours (… %), plafond de 5 atteint … jours (… %)`.

Écarts connus avec le labo :

- **Prix d'entrée.** L'EA entre au premier tick de la bougie suivante, au vrai spread. Le labo entre à la clôture,
  avec un coût fixe de 0,32 $/oz.
- **Ordre du stop et du TP.** Quand les deux sont touchés dans la même bougie M5, le labo compte le stop d'abord (pire
  cas). Les ticks réels tranchent. Avec un TP court, ce point compte.
- **Filtres absents du labo.** Le spread maximum, la coupure de perte journalière et la fermeture avant la fin de
  séance du broker n'existent pas dans le labo.
- **Sortie au temps.** Le labo ferme à la clôture de la bougie ; l'EA ferme au premier tick de la bougie suivante,
  celle qui s'ouvre 90 minutes après la bougie d'entrée. C'est le même instant, au spread près. Ni l'un ni l'autre
  ne rentre sur cette bougie-là.

## Sorties forcées

L'EA ne garde rien ouvert volontairement la nuit ni le week-end. Sa position est fermée :
- à `InpFlatHour` (23 h), et dès `InpFridayFlatHour` (21 h) le vendredi ;
- `InpCloseBeforeEnd` minutes avant la fin de séance déclarée par le broker ;
- au premier tick d'un nouveau jour serveur, si elle date de la veille ;
- au premier tick de la bougie qui s'ouvre `InpMaxHoldMinutes` (90) minutes après la bougie d'entrée, si ni le
  stop ni le TP n'ont été touchés. C'est la sortie au temps : un réglage de stratégie, pas une sécurité.

Les trois premières vérifications tournent aussi sur un minuteur de 30 secondes : elles ne dépendent pas des ticks
de l'or. La sortie au temps, elle, attend la nouvelle bougie, donc un tick, comme dans le labo.

Un cas reste : une clôture anticipée que le broker n'a pas inscrite dans ses horaires (jour férié américain, Black
Friday, 24 et 31 décembre). Une position ouverte juste avant peut alors passer la nuit, ou le week-end, et elle est
fermée dès le premier prix de la séance suivante. Le labo modélise ce cas par une fermeture à l'ouverture de la
première bougie du nouveau jour ; dans MT5, le prix réel des premières secondes de la reprise peut s'en écarter.

## Paramètres

| groupe | paramètre | défaut | rôle |
|---|---|---|---|
| Signal | `InpSignalMode` | EMA cross | Croisement EMA. Les modes Bollinger perdent au labo : à tester, pas à brancher |
| | `InpTimeframe` | M5 | unité de temps des signaux |
| | `InpFastEMA` / `InpSlowEMA` | 3 / 8 | EMA rapide / lente |
| | `InpTrendEMA` | 200 | EMA de tendance ; 0 supprime le filtre |
| | `InpBBPeriod` / `InpBBDeviation` / `InpRSIPeriod` / `InpRSIExtreme` | 20 / 2 / 14 / 30 | modes Bollinger |
| | `InpADXPeriod` | 14 | ADX standard de MT5 (`iADX`), le même que celui du labo |
| | `InpADXMin` | 20 | ADX minimum de la dernière bougie close, pour le signal EMA **et** pour le rattrapage ; 0 = sans seuil |
| | `InpADXUseDI` | oui | exige +DI > −DI pour acheter, −DI > +DI pour vendre. Pour retirer tout le filtre : `InpADXMin` = 0 **et** `InpADXUseDI` = false |
| Quota | `InpMinTradesPerDay` | 4 | objectif : sous ce nombre, le rattrapage s'active |
| | `InpMaxTradesPerDay` | 5 | plafond dur, compté en positions dans l'historique du serveur (survit à un redémarrage) |
| | `InpCatchUpMode` | EMA sans filtre | rattrapage : le même croisement sans EMA de tendance (filtre ADX conservé), ou Bollinger resserrée, ou aucun |
| | `InpCatchUpHour` | 14 | heure serveur à partir de laquelle on rattrape |
| | `InpCatchUpBBDev` / `InpCatchUpRSI` | 1,5 / 40 | rattrapage Bollinger seulement |
| | `InpMinMinutesApart` | 0 | écart minimal entre deux entrées (non testé au labo) |
| Session | `InpSessionStart` / `InpSessionEnd` | 9 / 22 | fenêtre d'entrée, heure serveur |
| | `InpFlatHour` / `InpFridayFlatHour` | 23 / 21 | heure de mise à plat, et celle du vendredi |
| | `InpCloseBeforeEnd` | 10 | ferme et n'entre plus N minutes avant la fin de séance du broker ; 0 = off |
| Sorties | `InpATRPeriod` | 14 | ATR (moyenne simple du true range, comme `iATR`) |
| | `InpStopATR` | 3 | stop = 3 × ATR, posé chez le broker |
| | `InpRewardRisk` | 0,5 | RR : TP = 0,5 × stop |
| | `InpExitOnCross` | non | sortie au croisement inverse. Mesurée seulement sur EMA 9/21 + 200 sans rattrapage, à RR 2 : −28 988 $ |
| | `InpMaxHoldMinutes` | 90 | ferme le trade s'il n'a touché ni stop ni TP au bout de N minutes (à la clôture de bougie) ; 0 = off. Bon de 30 à 120 min sur les 6 derniers mois |
| Risque | `InpFixedLots` | 0,01 | lot fixe par trade ; 0 = calcul au risque |
| | `InpRiskPercent` | 0,5 % | risque par trade, utilisé seulement si le lot fixe vaut 0 |
| | `InpDailyLossPct` | 2 % | plus d'entrée dans la journée au-delà de cette perte (clôturé + latent) |
| | `InpMaxSpread` | 0,50 $ | pas d'entrée au-delà de ce spread ; un pic au premier tick est réessayé pendant une minute |
| | `InpSlippagePoints` | 30 | glissement toléré, en points |
| | `InpMagic` | 26102201 | à changer si deux instances tournent sur le même compte |

## Refaire le labo

Sans machine locale, passer par le workflow `lab` (Actions → lab → *Run workflow*) :
- script `backtest/mabb-6m.ts`, arguments `XAUUSD --months 6`, bougies `XAUUSD:M5` : les 6 derniers mois, ce qui
  a réglé la v1.20 ;
- pour l'annexe : script `backtest/mabb-grid.ts` ou `backtest/mabb-arena.ts`, arguments `XAUUSD`.

En local :

```bash
node scripts/pull-cache.mjs XAUUSD M5
npx tsx backtest/mabb-6m.ts XAUUSD --months 6
npx tsx backtest/mabb-grid.ts XAUUSD
npx tsx backtest/mabb-arena.ts XAUUSD
```

## Annexe : l'étude sur 2 ans (réglage v1.10)

Jusqu'au 22/10/2026, les réglages étaient mesurés sur 2 ans. Mathieu a demandé de ne plus regarder que les 6
derniers mois : l'or a monté presque sans arrêt depuis des années, et c'est le marché d'aujourd'hui qui compte.
L'étude est gardée pour mémoire. Ses chiffres concernent la v1.10 (EMA 50, sans sortie au temps), pas la v1.20.

Tout a été mesuré **avant** d'être réglé, sur deux ans de bougies M5 de notre broker (oct. 2024 → oct. 2026,
532 jours), dans deux labos :
- `backtest/mabb-arena.ts` : les robots publics, contre leur version à direction tirée au hasard ;
- `backtest/mabb-grid.ts` : la grille EMA courtes × ADX × stop, à RR 0,5.

### Le réglage v1.10 : ce que le labo en disait

La grille a essayé 420 combinaisons à RR 0,5 :
- EMA 3/8, 4/9, 5/10, 5/13, 8/13, 8/21 ou 9/21 ;
- tendance EMA 50, 100 ou 200 ;
- ADX coupé, ≥ 20, ≥ 25, ≥ 30, ou ≥ 20 avec DI ;
- stop de 1, 1,5, 2 ou 3 ATR.

Essayer 420 réglages et garder le meilleur, c'est surtout trouver le plus chanceux. La règle de choix a donc été
écrite à l'avance : au moins 3,5 trades par jour, puis le meilleur PF. Elle a été appliquée **sur la 1re année
seulement** (jusqu'au 11/10/2025), puis jugée sur la 2e, que la sélection n'a jamais vue.

| EMA 3/8 + EMA 50 · ADX ≥ 20 + DI · stop 3 ATR · RR 0,5 · rattrapage 14 h | PF | net (1 lot) | trades/jour | ≥ 4 trades |
|---|---|---|---|---|
| 1re année (année de choix) | 0,95 | −13 639 $ | 4,0 | 72 % des jours |
| **2e année (jamais vue)** | **1,05** | **+28 967 $** | 4,0 | 72 % |
| 2 ans | 1,02 | +15 328 $ | 4,0 | 72 % |

Sur les 2 ans :
- 66 % des trades sont gagnants ;
- le pire creux est de −45 182 $ (−452 $ à 0,01 lot) ;
- depuis le 1er juin 2026, le résultat est de −8 223 $ ;
- la règle bat 20 tirages au hasard sur 20.

**Ce qu'il faut retenir :**

- **C'est proche de l'équilibre.** Gagner 1,5 ATR contre un risque de 3 ATR oblige à gagner plus de 2 trades sur 3,
  coûts compris. Avec 66 % de gagnants, il reste très peu après les coûts.
- **Aucun réglage à RR 0,5 n'atteint un PF de 1,2 sur l'année jugée**, et donc pas 1,5 non plus.
  - Sur la 1re année, aucun réglage assez fréquent n'est rentable (le meilleur fait PF 0,95).
  - Sur la 2e, 44 réglages sur 420 passent au-dessus de 1.
- **Le choix fait à l'envers échoue.** Le meilleur réglage de la 2e année (EMA 4/9 + EMA 100, ADX ≥ 20 + DI,
  stop 3 ATR) perd sur la 1re (PF 0,89, −30 784 $).
- **Ce qui se répète d'une année sur l'autre, à RR 0,5 :**
  - le stop large : les 3 meilleurs réglages de la 1re année et les 6 meilleurs de la 2e ont un stop de 3 ATR et
    l'ADX ≥ 20 avec DI. En moyenne sur toute la grille, seul le stop large aide les deux années ; l'ADX avec DI
    n'aide que la 1re (PF moyen 0,81 contre 0,78 sans ADX), pas la 2e (0,92 dans les deux cas) ;
  - un ADX ≥ 25 ou ≥ 30 fait tomber la fréquence sous 3 trades par jour (2,9 et 1,5 en moyenne sur la grille), et le
    minimum de 4 trades devient hors d'atteinte ;
  - un stop serré est ruineux (PF moyen 0,67 / 0,80 à 1 ATR, contre 0,84 / 0,96 à 3 ATR).
- **Le réglage est fragile** (voir ses voisins ci-dessous). Un seul changement suffit à le faire perdre sur 2 ans :
  retirer la confirmation DI, retirer le rattrapage, 0,10 $ de spread en plus, un stop de 2,5 ATR ou des EMA 4/9.
  Seuls un RR de 0,4 à 0,6 et une tendance EMA 200 le laissent positif.
- **Les réglages « à la main », fixés avant de voir la grille**, sont tous négatifs à RR 0,5 sur 2 ans, de −6 k$ à
  −142 k$ par lot. Ils couvrent les EMA 9/21, 5/13 et 3/8 sur EMA 200, avec ou sans ADX ≥ 20, et des stops de 1,5,
  2 ou 3 ATR.

#### Le réglage et ses voisins (2 ans, un seul changement à la fois)

| changement | PF | net (1 lot) | 1re / 2e année | pire creux | ≥ 4 trades | bat le hasard |
|---|---|---|---|---|---|---|
| **aucun (réglage par défaut)** | 1,02 | +15 328 $ | 0,95 / 1,05 | −45 182 $ | 72 % | 20/20 |
| spread 0,30 $ (coûts 0,42 $/oz) | 0,99 | −5 992 $ | 0,92 / 1,03 | −46 602 $ | 72 % | 20/20 |
| spread 0,40 $ (coûts 0,52 $/oz) | 0,97 | −27 312 $ | 0,88 / 1,01 | −51 798 $ | 72 % | 20/20 |
| sans rattrapage | 0,91 | −72 347 $ | 0,89 / 0,92 | −78 278 $ | 49 % | 10/20 |
| ADX ≥ 20 sans la confirmation DI | 0,88 | −132 290 $ | 0,85 / 0,90 | −150 549 $ | 89 % | 2/20 |
| RR 0,4 | 1,02 | +18 971 $ | 0,95 / 1,06 | −39 303 $ | 78 % | 18/20 |
| RR 0,6 | 1,01 | +13 095 $ | 0,97 / 1,03 | −39 500 $ | 67 % | 13/20 |
| stop 2,5 ATR | 0,98 | −17 031 $ | 0,94 / 1,00 | −32 174 $ | 80 % | 18/20 |
| tendance EMA 200 | 1,02 | +15 268 $ | 0,95 / 1,05 | −50 996 $ | 72 % | 18/20 |
| EMA 4/9 | 0,99 | −5 407 $ | 0,87 / 1,06 | −50 903 $ | 66 % | 19/20 |

Lecture :
- **La confirmation +DI/−DI est indispensable.** Sans elle, on perd 132 k$.
- **Le rattrapage aussi.** Sans lui, la règle perd 72 k$ et ne tient 4 trades que 49 % des jours. Or les trades
  de rattrapage sont précisément ceux qui n'ont pas de filtre de tendance.
- **Le spread est décisif.** Le labo compte 0,32 $/oz l'aller-retour : 0,20 de spread, 0,05 de glissement, 0,07 de
  commission. 0,10 $ de plus suffit à passer en perte.
- **Le stop et la paire d'EMA comptent aussi.** Un stop de 2,5 ATR (−17 k$) ou des EMA 4/9 (−5 k$) passent en
  perte.
- **Seul le RR est stable**, entre 0,4 et 0,6 : sur ce paramètre-là, le résultat ne dépend pas d'une valeur
  exacte.

#### Pour comparer : l'ancien réglage, à RR 2

Même labo, même fenêtre, rattrapage dès 14 h, stop 1,5 ATR, TP 2 fois le stop :

| | PF | net (1 lot) | 1re / 2e année | pire creux | ≥ 4 trades | bat le hasard |
|---|---|---|---|---|---|---|
| EMA 9/21 + EMA 200 | 1,05 | +40 512 $ | PF 0,91 / 1,11 | −53 641 $ | 69 % | 20/20 |
| EMA 5/13 + EMA 200 | 1,04 | +36 588 $ | PF 1,01 / 1,05 | −34 159 $ | 88 % | 20/20 |

Parmi les réglages mesurés un par un, l'EMA 5/13 à RR 2 est le seul « EMA courtes » rentable **les deux années**.

Ces réglages restent accessibles par les paramètres. Pour retrouver l'ancien réglage, il faut aussi couper tout le
filtre ADX :
- `InpFastEMA` = 9 (ou 5), `InpSlowEMA` = 21 (ou 13), `InpTrendEMA` = 200 ;
- `InpADXMin` = 0 **et** `InpADXUseDI` = false ;
- `InpStopATR` = 1,5, `InpRewardRisk` = 2.

#### Les robots publics (`mabb-arena.ts`)

| règle | net (1 lot) | PF | bat le hasard |
|---|---|---|---|
| « Moving Average » de MetaQuotes (livré avec MT5) | −123 486 $ | 0,84 | 8/20 |
| BBRSI de geraked, **sans sa grille** | −52 251 $ | 0,72 | 1/20 |
| Bollinger 20/2, retour à la moyenne + RSI 14 | −78 234 $ | 0,89 | 2/20 |
| Bollinger 20/2, cassure + EMA 200 | −100 313 $ | 0,91 | 6/20 |
| EMA 9/21 + EMA 200, TP 2R, rattrapage dès 16 h | +49 063 $ | 1,06 | 20/20 |

BBRSI est publié avec un beau backtest sur XAUUSD M5 2021-2023, mais obtenu avec une **grille ×1,1 sur 20 niveaux**
et sans stop. Sans la grille, il perd.

Pour l'ancien réglage à RR 2 (variante rattrapage 16 h), le spread compte énormément : avec un spread moyen de 0,30 $
on tombe à +29 493 $, et avec 0,40 $ à +9 923 $.

⚠️ Outil personnel et éducatif. Rien ici ne garantit un profit. Toujours valider en démo avant d'engager du
capital réel.
