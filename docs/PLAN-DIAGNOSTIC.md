# Plan de diagnostic — pourquoi Algoria perd, et comment le savoir (02/09/2026)

Règle du plan : **on ne change rien en prod sans un test qui colle au live**. Chaque étape produit un chiffre
qui décide de la suivante. Mathieu lance les commandes sur sa machine WSL (`~/algoria`), Claude écrit les outils
et lit les résultats. Une seule modification de prod à la fois, mesurée deux semaines.

## 0. Les faits (table `trades`, 01/07 → 02/09)

| Couche | Trades | P&L | Win | Gain moy | Perte moy | R/trade | BE | Stops pleins |
|---|---|---|---|---|---|---|---|---|
| Or scalp | 751 | −17 126 $ | 74 % | +147 $ | −536 $ | −0,04 | 41 % | 18 % |
| Or breakout (coupé le 10/08) | 203 | −13 985 $ | 64 % | +148 $ | −468 $ | −0,08 | 53 % | 22 % |
| Or swing | 192 | −18 591 $ | 75 % | +288 $ | −1 335 $ | −0,09 | 54 % | 16 % |
| BTC swing | 96 | +5 182 $ | 76 % | +262 $ | −634 $ | −0,02 | 50 % | 18 % |

Ce qu'il faut voir : **les quatre couches ont la même signature**. Trois trades sur quatre gagnent, la moitié
finit au breakeven pour quelques dollars, et la perte moyenne vaut 3 à 5 gains. À ce ratio il faut plus de
82 % de gagnants pour être à l'équilibre. On est à 75 %.

BTC n'est pas une exception : sa semaine du 17/08 a fait +10 104 $ ; sans elle, BTC swing fait −4 922 $. Son
R par trade est nul. **Rien ne marche de façon démontrée.** Les deux dernières semaines : or −30 000 $
(swing −18 339 $, scalp −11 667 $), dont −16 860 $ sur le seul swing or la semaine du 24/08.

## 1. La question qui tranche tout : entrées ou sorties ?

Deux diagnostics possibles, aux remèdes opposés :

- **Les entrées n'ont pas d'avantage** : après le signal, le prix ne va nulle part de préférence. Aucune gestion
  ne sauvera la couche. Il faut changer ou couper les entrées.
- **Les entrées ont un avantage, la gestion le détruit** : BE armé trop tôt, paliers trop serrés, stops pleins
  sur les perdants. On garde les entrées et on change les sorties.

Le simulateur de signaux ne peut pas répondre (parité scalp S2 : corrélation 0,17 ; BTC : pas de simulateur).
`backtest/replay.ts` **contourne le simulateur** : il prend les vraies entrées live (heure, prix, stop,
direction) et rejoue chaque position sur les bougies M1 réelles sous plusieurs règles de sortie. Seule la
sortie est simulée, et la gestion M1 a passé la parité (swing : BE live 29 % · sim 20 % ✅).

Il mesure, par symbole × couche :

1. **Edge des entrées** : part des trades qui touchent +1R avant −1R (hasard : 50 %) et +2R avant −1R
   (hasard : 33 %). Sous le hasard après coûts, les entrées n'ont rien.
2. **Variantes de sortie** sur les mêmes entrées, mois par mois : prod, BE 0,15 / 1 R, brut SL/TP sans
   gestion, trail seul. Une variante ne compte que si elle gagne **chaque** mois.

Contrôle de sincérité : la ligne « PROD rejouée » doit ressembler à la ligne « LIVE ». Sinon le rejeu ment
et on s'arrête là.

### Commandes (WSL, `~/algoria`, après `git pull`)

```bash
node scripts/pull-cache.mjs XAUUSD M1        # ~83 000 bougies, juin → aujourd'hui
node scripts/pull-cache.mjs BTCUSD M1
npx tsx scripts/pull-live-trades.ts          # trades live → backtest/fixtures/live-trades.json
npx tsx backtest/replay.ts XAUUSD
npx tsx backtest/replay.ts BTCUSD
```

## 2. Arbre de décision après le rejeu

| Résultat | Conséquence |
|---|---|
| Entrées sous le hasard (or scalp) | On coupe le scalp or. Les 751 trades ne servent à rien, on repart des entrées. |
| Entrées sous le hasard (or swing) | On coupe le swing or. `BE 0,15 R` (A) est abandonné. |
| Entrées au-dessus du hasard, une sortie gagne 3 mois sur 3 | On la met en prod, une ligne, deux semaines de mesure, parité vérifiée. |
| PROD rejouée ≠ LIVE | Le rejeu est faux, on cherche pourquoi avant toute conclusion. |

## 3. Ensuite, par ordre

1. **Étendre le M1 en arrière** (`npx tsx scripts/backfill-gaps.ts XAUUSD M1`) pour que le walk-forward swing
   ait 4 folds gérés en M1, pas un seul.
2. **Rendre le simulateur scalp crédible** ou l'abandonner : comparer trade par trade le sim et le live sur
   un même jour (heures d'entrée, direction, prix). S'il ne trouve pas les mêmes trades, ses réglages
   (`targetRR`, `beTrigger`, paliers) ont été choisis sur un faux.
3. **Filtre horaire or scalp**, seulement si les entrées ont un edge : le live perd −23 500 $ entre 05 h et
   11 h UTC et gagne le reste du temps. À tester en walk-forward, pas à l'œil.
4. **Simulateur breakout BTC** (`BTC_SWING` est un breakout Donchian, le sim actuel est un trend) avant toute
   décision BTC.

## 4. Ce qui reste interdit

- Mettre `BE 0,15 R` en prod sur la foi des folds H1 : le seul fold M1 dit l'inverse (PROD +3 102 $ contre
  +2 010 $).
- Tirer une conclusion BTC d'un simulateur trend.
- Remonter S2 à 500 $ avant le retour de S1.

## 5. Levier préparé, pas actionné

`SWING_XAUUSD=0` (variable Railway, S2 et S3) coupe les nouvelles entrées swing or sans déploiement ; les
positions ouvertes restent gérées. `SWING_BTCUSD=0` fait de même pour BTC. Décision : Mathieu.
