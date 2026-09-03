# Audit produit — parcours client, CRM admin, app membre, bot (03/09/2026)

Après ~370 PR en deux mois, tour complet de ce qui existe : code lu ligne à ligne (quatre passes
indépendantes : parcours membre, CRM admin, écrans client, bot et notifications) et base de production
interrogée le 03/09. Constats, pas de redesign. Les priorités sont en bas.

## 0. Les chiffres qui cadrent tout

| tunnel (base du 03/09) | valeur |
|---|---|
| membres inscrits | 1 017 |
| encore `onboarding` | 943 (dont 730 n'ont jamais choisi de broker) |
| en copie (`live` + `paused`) | 54 |
| inscrits en août | ~750, pour 25 connexions |
| demandes de connexion | 83 acceptées · **72 rejetées** · 6 en attente (la plus vieille : 8 jours) |
| relances auto | 20 par jour maximum, à 10 h UTC, sans ordre de priorité |

Conséquence directe du plafond des relances, mesurée sur les 920 prospects de la fenêtre J+1 → J+60 :

| ancienneté | en onboarding | jamais relancés |
|---|---|---|
| J+1 à J+7 | 217 | **217** |
| J+8 à J+14 | 196 | 194 |
| J+15 à J+30 | 358 | 280 |
| J+31 à J+60 | 149 | 3 |

Les 20 places quotidiennes vont aux plus anciens (la requête n'a pas de tri : `fetchNudgeCandidates`,
`lib/supabase/sync.ts:173`, cap `.slice(0, 20)` dans `runner/index.ts:1138`). Aucun inscrit de la semaine ne
reçoit le message J+1. C'est l'inverse de l'intention.

## 1. Ce que le propriétaire ne reçoit jamais

Vérifié ligne à ligne : **aucune notification métier** n'existe. Les seules alertes sont techniques (runner
muet, calendrier éco, tunnel bloqué, edge), via `pushToAdmins` (`lib/push/send.ts:45`).

| événement | alerte | où ça s'écrit |
|---|---|---|
| un membre entre en file de validation (carte `connect`) | aucune | `queueAction`, `app/api/member/me/route.ts:23-32` |
| un membre déclare son lot d'activation | aucune | `me/route.ts:450-470` |
| une demande de retrait affilié | aucune | `me/route.ts` action `withdraw` |
| un prospect écrit au bot | aucune (accusé au prospect seulement) | `app/api/telegram/route.ts:475-492` |
| pause / déconnexion d'un membre | aucune | `me/route.ts:511-529` |

Trois défauts aggravants :
- les liens des alertes admin pointent sur `/member/admin`, page morte qui redirige vers `/admin`, elle-même
  réécrite en `/member/admin` sur `app.algoria.tech` → boucle (`runner/index.ts:998`, `:1121`,
  `runner/sentinel.ts:96`, `middleware.ts:33-36`) ;
- `pushToAdmins` renvoie 0 sans erreur si l'admin n'a pas activé le push depuis l'app (`send.ts:52-54`) ;
- la file QUEUE de l'admin est plafonnée à 100 cartes sans le dire (`app/api/member/admin/route.ts:106`).

## 2. Le parcours membre : les impasses

1. **`/member/pending` est une page morte.** Aucun lien, aucune redirection n'y mène (seule occurrence :
   la liste cosmétique `bare`, `app/member/ui.tsx:372`). Or c'est la seule page qui dit la règle des 30 jours
   de blocage du capital, la liste des 4 conditions d'activation, et qui porte le bouton « j'ai placé mes
   deux trades » (`action:'activation'`, injoignable). Le wizard promet « we'll remind you on the next
   screen » (`onboarding/page.tsx:489`) : l'écran suivant est le Home, qui ne rappelle rien.
2. **Le membre en `pending_copier` n'est relancé par personne** : `fetchNudgeCandidates` filtre
   `status='onboarding'` (`sync.ts:183`), la file manuelle aussi (`app/admin/page.tsx:1236`). Il voit un
   texte fixe « usually within a few hours », même au bout de 8 jours.
3. **Deux minimums de dépôt contradictoires sur le même tunnel** : `onboarding/page.tsx:257` affiche en dur
   `STEADY $200 · BALANCED $500 · TURBO $1,000` ; la source de vérité dit `{1: 200, 2: 200, 3: 1000}`
   (`lib/member/minimums.ts`) et le sélecteur deux écrans plus loin affiche « min $200 » pour BALANCED. S1
   est en maintenance (`lib/member/maintenance.ts:41`) mais reste listée ici, dans « Add a strategy »
   (`app/member/page.tsx:191-214`) et dans le comparatif History (`history/page.tsx:91-98`, où cliquer S1
   affiche silencieusement les trades de S2).
