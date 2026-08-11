-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- FAMILLE « ÉCART À LA MOYENNE » — candidat de décorrélation, testé le 10/08/2026
--
-- L'IDÉE : le scalp de confluence joue les REJETS de niveaux. Cette famille joue autre chose — quand
-- le prix s'écarte de sa moyenne mobile de plus de K×ATR, on parie sur le retour vers la moyenne.
-- Deux générateurs différents ⇒ candidat sérieux pour la décorrélation cherchée depuis le 24/07
-- (voir le commentaire regimeGate dans lib/engine/strategies.ts : « la VRAIE décorrélation demandera
-- une famille de signaux différente »). La corrélation avec le scalp reste À MESURER.
--
-- LE DÉCLENCHEUR EST UN FRANCHISSEMENT, pas un état : on n'entre que sur la bougie où la condition
-- DEVIENT vraie. Sans ça, la condition reste vraie des dizaines de bougies d'affilée et le compte de
-- signaux explose (3 313 au lieu de ~800 sur M5).
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- RÉSULTATS (nets de spread, slippage et commission — voir sql/README.md pour la méthode)
--
-- Réglage : K = 2,0 · stop = 1,5 × ATR14 · moyenne = SMA50 · sortie = BE 0.10/0.05 + paliers
--           0.18→0.12, 0.28→0.20, 0.38→0.30 + trailing 0.30/0.18 · TP 1,0R
--
-- M5, 60 jours de bourse (juin, juillet, 8 j d'août 2026) — la fenêtre de RÉGLAGE :
--   728 trades · +0,0952R · 83,8 % de verts · 108 stops pleins (15 %)
--   juin +0,112R (325 tr) · juillet +0,107R (308 tr) · août −0,038R (88 tr) ← août NÉGATIF
--   Voisinage testé, tout positif : K1,5/SL1,2 +0,081 · K2,0/SL1,2 +0,095 · K2,5/SL1,2 +0,106
--
-- H1, 22 mois — les mêmes paramètres appliqués TELS QUELS, donc hors-échantillon sur les 6 premiers
-- trimestres (2024-Q4 → 2026-Q1, ~350 trades sans aucun réglage dessus) :
--   516 trades · +0,1237R · 86,2 % de verts · 71 stops pleins (13,8 %)
--   HUIT trimestres sur HUIT positifs : +0,043 · +0,105 · +0,089 · +0,168 · +0,115 · +0,147 · +0,187 · +0,105
--   Symétrie : achats 251 tr +0,133R (deux moitiés +) · ventes 265 tr +0,115R (deux moitiés +)
--   → l'edge n'est PAS un pari déguisé sur l'or haussier, les deux sens paient.
--
-- POUR COMPARER : le scalp de confluence en production, même gestion de sortie, vaut +0,0676R BRUT
-- sur 853 signaux réels. Cette famille fait mieux, coûts déduits.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- CE QUI N'EST PAS DÉMONTRÉ — à lire avant d'en faire quoi que ce soit
--
-- 1. Elle n'a JAMAIS tradé un dollar réel. Un backtest donne un candidat, pas une preuve.
-- 2. TENSION DE CADENCE : la version validée sur 22 mois est H1, soit ~1 trade/jour — ce n'est PAS le
--    profil « beaucoup de volume » demandé. La version rapide (M5, ~9 trades/jour) n'a que 60 jours
--    de données, et son mois d'août est négatif. On ne peut pas encore avoir les deux.
-- 3. Corrélation avec le scalp existant : NON MESURÉE. Tant qu'elle l'est pas, rien ne dit qu'elle
--    apporte de la décorrélation plutôt qu'un doublon coûteux.
-- 4. Un seul instrument (XAUUSD), pas de filtre news, pas de filtre de session, pas de cap journalier.
-- 5. Le slippage sur stop en marché rapide est pire que modélisé.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- USAGE : régler SYMBOLE / TIMEFRAME / HORIZON ci-dessous, puis les combinaisons dans la CTE p(...).
--   HORIZON = nombre de bougies laissées au trade pour se résoudre. M5 → 288 (~1 jour) · H1 → 120 (~5 j).
--   Toujours vérifier le taux de trades NON RÉSOLUS avant de lire les résultats (requête en pied).

with recursive b as (
  select time, open::float8 o, high::float8 h, low::float8 l, close::float8 c,
         row_number() over (order by time) i, lag(close::float8) over (order by time) pc
  from candles
  where symbol = 'XAUUSD' and timeframe = 'H1'          -- ← SYMBOLE / TIMEFRAME
),
tr as (select *, greatest(h - l, abs(h - coalesce(pc, c)), abs(l - coalesce(pc, c))) t from b),
ind as (
  select time, i, o, h, l, c,
         avg(t) over (order by i rows between 13 preceding and current row) atr,   -- ATR14
         avg(c) over (order by i rows between 49 preceding and current row) sma,   -- SMA50
         count(*) over (order by i rows between 49 preceding and current row) nn
  from tr
),
lagged as (
  select ind.*, lag(c) over (order by i) pc2, lag(sma) over (order by i) psma,
         lag(atr) over (order by i) patr,
         lead(o) over (order by i) nexto,     -- entrée à l'open de i+1 : jamais de lookahead
         lead(time) over (order by i) nextt
  from ind
),
-- une ligne par combinaison à tester (elles tournent en parallèle) : k = écart en ATR, m = stop en ATR
p(k, m, tag) as (values (2.0, 1.5, 'K2.0 SL1.5')),
sig as (
  select p.tag, l.i, l.nextt t_entry,
         case when l.c < l.sma - p.k * l.atr then 1 else -1 end dir,
         -- coût d'ENTRÉE : demi-spread + slippage, toujours contre nous
         l.nexto + case when l.c < l.sma - p.k * l.atr then 1 else -1 end * 0.15 entry,
         l.atr * p.m rd
  from lagged l cross join p
  where l.nn = 50 and l.atr > 0 and l.nexto is not null
    -- FRANCHISSEMENT : vrai maintenant, faux à la bougie précédente
    and ( (l.c < l.sma - p.k * l.atr and not (l.pc2 < l.psma - p.k * l.patr))
       or (l.c > l.sma + p.k * l.atr and not (l.pc2 > l.psma + p.k * l.patr)) )
),
fwd as (
  select s.tag, s.i, s.t_entry, s.rd, s.dir, ind.i fi,
         s.dir * (case when s.dir = 1 then ind.l else ind.h end - s.entry) / s.rd adv, -- excursion défavorable
         s.dir * (case when s.dir = 1 then ind.h else ind.l end - s.entry) / s.rd fav, -- excursion favorable
         row_number() over (partition by s.tag, s.i order by ind.i) rn
  from sig s join ind on ind.i > s.i and ind.i <= s.i + 120                -- ← HORIZON
),
path as (
  select tag, i, t_entry, rd, dir, fi, rn, adv, fav,
         -- pic atteint AVANT cette bougie : c'est lui qui arme BE/paliers/trailing (causal)
         greatest(coalesce(max(fav) over (partition by tag, i order by rn
                                          rows between unbounded preceding and 1 preceding), 0), 0) fp
  from fwd
),
ex0 as (
  select tag, i, t_entry, rd, dir, fi, rn, adv, fav,
         -- stop voulu = max(stop initial, BE, paliers, trailing) — miroir de manage.ts:61-67
         greatest(-1.0,
           case when fp >= 0.10 then 0.05 else -1.0 end,      -- breakeven armé à 0.10R, verrou +0.05R
           case when fp >= 0.18 then 0.12 else -1.0 end,      -- palier 1
           case when fp >= 0.28 then 0.20 else -1.0 end,      -- palier 2
           case when fp >= 0.38 then 0.30 else -1.0 end,      -- palier 3
           case when fp >= 0.30 then fp - 0.18 else -1.0 end) sr  -- trailing
  from path
),
ex as (
  -- première bougie qui touche le stop OU le TP ; stop testé EN PREMIER (pessimiste)
  select distinct on (tag, i) tag, i, t_entry, dir, fi xi,
         (case when adv <= sr then sr else 1.0 end)
           - (0.15 / rd + 7.0 / (rd * 100)) rr   -- coût de SORTIE + commission, en R
  from ex0 where adv <= sr or fav >= 1.0 order by tag, i, rn
),
-- UNE POSITION À LA FOIS : sélection gloutonne, on saute tout signal ouvert avant la sortie du précédent
pick as (
  select e.* from ex e where e.i = (select min(i) from ex e2 where e2.tag = e.tag)
  union all
  select n.* from pick p2 cross join lateral (
    select e.* from ex e where e.tag = p2.tag and e.i > p2.xi order by e.i limit 1
  ) n
)
select tag,
       count(*) trades,
       round(avg(rr)::numeric, 4) esp_R_net,
       round(sum(rr)::numeric, 1) total_R,
       round(100.0 * count(*) filter (where rr > 0) / count(*), 1) pct_vert,
       round(avg(rr) filter (where rr > 0)::numeric, 3) gain_moy_R,
       count(*) filter (where rr <= -0.9) stops_pleins,
       count(*) filter (where rr > 0 and rr < 0.10) miettes,
       round(avg(rr) filter (where to_timestamp(t_entry / 1000) <  '2025-11-01')::numeric, 4) moitie1,
       round(avg(rr) filter (where to_timestamp(t_entry / 1000) >= '2025-11-01')::numeric, 4) moitie2
from pick group by tag order by tag;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- CONTRÔLE OBLIGATOIRE — trades non résolus dans l'horizon. Ils sont écartés silencieusement par la
-- CTE `ex` (aucune ligne ne satisfait la condition), ce qui BIAISE le résultat sans prévenir.
-- Remplacer le SELECT final par celui-ci pour le mesurer ; il doit ressortir à 0 (ou quasi).
--
--   select count(*) filter (where not resolu) non_resolus, count(*) total
--   from (select i, bool_or(adv <= -1.0 or fav >= 1.0) resolu from fwd group by i) r;
--
-- Relevé du 10/08/2026 sur M5 : 0 non résolu sur 799 signaux (horizon 288 bougies).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
