# Algoria Desk

Le bouton central de l'app. Un desk d'analystes IA qui écrit une lecture par marché et par jour, sur l'or et le
bitcoin. **C'est du contenu, pas une promesse de performance** — décision Mathieu du 09/09/2026, et cette phrase
est la règle qui tranche tous les arbitrages qui suivent.

## Le rythme d'une journée

| Heure UTC | Quoi | Où |
|---|---|---|
| 06:00 | Le service analyse les deux marchés, puis écrit un brief en langage courant | Railway, service « Algoria Desk » |
| 06:00 | Avant d'analyser, il remplit le suivi des appels passés (+1J, +3J, +7J) | même service |
| 06:40 | Les membres reçoivent une notification ; le VIP reçoit la carte si c'est autorisé | cron Vercel `/api/cron/desk-publish` |

## Les trois étages de l'écran

1. **THE BRIEF** — le graphique TradingView, la note, un titre, trois phrases, ce que la note veut dire, le
   plancher et le plafond surveillés, ce qui ferait changer d'avis. C'est ce que voit tout le monde.
2. **DEEP DIVE** — les douze voix du desk, repliées, une ligne de résumé chacune. On ouvre ce qu'on veut lire.
3. **CALLS** — chaque appel passé, le prix de référence, et ce que le prix a fait 1, 3 et 7 jours après.
   Affiché tel quel, bon ou mauvais. C'est la moitié honnête du produit ; ne jamais la cacher.

## D'où viennent les prix

Deux sources, et il faut savoir laquelle fait quoi.

- **Nos bougies** (table `candles`, écrites par le runner) : les prix affichés en haut de l'écran, le prix de
  référence de chaque appel, le suivi à 1, 3 et 7 jours, le watchdog du flux. C'est la source qui fait foi.
- **TradingView** : le graphique de l'écran Desk, et rien d'autre. On ne peut pas l'interroger, il ne remplace
  aucun des points ci-dessus. Or et BTC pointent sur du spot (`OANDA:XAUUSD`, `BITSTAMP:BTCUSD`).
- **Yahoo Finance**, à l'intérieur du framework : ce que lisent les agents pendant l'analyse. L'or y est une
  future COMEX (`GC=F`), pas notre spot — d'où un écart de quelques dizaines de dollars entre le texte des
  agents et notre prix. Connu, pas encore corrigé : il faudrait nourrir les agents avec nos propres bougies.

Les séries M15, H1 et D1 de notre base ne sont plus alimentées en continu (elles s'arrêtent en cours de route).
Le suivi des appels lit donc le M5 puis le M1, les deux seules unités que le runner écrit vraiment.

## La carte

`GET /api/card/desk?market=XAUUSD|BTCUSD` → une image 1200×675 avec la note, le titre, les deux prix surveillés
et la mention « reading material, not a promise ». Aucun chiffre ne vient de l'URL : tout est relu en base, donc
une URL bricolée ne peut pas inventer un appel. C'est l'image que la CM poste, et celle que Telegram va chercher.

## Ce qui est coupé par défaut

Le VIP ne parle pas tout seul. Le post quotidien dans le canal n'existe que si `DESK_VIP_POST=1` est posée sur
Vercel, et il faut aussi `TELEGRAM_VIP_CHAT`. Sans ça, la route pousse la notification aux membres et s'arrête là.
C'est volontaire : depuis le 09/09, aucun canal ne publie sans décision de Mathieu.

## Réglages

Sur Railway, service « Algoria Desk » :

| Variable | Effet |
|---|---|
| `DESK_MARKETS` | les marchés analysés (défaut `XAUUSD,BTCUSD`) |
| `DESK_DEEP_MODEL` / `DESK_QUICK_MODEL` | le raisonnement / la lecture des données |
| `DESK_BRIEF_MODEL` | le brief en langage courant (défaut : le modèle de raisonnement) |
| `DESK_DEBATE_ROUNDS` | chaque tour ajoute deux appels de modèle et du coût |
| `DESK_DRY_RUN=1` | vérifie la chaîne sans dépenser un appel de modèle |
| `DESK_FORCE=1` | refait un marché déjà analysé aujourd'hui |
| `FRED_API_KEY` | la macro (taux, inflation) ; sans elle l'analyste news se tait proprement |

Coût observé le 09/09 : environ 1,3 $ par marché et par jour pour l'analyse, environ 0,05 $ pour le brief.

## Lancer une analyse à la main

Un service planifié Railway **ne tourne qu'à l'heure du cron** : un déploiement ne lance pas la commande. Pour
forcer un passage, il faut retirer le cron, redéployer, puis le remettre. C'est le seul point de friction connu,
et c'est ce que le panneau admin devra automatiser.

## Vérifier sans rien envoyer

`GET /api/cron/desk-publish?dry=1` rend exactement ce qui partirait — la notification et le texte VIP — sans rien
pousser ni marquer comme annoncé.