4. **La FAQ promet « withdraw from your broker anytime »** (`app/page.tsx:142`) ; trois écrans imposent 30
   jours (`pending:109`, `add-strategy:96`, `recover:82`). La contradiction la plus coûteuse du parcours.
5. **Dépôt sous le minimum : refus à l'étape 3, après la saisie du mot de passe**, et il faut tout
   re-saisir (`onboarding:529-534`, `me/route.ts:276-277`). Même chose après un refus admin : le formulaire
   se referme (`origin` remis à `null`, `onboarding:125`).
6. **72 rejets sur 155 demandes**, presque tous pour identifiants faux, compte démo ou broker non partenaire
   (raisons libres, 40 formulations différentes). Le formulaire n'attrape rien de tout ça avant l'envoi.
7. **Un broker est enregistré même si le membre n'a rien cliqué** (`picked ?? lead.key`, `onboarding:275`).
8. **Reprise du wizard** : un membre revenu à mi-parcours retombe sur le Home prospect et doit re-cliquer
   « UNLOCK » puis relire la bottom-sheet des 3 étapes (`page.tsx:100-104`, `ui.tsx:244-256`).
9. **Le lot 0.01 est écrit en dur sur la carte connect** (`me/route.ts:293`) et `connectSth` le lit au lieu de
   `members.lot` (`admin/route.ts:788`), alors que `reconnectSth` et `moveSth` font l'inverse (`:810`, `:835`).
10. **Chemins morts qui contournent des règles** : `/api/member/auth` (sans appelant) crée une session sans
    lire `banned_at` ; `action:'risk'` (sans appelant) passe en `pending_copier` sans vérifier le minimum de
    dépôt (`me/route.ts:335-369`).
11. **Le VIP** : deux notions sous le même mot (`member_whitelist` = déverrouillage de l'app ;
    `TELEGRAM_VIP_CHAT` = canal). 138 demandes d'adhésion `waiting` sans DM, âge moyen 45 jours, invisibles
    dans l'admin (`joinSources` n'expose pas les `waiting`).
12. **i18n** : « l'app est traduite à 100 % » (`profile/page.tsx:76`) est faux ; tout le bloc lot d'activation,
    les engagements, le bandeau de refus, Home, History, Live, Academy, Profile sont en anglais codé en dur ;
    25 clés traduites ne sont plus appelées ; les 7 relances auto sont en anglais, y compris pour `locale='it'`.

## 3. Le CRM admin

- **Un seul composant de 2 374 lignes** (`app/admin/page.tsx`), ~60 états, et une API `POST` à ~38
  branches (`admin/route.ts`). Le `GET` de rafraîchissement (toutes les 30 s) fait 14 requêtes Supabase,
  jusqu'à 8 appels Telegram `getChat` et un `getWebhookInfo`, et **écrit en base depuis un GET**
  (`route.ts:186-215`).
- **Plafonds silencieux** : queue 100, dépôts 500 (alimente bilan mensuel, export CSV, entonnoir, audience
  de campagne), commissions 300, nudges 500 (mémoire du cooldown), audit STH 60 membres affiché comme complet.
- **Libellés qui mentent** : `📋 WHATSAPP` copie dans le presse-papiers ; `✓ DONE` passe le membre live,
  envoie un push, crée une commission et ouvre deux prompts ; le tooltip d'`OFF-BOARD` dit `paused` alors
  que l'API écrit `offboarded` ; `⏳ BROKER` est une bascule silencieuse ; `🔍 STH STATUS` affiche du JSON
  brut dans un `alert` ; `👑 VIP / TEAM ACCESS` gère la whitelist, pas le canal ; colonne `RISK` = valeur
  périmée.
