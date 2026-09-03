# Couche de tendance journalière (D1) — mode d'emploi

*Écrit le 03/09/2026. Chiffres : `backtest/trend-portfolio.ts`, sortie de Mathieu du 03/09 (swaps réels du broker).*

## 1. Ce que c'est

La seule règle qui sort de la ligne de base hors échantillon, sur 18 ans d'or et 14 ans de BTC :
cassure de canal Donchian 50 jours à la clôture journalière, stop 2 × ATR(20), sortie sur le canal
opposé de 25 jours (le stop le suit, jamais à reculons), 1 % de l'équité par trade, une position par marché.

| or + BTC, 2012 → 2026 | Donchian 50 j |
|---|---|
| rendement annualisé | +14,8 % |
| années négatives | 3 / 15 (pire −1,4 %) |
| pire perte depuis un sommet, depuis 2014 | −21,2 % (2017) |
| plus longue période sans nouveau sommet | 1 444 jours |
| trades par an et par marché | ~9 |
| trades gagnants | or 37 % · BTC 46 % |
| levier maximal | 1,13 × |

**Mauvaises nouvelles d'abord.** Quatre ans sans nouveau sommet, c'est la vie normale de ce système.
Il n'y a pas de « journée verte » : il y a des mois plats et quelques trades qui font l'année. On le
présente en R (R du mois, R cumulé), jamais en pourcentage de trades gagnants.

## 2. Ce que fait le runner (`lib/engine/trend.ts`, `runner/index.ts` bloc « COUCHE DE TENDANCE »)

- Toutes les 5 minutes : lit les bougies **D1 du broker** (les mêmes que le backtest), ne garde que les
  closes, et ne décide qu'**une fois par bougie close**. Il attend une cotation fraîche : la bougie du
  vendredi se décide à la ré-ouverture du dimanche soir (= « entrée à l'ouverture du lendemain »).
- Position ouverte : clôture au-delà du canal de 25 j → fermeture au marché ; sinon stop remonté sur le
  canal, tenu **par le broker**. Aucune gestion tick par tick (`beTrigger 0`), aucune protection avant
  annonce (`newsGuard: false`), pas d'assurance week-end (elle ne touche que les refs `-swing-`), et le
  cap de perte journalier ne ferme pas ces positions.
- Sans position : cassure du canal de 50 j → ordre au marché, stop à 2 × ATR du prix courant, lot =
  1 % de l'équité / (stop × contrat), arrondi **vers le bas** au pas du broker. Si le lot tombe sous le
  minimum, le signal est enregistré `rejected` avec la raison, et rien n'est ouvert.
- Restauration après redéploiement : `ensureManagement` reconnaît `-trend-` et remet la gestion neutre.
- Parité vérifiée : sur une série synthétique, le moteur live reproduit trade pour trade le backtest
  (sens, jour d'entrée, jour de sortie, prix).

## 3. Activation — proposé, Mathieu décide

Variables Railway, **par marché**, OFF par défaut :

```
TREND_XAUUSD=1     # or
TREND_BTCUSD=1     # Bitcoin
```

Recommandation : **un master dédié** (nouveau service Railway), avec `SWING_XAUUSD=0 SWING_BTCUSD=0`,
mesuré en R pendant une saison avant d'y attacher un membre. Sur un master existant, la couche
cohabiterait avec le scalp et le swing : le veto portefeuille (3 positions par instrument) s'applique.

**Taille de compte minimale** (lot minimal 0,01 chez le broker, risque 1 %) :

| marché | stop typique (2 × ATR) | équité minimale à 1 % |
|---|---|---|
| or | ~40 $ × 100 oz = 4 000 $ par lot | ~4 000 $ |
| Bitcoin | ~4 000 $ × 1 BTC par lot | ~4 000–5 000 $ |

En dessous, le runner refuse le trade plutôt que de risquer 2 ou 3 % « parce que le compte est petit ».
Les membres copiés en lot fixe par STH prennent le risque en dollars de LEUR lot : à communiquer en R.

## 4. Ce qu'on ne fait pas

- Pas de changement de paramètres entre le backtest et la prod (N, sortie, ATR, risque identiques).
- Pas de breakeven, de palier ni de trailing intraday sur ces positions : le tribunal des entrées a
  montré que ces mécaniques ne créent pas d'edge, et le backtest de la couche n'en contient pas.
- Pas de « protection des gains » (variante +16,7 %) pour l'instant : elle n'a été vue que sur une
  sortie, on ne retient pas la meilleure ligne d'un tableau.

## 5. Bascule de S2 (décision Mathieu, 03/09) — variables Railway du service S2

```
SCALP_XAUUSD=0     # plus de scalp ni de breakout intraday sur l'or (watch-only, comme le BTC)
SWING_XAUUSD=0     # plus de nouvelle entrée swing or
SWING_BTCUSD=0     # plus de nouvelle entrée swing BTC
TREND_XAUUSD=1     # tendance journalière or
TREND_BTCUSD=1     # tendance journalière BTC
```

Les positions déjà ouvertes gardent leur gestion jusqu'à leur sortie ; aucune n'est fermée par la bascule.
Le cockpit, le desk, les bougies et le trade manuel continuent. Le master prend 1 % de SON équité par trade ;
un membre copié en lot fixe prend « largeur du stop × son lot » — voir §3 pour l'équité minimale.
