# Laboratoire SQL — backtester sans rapatrier les bougies

## Pourquoi ce dossier existe

`backtest/lab.ts` et `backtest/run.ts` ont besoin du cache local
(`backtest/.cache/<SYM>-<TF>-15.json`, alimenté par `scripts/pull-cache.mjs`). Ce cache est
**inaccessible depuis un agent** : l'egress bloque `*.supabase.co`, donc `pull-cache.mjs` échoue avec
`Host not in allowlist`. Le connecteur MCP Supabase, lui, passe.

D'où ce laboratoire : **la simulation tourne DANS Postgres**, là où les bougies vivent déjà. Aucune
donnée à transférer, aucun cache à construire. C'est le seul chemin praticable tant que l'egress est
fermé, et il a l'avantage d'être exact — on lit les mêmes bougies que le runner.

Contrôle de fidélité (10/08/2026) : le rejeu de la config live sur 853 signaux réels reproduit **17,6 %
de stops pleins contre 18,4 % réellement constatés en base**, et 54 % de break-even contre 48 %.

## Ce que couvre la simulation

- **Causalité** : décision sur la clôture de la bougie `i`, entrée à l'**open de `i+1`**. Les indicateurs
  n'utilisent que des fenêtres `rows between N preceding and current row`. Aucun regard vers l'avant.
- **Pessimisme** : dans une même bougie, le **stop est testé AVANT le TP**. Le niveau de stop est
  calculé sur le pic de la bougie **précédente** (`rows between unbounded preceding and 1 preceding`).
- **Gestion de sortie** identique à la production (`runner/metaapi/manage.ts`) : breakeven, paliers de
  verrouillage, trailing — tous exprimés en multiples de R sur le pic.
- **Coûts réels** : demi-spread + slippage à l'entrée ET à la sortie, plus la commission au lot.
  Sur l'or : spread 0,2 $, slippage ~0,05 $, commission 7 $/lot (voir `backtest/labcore.ts` SPECS).
- **Une position à la fois** : sélection gloutonne sans chevauchement par CTE récursive, comme le
  `maxOpenPositions: 1` du moteur.

## Ce qu'elle ne couvre PAS — à dire avant toute conclusion

- Pas de kill switch journalier, pas de plafond de perte, pas de verrou d'objectif.
- Pas de filtre news, pas de filtre de session.
- Pas de slippage aggravé sur les stops en marché rapide (le pire cas réel est au-delà du modèle).
- Une seule paire à la fois, pas de risque portefeuille.
- Le breakeven s'arme sur le **pic**, alors que `manage.ts:65` l'arme sur le **profit courant** —
  la simulation est donc légèrement optimiste sur ce point précis.

## Couverture des données (relevée le 10/08/2026)

⚠️ **Vérifier la continuité, pas seulement min/max.** La série XAUUSD M5 va du 10/04 au 10/08 mais
comporte un TROU : une journée isolée en avril, rien en mai, puis juin (25 j), juillet (27 j) et 8 jours
d'août. C'est **60 jours de bourse**, pas quatre mois — erreur commise puis corrigée le 10/08.

| Symbole | TF  | Bougies | Couverture réelle |
|---------|-----|---------|-------------------|
| XAUUSD  | H1  | 10 664  | 22 mois continus — **la meilleure fenêtre de validation** |
| XAUUSD  | M5  | 13 772  | 60 jours (juin, juillet, 8 j d'août) |
| XAUUSD  | M1  | 59 876  | ~2 mois |
| XAUUSD  | D1  |  5 175  | depuis 2008 |
| BTCUSD  | H1  |  5 899  | ~33 mois |

La bonne pratique qui en découle : **régler sur M5, valider sur H1**. Les paramètres trouvés sur les
60 jours de M5 deviennent un hors-échantillon de 22 mois quand on les applique tels quels sur H1.

## Fichiers

- `mean-reversion.sql` — famille « écart à la moyenne », la première testée (voir son en-tête pour
  les résultats et les réserves).

## Comment s'en servir

Coller la requête dans l'outil MCP Supabase (`execute_sql`, projet `zhalwdaesjzikhovafjl`). Les
paramètres se règlent dans la CTE `p(...)` : une ligne par combinaison, elles tournent en parallèle.

Deux limites pratiques : l'appel MCP **expire à 60 s** (au-delà de ~6 combinaisons sur M5, découper),
et une CTE récursive de sélection sans chevauchement est sérielle — c'est elle qui coûte le plus cher.

## Règles de jugement

Un résultat n'est PAS un edge tant qu'il n'a pas passé :

1. **Les deux moitiés d'échantillon positives** — pas seulement le total.
2. **Un plateau, pas un pic** : les réglages voisins doivent tenir. Une cellule isolée est un artefact.
3. **La symétrie achat/vente** : si tout l'edge est d'un seul côté, c'est un pari de régime déguisé.
4. **Une découpe temporelle indépendante** (trimestres sur H1) — et toutes positives, pas la moyenne.
5. **Les coûts déduits**, jamais du R brut.
6. **Le taux de trades non résolus** dans l'horizon : s'ils sont écartés silencieusement, le résultat
   est biaisé. Le vérifier explicitement (`bool_or(adv <= -1 or fav >= 1)`).

Et même après tout ça : un backtest n'a jamais gagné un dollar. Il donne un candidat, pas une preuve.
