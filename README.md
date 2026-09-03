# Algoria AI

Cockpit de trading IA sur **l'or (XAU/USD) et le Bitcoin** — analyse temps réel, signaux par confluence, exécution via MetaTrader, copy vers le réel via Social Trader Hub.

## Architecture

- **`lib/engine/`** — le cerveau (déterministe, partagé live ⇄ backtest) :
  `context` (régime / session / macro) → `features/` (confluence) → `score` → `trade` (SL/TP/sizing) → `risk` (le gardien).
- **`runner/`** — service Node always-on : tient la connexion **MetaApi**, fait tourner le moteur, place les ordres sur le compte **master**, écrit tout dans Supabase.
- **`app/` + `components/`** — le cockpit Next.js (read-only), alimenté par **Supabase Realtime**.
- **`backtest/`** — rejoue `runTick` sur l'historique (le même code que le live) : expectancy, profit factor, drawdown, tuning.

## Flux d'exécution

```
Algoria (runner) → MetaApi → MT5 MASTER (démo) → Social Trader Hub → compte RÉEL
```

Le soft ne touche jamais le broker réel directement.
**Le follower réel ne se branche qu'APRÈS un backtest + un forward-test démo concluants.**

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
