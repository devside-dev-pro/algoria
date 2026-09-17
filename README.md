# Algoria AI

Cockpit de trading IA sur **l'or (XAU/USD) et le Bitcoin** — analyse temps réel, signaux par confluence, exécution via MetaTrader, copy vers le réel via Social Trader Hub.

## Architecture

- **`lib/engine/`** — le cerveau (déterministe, partagé live ⇄ backtest) :
  `context` (régime / session / macro) → `features/` (confluence) → `score` → `trade` (SL/TP/sizing) → `risk` (le gardien).
- **`runner/`** — service Node always-on : tient la connexion **MetaApi**, écrit tout dans Supabase, alimente le canal VIP. Il fait tourner le moteur et place les ordres **hors mode copie** ; en mode copie (l'état actuel, voir plus bas) il n'ouvre rien et se contente d'observer.
- **`app/` + `components/`** — le cockpit Next.js (read-only), alimenté par **Supabase Realtime**.
- **`backtest/`** — rejoue `runTick` sur l'historique (le même code que le live) : expectancy, profit factor, drawdown, tuning.

## Flux d'exécution

Deux montages coexistent. Celui d'origine, quand le moteur trade lui-même :

```
Algoria (runner) → MetaApi → MT5 MASTER (démo) → Social Trader Hub → compte RÉEL
```

Et celui en production depuis le **17/09/2026**, où le compte suivi par les membres est aussi celui qu'on pilote :

```
stratégie source ──copie (licence STH séparée)──▶  ALGORIA 2.0 / S2  ──copie (licence partenaire)──▶  comptes membres
                                                         ▲
                                            stops et clôtures posés À LA MAIN
```

**Ce qui a changé, et pourquoi ça compte.** Les membres étaient branchés directement sur la stratégie source, en
lecture seule ; S2 n'était qu'un suiveur de plus, au même titre qu'eux. Fermer un trade en avance ou poser un
stop sur S2 ne changeait donc rien pour personne. Maintenant S2 **est** leur master : chaque geste manuel s'y
propage. C'est aussi ce qui a rendu nécessaire le suivi du stop dans `runner/observer.ts` — il ne le lisait
qu'une fois, à l'ouverture, et les stops posés après coup n'existaient nulle part dans la base.

En mode copie (`ALGORIA_COPY_OBSERVE=1`), le runner **ne place aucun ordre**. Il observe les positions de S2
toutes les 15 s et les écrit (`runner/observer.ts`), enregistre les clôtures (`DealRecorder`), et poste dans
le VIP. Le soft ne touche jamais le broker réel directement.

**Un seul master est visible sous la licence partenaire** : celui des membres. `STH_MASTER_ID` doit porter son
id — pas pour que les connexions fonctionnent, l'auto-découverte y arriverait (`lib/member/sth.ts:195`), mais
pour que `TOOLS › STH AUDIT` puisse repérer quelqu'un resté sur un ancien master. Variable vide, et
`app/api/member/admin/route.ts:1103` compte tout le monde comme `ok`, quel que soit son master réel.

## Démarrage

```bash
npm i
cp .env.example .env     # remplis SUPABASE_SERVICE_KEY, METAAPI_TOKEN, METAAPI_ACCOUNT_ID
# .env.local contient déjà les clés publiques Supabase

npm run dev              # le cockpit            → http://localhost:3000
npm run runner           # le moteur (MetaApi + écriture Supabase)
npm run backtest         # validation sur l'historique
```

## ⚠️ Avertissement

Outil personnel / éducatif. Le trading comporte un risque de perte en capital. Aucune stratégie ne garantit le profit. Toujours valider en démo avant d'engager du capital réel.
