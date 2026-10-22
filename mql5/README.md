# EA MT5 — Algoria XAU MABB (or, court terme, 4 à 5 trades par jour)

`Experts/Algoria_XAU_MABB.mq5` : un Expert Advisor MetaTrader 5 autonome pour l'or, en dehors du runner. Il trade
des croisements de moyennes mobiles (EMA 9/21 filtrées par l'EMA 200), et en option des signaux Bollinger, avec
un plafond de 5 trades par jour et un objectif de 4.

Les règles viennent de robots publics. Elles ont été rejouées **avant** d'écrire l'EA, sur deux ans de bougies
M5 de notre broker, dans `backtest/mabb-arena.ts`.

## Ce que le labo a dit (1 lot, coûts 0,32 $/oz, oct. 2024 → oct. 2026, 532 jours)

| règle | net | PF | pire creux | bat le hasard | ≥ 4 trades/jour |
|---|---|---|---|---|---|
| **EMA 9/21 + EMA 200, rattrapage dès 14 h** (réglages par défaut) | **+42 423 $** | 1,05 | −43 658 $ | 10/10 | 69 % des jours |
| idem, rattrapage dès 16 h | +43 551 $ | 1,05 | −48 426 $ | 19/20 | 60 % |
| EMA 9/21 + EMA 200 seule (pas de rattrapage) | +6 066 $ | 1,01 | −51 366 $ | 18/20 | 41 % |
| Bollinger 20/2 retour à la moyenne + RSI 14 | −70 712 $ | 0,90 | −94 731 $ | 5/20 | 29 % |
| Bollinger 20/2 cassure + EMA 200 | −136 204 $ | 0,87 | −162 832 $ | 2/20 | 85 % |
| BBRSI de geraked, **sans sa grille** | −33 797 $ | 0,80 | −49 837 $ | 2/20 | 0 % |
| « Moving Average » de MetaQuotes (livré avec MT5) | −121 002 $ | 0,84 | −124 244 $ | 7/20 | 98 % |

« Bat le hasard » : les mêmes entrées et sorties, avec une direction tirée au sort (20 tirages, ou 10 pour la
sensibilité). Un membre à 0,01 lot divise les montants par 100.

**Ce qu'il faut retenir avant de brancher quoi que ce soit :**

- Seule la règle EMA bat sa version au hasard. Son avantage est **mince** : PF 1,05, environ 20 $ de gain
  net par trade pour 1 lot, après 32 $ de coûts.
- **La première année perd** (−18 k$ sur la première moitié). Le gain vient de juin à octobre 2026 : la
  variante 16 h y fait +65 k$, pour +44 k$ au total, avec 12 mois verts sur 25.
- Elle est **fragile**. Un seul réglage changé à partir de la variante 16 h :
  - TP 1,5R au lieu de 2R : −4,6 k$ ;
  - stop 1 ATR au lieu de 1,5 : −31 k$ ;
  - spread moyen de 0,40 $ au lieu de 0,20 : +4 k$, soit plus rien ;
  - spread de 0,30 $ : +24 k$.
- Les trades de rattrapage, ceux qui servent à atteindre 4 par jour, n'ont **pas** dégradé la règle :
  variante 16 h, 384 trades, +26 k$, PF 1,14.
- Le minimum de 4 n'est pas garanti. Avec le rattrapage dès 14 h, 31 % des jours restent sous 4 faute de
  signal : l'EA n'ouvre jamais un trade sans signal.
- Les robots « prouvés » trouvés en ligne ne prouvent rien. BBRSI de geraked est publié avec un backtest
  XAUUSD M5 2021-2023 obtenu avec une **grille ×1,1 sur 20 niveaux** et le stop ignoré. Sans la grille, il perd.

## Installer dans MT5 (Raise FX)

1. MT5 → *Fichier* → *Ouvrir le dossier des données* → `MQL5\Experts\`.
2. Y copier `Algoria_XAU_MABB.mq5`.
3. L'ouvrir dans MetaEditor (F4), compiler (F7) : zéro erreur attendue.
4. Dans le Navigateur, clic droit → *Actualiser*. L'EA apparaît sous *Expert Advisors*.
5. Le glisser sur un graphique de l'or. Le nom du symbole dépend du compte Raise FX : `XAUUSD`, `XAUUSD.r`,
   `GOLD`… L'unité de temps du graphique n'a pas d'importance, l'EA lit `InpTimeframe` (M5).
6. Activer *Trading algorithmique* dans la barre d'outils.

À vérifier une fois sur le compte Raise FX :

- **Heure du serveur.** La session (9 h-22 h, tout à plat à 23 h, vendredi 21 h) est en heure du serveur MT5,
  celle qu'affiche l'Observateur de marché. Le labo suppose un serveur à UTC+3 en été, comme la plupart des
  brokers. Si Raise FX est décalé, décaler les heures d'autant.
- **Spread moyen sur l'or.** C'est lui qui décide si l'avantage survit (voir plus haut). `InpMaxSpread`
  (0,50 $) ne bloque que les pics ; il ne rend pas un spread moyen de 0,40 $ rentable.
- **Compte en couverture (hedging) de préférence.** Sur un compte en compensation (netting), un trade manuel
  sur l'or se mélangerait à la position de l'EA.

## Le tester au Strategy Tester (à faire avant la démo)

*Affichage* → *Testeur de stratégie* :

| champ | valeur |
|---|---|
| Expert | `Algoria_XAU_MABB` |
| Symbole | l'or du compte Raise FX |
| Période | M5 |
| Dates | 2024.10.01 → aujourd'hui (la même fenêtre que le labo) |
| Modélisation | **Chaque tick basé sur des ticks réels** |
| Dépôt / levier | ceux du compte visé |

Pour comparer au labo trade pour trade, mettre `InpFixedLots = 1` et `InpDailyLossPct = 0` : le labo trade
1 lot fixe, sans coupure journalière. En fin de test, le Journal affiche une ligne du type
`Quota : 532 jours de session, minimum de 4 atteint … jours (… %), plafond de 5 atteint … jours (… %)`.

Écarts connus avec le labo :

- l'EA entre au premier tick de la bougie suivante, au vrai spread du moment ; le labo entre à la clôture, avec
  un coût fixe ;
- la coupure de perte journalière (2 %) n'existe pas dans le labo.

## Paramètres

| groupe | paramètre | défaut | rôle |
|---|---|---|---|
| Signal | `InpSignalMode` | EMA cross | EMA 9/21 + EMA 200. Les modes Bollinger perdent au labo : à tester, pas à brancher |
| | `InpTimeframe` | M5 | unité de temps des signaux |
| | `InpFastEMA` / `InpSlowEMA` / `InpTrendEMA` | 9 / 21 / 200 | `InpTrendEMA = 0` supprime le filtre |
| | `InpBBPeriod` / `InpBBDeviation` / `InpRSIPeriod` / `InpRSIExtreme` | 20 / 2 / 14 / 30 | modes Bollinger |
| Quota | `InpMinTradesPerDay` | 4 | objectif : sous ce nombre, le rattrapage s'active |
| | `InpMaxTradesPerDay` | 5 | plafond dur, compté dans l'historique du serveur (survit à un redémarrage) |
| | `InpCatchUpMode` | EMA sans filtre | règle de rattrapage : EMA 9/21 sans EMA 200, ou Bollinger resserrée, ou aucune |
| | `InpCatchUpHour` | 14 | heure serveur à partir de laquelle on rattrape |
| | `InpMinMinutesApart` | 0 | écart minimal entre deux entrées (non testé au labo) |
| Session | `InpSessionStart` / `InpSessionEnd` | 9 / 22 | fenêtre d'entrée, heure serveur |
| | `InpFlatHour` / `InpFridayFlatHour` | 23 / 21 | tout est fermé ; rien ne reste ouvert la nuit ni le week-end |
| Sorties | `InpStopATR` / `InpRewardRisk` | 1,5 / 2 | stop = 1,5 × ATR(14) M5, TP = 2 × stop, posés chez le broker |
| | `InpExitOnCross` | non | sortie au croisement inverse : −33 k$ au labo |
| Risque | `InpRiskPercent` | 0,5 % | risque par trade sur l'équité. Le lot est arrondi vers le bas ; sous le lot minimum, pas d'entrée |
| | `InpFixedLots` | 0 | lot fixe, prioritaire s'il est > 0 |
| | `InpDailyLossPct` | 2 % | plus d'entrée dans la journée au-delà de cette perte (clôturé + latent) |
| | `InpMaxSpread` | 0,50 $ | pas d'entrée au-delà de ce spread instantané |
| | `InpMagic` | 26102201 | à changer si deux instances tournent sur le même compte |

## Refaire le labo

Sans machine locale, via le workflow `lab` (Actions → lab → *Run workflow*) :
script `backtest/mabb-arena.ts`, arguments `XAUUSD`, bougies `XAUUSD:M5`.

En local :

```bash
node scripts/pull-cache.mjs XAUUSD M5
npx tsx backtest/mabb-arena.ts XAUUSD
```

⚠️ Outil personnel et éducatif. Rien ici ne garantit un profit. Toujours valider en démo avant d'engager du
capital réel.
