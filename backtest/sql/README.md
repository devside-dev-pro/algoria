# Laboratoire SQL — backtester sans rapatrier les bougies

## Pourquoi ce dossier existe

`backtest/lab.ts` et `backtest/run.ts` ont besoin du cache local
(`backtest/.cache/<SYM>-<TF>-15.json`, alimenté par `scripts/pull-cache.mjs`). Ce cache est
**inaccessible depuis un agent** : l'egress bloque `*.supabase.co`, donc `pull-cache.mjs` échoue avec
`Host not in allowlist`. Le connecteur MCP Supabase, lui, passe.

D'où ce laboratoire : **la simulation tourne DANS Postgres**, là où les bougies vivent déjà.

---

## ⚠️ LIRE CECI AVANT TOUT — le défaut qui a produit six faux edges

**Le 10/08/2026, la première version de ce laboratoire a produit six familles gagnantes, toutes autour
de 84 % de trades verts, dont une donnée pour +0,124R sur 22 mois avec huit trimestres positifs.
TOUT ÉTAIT FAUX.**

La faute : le niveau de stop est calculé sur le pic des bougies **précédentes**. Quand ce niveau se
retrouve **au-dessus de l'ouverture** de la bougie courante (le marché a sauté par-dessus pendant la
nuit ou sur une mèche), la simulation encaissait quand même le trade **au niveau du stop**. En réalité
on est rempli à l'**ouverture**, donc plus bas. Le défaut transformait systématiquement des perdants en
petits gagnants — d'où les 84 % de verts identiques sur toutes les familles, quelle que soit l'entrée.

Le correctif tient en une ligne, dans la CTE de sortie :

```sql
-- FAUX : encaisse le niveau du stop même si la bougie a ouvert en dessous
case when adv <= sr then sr else tpr end
-- JUSTE : rempli à l'ouverture quand le marché a déjà sauté le stop
case when adv <= sr then least(sr, opn) else greatest(tpr, opn) end
```

où `opn = dir * (open - entry) / riskDist` de la bougie courante.

**Effet du correctif sur les mêmes données :** les six familles passent de « +0,067 à +0,158R » à
« −0,029 à −0,094R ». Aucune ne bat l'aléatoire.

## LE CONTRÔLE OBLIGATOIRE — entrées arbitraires

**Ne JAMAIS présenter un résultat sans avoir fait tourner des entrées arbitraires dans le même
harnais.** C'est ce contrôle, et lui seul, qui a révélé le défaut ci-dessus : il rapportait
+0,041 à +0,114R avec 88 % de verts, ce qui est impossible.

```sql
select 'ALÉATOIRE long 1/40'  fam, i, nextt, 1  from x where nn=50 and atr>0 and i % 40 = 0
union all
select 'ALÉATOIRE short 1/40',     i, nextt, -1 from x where nn=50 and atr>0 and i % 40 = 7
union all
select 'ALÉATOIRE alterné 1/25',   i, nextt, case when (i/25) % 2 = 0 then 1 else -1 end
  from x where nn=50 and atr>0 and i % 25 = 3
```

Attendu sur un harnais SAIN : **−0,03 à −0,10R, ~50 % de verts**. Toute entrée arbitraire qui
« gagne » signale un défaut de simulation, jamais une découverte.

Repère mesuré le 10/08/2026 après correctif : −0,1033 / −0,0659 / −0,0267 R, 49,9 / 52,5 / 56,8 % verts.

---

## Ce que la simulation garantit

- **Causalité** : décision sur la clôture de `i`, entrée à l'**open de `i+1`**. Indicateurs en fenêtres
  `rows between N preceding and current row`. Aucun regard vers l'avant.
- **Pessimisme** : dans une même bougie, le **stop est testé AVANT le TP**. Le niveau de stop vient du
  pic des bougies **précédentes** (`rows between unbounded preceding and 1 preceding`).