- **Doublons** : deux files de relance (celle de TOOLS n'écrit rien en base, donc invisible du cooldown) ;
  cinq mécanismes d'envoi groupé avec trois anti-doublons différents ; passage en live par deux boutons ;
  saisie du pays à trois endroits ; trois branches API pour révéler des identifiants dont une jamais appelée.
- **34 `window.prompt/confirm/alert`** portent les saisies critiques (montant, pays, hash TRC20, motif de
  forçage, mot de passe), sur un admin utilisé « à 70 % sur le téléphone ».
- **Textes de campagne pré-remplis** (annonce S1→S2 du 20/08, offre « last day of the month ») envoyables en
  deux clics ; `ex_s1` codé en dur dans l'API.
- **Le filtre marché 🌍/🇬🇧/🇮🇹** ne s'applique qu'à deux listes : ni queue, ni relances, ni KPI, ni audiences.

## 4. L'app membre

- **Navigation** : 5 onglets pour 8 destinations ; le bouton central s'appelle « ALGORIA AI » et mène à
  `/member/live` ; `track-record`, `add-strategy`, `recover` n'ont pas d'onglet ; la nav reste visible sur
  deux écrans-tunnels.
- **Doublons** : quatre surfaces « live » (`/app`, `/live`, `/strip`, `/member/live`) avec des filtres
  divergents ; deux academies (`/academy` redirige en dur vers la prod) ; deux track records (`/backtest`
  n'est lié de nulle part, chiffres recopiés en dur, « Generated July 2026 ») ; deux blocs parrainage avec
  deux textes de partage ; deux boutons PAUSE/RESUME ; deux compte-à-rebours identiques sur `/member/live`.
- **Trois vocabulaires de stratégies** (`🛡️ STEADY`, `🌱 Steady`, `🌱S1`, `S1 STEADY`), deux échelles de
  compte côte à côte (« $70k master account » puis track record à 1 000 $), un win rate qui n'a pas la même
  définition selon l'écran (masqué sous 75 % dans le cockpit, brut dans History, 83 % simulé dans le track
  record). **Le R n'est affiché nulle part côté membre** alors qu'il est en base et dans les types.
- **`/download`** : note 4.9, « 210+ members », « #1 AI trading » et quatre avis nominatifs inventés
  (`download/page.tsx:11-18`, `:263-267`). À retirer : c'est le genre de chose qui coûte la confiance.
- **`/join`** promet une sélection humaine « live on stream » alors que le runner approuve tout le canal
  public après 3 minutes ; `?demo=1` génère de fausses adhésions sur une page publique.
- **`Telemetry`** fabrique une marche aléatoire quand le flux est mort et reste diffusée sous « THE AI RUNS
  THIS STREAM » (`components/Telemetry.tsx:150-159`).
- **Textes périmés** : NAS100 filtré à six endroits avec trois implémentations ; « breakout » dans le tooltip
  AUTO et dans l'Academy ; trois badges « swing » pour la même idée ; README « spécialisé or » ;
  `.env.example` sans aucune des variables `NEXT_PUBLIC_*` réellement utilisées.
- **Code mort** : `RiskPicker`, `RISK_TIERS`, format `story` des win cards, `onAirBtn`, `card`, `revealAccount`.

## 5. Ordre de travail proposé

Quatre lots, chacun une ou deux PR, à valider dans cet ordre. Le premier lot rapporte le plus pour le moins
de code.

**Lot 1 — ne plus rien rater, relancer les bons (semaine 1)**
1. Alerte propriétaire en DM Telegram + push à chaque entrée en file (`connect`), déclaration de lot,
   retrait, message au bot ; un rappel quotidien « N cartes en attente, la plus vieille depuis X j » ; liens
   corrigés vers `/admin`.
2. Relances : priorité aux plus récents, cap par heure au lieu de 20 par jour, séquence étendue aux
   `pending_copier` (« ton dossier attend ceci »), langue du membre.
3. Rebrancher l'écran d'attente : après le wizard, une page de statut réel (où en est le dossier, depuis
   combien de temps, ce qui manque, la règle des 30 jours, le bouton lot d'activation).
4. Les quatre contradictions chiffrées : minimums lus depuis `minimums.ts`, S1 en maintenance retirée
   partout, FAQ alignée sur les 30 jours, sélecteur History corrigé.

**Lot 2 — le formulaire de connexion et la file admin (semaine 2)**
5. Validation avant envoi : login numérique, serveur choisi dans la liste exacte, refus des serveurs démo,
   contrôle du minimum de dépôt à l'étape 2, reprise du formulaire pré-rempli après un refus ; raisons de
   rejet normalisées (liste fermée) pour que le membre reçoive un message clair.
6. File admin : pagination, tri par âge, âge visible, lot lu depuis `members.lot`, libellés honnêtes,
   formulaires à la place des prompts natifs pour les cinq saisies critiques, une seule file de relance.

**Lot 3 — une seule app membre lisible (semaine 3)**
7. Navigation : un onglet par destination, nom du bouton central, nav masquée dans les tunnels, reprise du
   wizard là où on l'a laissé.
8. Une seule surface par concept : parrainage, pause, live, academy, track record ; un seul vocabulaire de
   stratégies ; les résultats en R et en $ à l'échelle du membre, partout la même définition.
9. i18n : le tunnel payant entièrement traduit, clés mortes supprimées.

**Lot 4 — nettoyage (semaine 4)**
10. Retirer `/download` (avis inventés), `/join?demo`, le flux simulé de `Telemetry`, les campagnes
    pré-remplies, les textes NAS100/breakout/swing, le code mort, `/api/member/auth`, `action:'risk'` ;
    README et `.env.example` à jour ; découper `app/admin/page.tsx` et l'API admin par domaine.

Ce qui demande ta décision avant que je touche : la suppression de `/download` et de `/join`, la politique
VIP (canal), et le texte des nouvelles relances.
