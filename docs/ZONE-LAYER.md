# Couche « ZONE » — cassure du range de la veille + retest (06/09/2026)

Règle prise telle quelle dans un EA public (blackXAU « H4 Zone Retest », variante sans trailing), rejouée sur
deux ans de nos bougies M5 dans `backtest/ea-arena.ts`, puis branchée dans le runner. Code : `lib/engine/zone.ts`
(règle pure) et le bloc « COUCHE ZONE » de `runner/index.ts` (exécution).

## Ce que le labo a dit (1 lot, coûts 0,32 $/oz, oct 2024 → sept 2026)

| variante | trades | win | net | PF | pire creux |
|---|---|---|---|---|---|
| sans trail, telle que l'EA | 271 | 35 % | +55 644 $ | 1,15 | −49 941 $ |
| idem, direction au hasard | 259 | | +44 810 $ | 1,12 | −44 427 $ |
| **version live** (EMA causale, entrée au marché) = ce que le runner fait | 257 | 37 % | +76 768 $ | 1,22 | −27 506 $ |
| version live, direction au hasard | 254 | 35 % | +15 522 $ | 1,04 | −42 278 $ |

Depuis le 1er juin 2026, version live : 41 trades, +27 604 $, PF 1,39, creux −23 511 $ ; au hasard +11 120 $.
12 mois verts sur 24 ; pires mois −10 337 $ (nov. 2025) et −9 310 $ (août 2025) ; trois mois rouges d'affilée
en été 2025 (−18,6 k$). Un membre à 0,01 lot divise tout par 100 : le pire creux vaut −275 $.
Mathieu a vu ces chiffres et a décidé de la connecter.

## Règle

- Zone = plus-haut / plus-bas du jour broker précédent (dernière D1 close du broker).
- Sur une M5 close, 7 h-22 h heure broker : cassure si open ≤ zoneHigh < close et corps ≥ 50 % de la bougie ou ≥ 2 $
  (symétrique à la baisse). Puis attente d'un retest du bord de la zone, 24 h au plus, annulée au changement de jour.
- Retest = une M5 close qui touche le niveau. Entrée au marché si la clôture est au-dessus de l'EMA50 et de
  l'EMA200 H1 (resp. en dessous). Un retest refusé par l'EMA n'est pas réessayé.
- SL = 1,5 × ATR(H1, 14), TP = 3 × ATR, posés au broker. Aucun breakeven, palier, trailing ni protection avant
  annonce. Une position à la fois, lot fixe, tenue la nuit et le week-end. Le cap journalier ne la ferme pas.

## Écarts avec l'arène d'origine

1. Filtre EMA causal (l'arène lisait la clôture de l'heure entière, jusqu'à 55 min d'avance). L'arène a été
   corrigée le même jour (variante « L ») pour mesurer l'effet.
2. Entrée au marché sur la clôture de la M5 de retest, pas au niveau exact.
3. Spread max, kill switch et veto portefeuille s'appliquent.

## Allumer / éteindre (Railway, sans déploiement)

```
ZONE_XAUUSD=1        # active la couche (défaut : éteinte)
ZONE_XAUUSD_LOT=1    # lot fixe du master (défaut 1)
SCALP_XAUUSD=0       # recommandé avec : elle remplace, elle ne s'ajoute pas
SWING_XAUUSD=0
```

Une position ouverte garde sa règle (SL/TP broker) même si `ZONE_XAUUSD` est retiré ensuite.

## Ce qu'il faut regarder après un mois

Nombre de trades, R moyen par trade, et surtout le résultat de la version « direction au hasard » sur la même
période. Si le live ne bat pas le hasard, la couche s'éteint.