- **Remplissage honnête** : gap au-delà du stop → rempli à l'ouverture (voir ci-dessus).
- **Gestion de sortie** identique à `runner/metaapi/manage.ts` : breakeven, paliers, trailing, en R sur le pic.
- **Coûts réels** : demi-spread + slippage à l'entrée ET à la sortie, plus la commission au lot
  (or : spread 0,2 $, slippage ~0,05 $, commission 7 $/lot — voir `backtest/labcore.ts` SPECS).
- **Une position à la fois** : sélection gloutonne sans chevauchement par CTE récursive.

## Ce qu'elle ne couvre PAS

Kill switch journalier, plafond de perte, verrou d'objectif · filtre news · filtre de session ·
slippage aggravé sur stop en marché rapide · risque portefeuille · le breakeven s'arme sur le **pic**
alors que `manage.ts:65` l'arme sur le **profit courant** (la simulation est optimiste sur ce point).

## Couverture des données (relevée le 10/08/2026)

⚠️ **Vérifier la continuité, pas seulement min/max.** La série XAUUSD M5 annonce 10/04→10/08 mais
comporte un trou : une journée isolée en avril, **rien en mai**, puis juin (25 j), juillet (27 j) et
8 jours d'août. C'est **60 jours de bourse**, pas quatre mois — erreur commise puis corrigée le 10/08.

| Symbole | TF  | Bougies | Couverture réelle |
|---------|-----|---------|-------------------|
| XAUUSD  | H1  | 10 664  | 22 mois continus — la meilleure fenêtre de validation |
| XAUUSD  | M5  | 13 772  | 60 jours (juin, juillet, 8 j d'août) |
| XAUUSD  | M1  | 59 876  | ~2 mois |
| XAUUSD  | D1  |  5 175  | depuis 2008 |
| BTCUSD  | H1  |  5 899  | ~33 mois |

Bonne pratique : **régler sur M5, valider sur H1** — les paramètres deviennent alors hors-échantillon.

## Résultats de référence (après correctif, 10/08/2026)

Six familles testées sur M5, 60 jours, même gestion de sortie, coûts déduits. **Aucune ne bat
l'aléatoire** :

| Famille | Espérance nette | % verts |
|---|---|---|
| SMA stretch (écart > 2 ATR de la SMA50) | −0,0285R | 53,3 % |
| Momentum (bougie > 1,8 ATR, clôture dans l'extrême) | −0,0344R | 51,0 % |
| Stochastique extrême | −0,0489R | 54,3 % |
| Donchian 20 | −0,0533R | 49,3 % |
| VWAP fade (excès > 1,5 ATR) | −0,0570R | 51,5 % |
| VWAP rebond (retour au-dessus du VWAP) | −0,0935R | 47,6 % |
| *témoin aléatoire* | *−0,027 à −0,103R* | *~50 %* |

**Le scalp de confluence en production**, mesuré sur 865 signaux réels avec le harnais corrigé :
**+0,0130R** avant les changements du 10/08, **+0,0098R** après (voir `mean-reversion.sql`).
C'est faible mais positif — et c'est, à ce jour, le seul générateur d'entrées mesuré au-dessus de zéro.

## Règles de jugement

1. **Le témoin aléatoire d'abord.** Sans lui, aucun résultat ne compte.
2. **Les deux moitiés positives**, pas seulement le total.
3. **Un plateau, pas un pic** : les réglages voisins doivent tenir.
4. **La symétrie achat/vente** : tout l'edge d'un seul côté = pari de régime déguisé.
5. **Une découpe temporelle indépendante** (trimestres), toutes positives.
6. **Les coûts déduits**, jamais du R brut.
7. **Le taux de trades non résolus** dans l'horizon, vérifié explicitement
   (`bool_or(adv <= -1 or fav >= 1)`) — écartés silencieusement, ils biaisent tout.
8. **Se méfier de ce qui marche trop bien.** Six familles gagnantes d'affilée, ou un taux de trades
   verts identique quelle que soit l'entrée, ne sont pas une découverte : ce sont les symptômes d'un
   défaut de harnais.
