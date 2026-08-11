-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- BANC D'ESSAI DES FAMILLES D'ENTRÉE — XAUUSD, une seule requête, toutes les familles comparées
--
-- ⚠️ RÉSULTAT PRINCIPAL AU 10/08/2026 : AUCUNE des six familles testées ne bat des entrées
-- ARBITRAIRES. Le problème d'Algoria est à l'ENTRÉE, et il n'est pas résolu. Ce fichier sert à ne
-- pas refaire les mêmes tests en croyant les découvrir, et à ne pas refaire la même erreur.
--
-- HISTORIQUE À NE PAS EFFACER : la première version de ce banc donnait ces six familles GAGNANTES,
-- toutes autour de 84 % de trades verts, dont « SMA stretch » à +0,124R sur 22 mois avec huit
-- trimestres positifs et une symétrie achat/vente parfaite. Tout était un artefact de simulation
-- (remplissage au niveau du stop malgré un gap d'ouverture — voir sql/README.md). Le contrôle par
-- entrées arbitraires l'a démasqué : il « gagnait » +0,114R avec 88 % de verts.
-- LEÇON : un résultat qui coche toutes les cases de robustesse peut être entièrement faux si le
-- moteur d'exécution est faux. Le témoin aléatoire passe AVANT toute lecture de résultat.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- RÉSULTATS APRÈS CORRECTIF (M5, 60 jours de bourse, coûts déduits, même gestion de sortie) :
--
--   Famille                                        espérance    % verts
--   SMA stretch (> 2 ATR de la SMA50)               −0,0285R     53,3 %
--   Momentum (bougie > 1,8 ATR, clôture extrême)    −0,0344R     51,0 %
--   Stochastique extrême (< 0,08 / > 0,92)          −0,0489R     54,3 %
--   Donchian 20 (cassure)                           −0,0533R     49,3 %
--   VWAP fade (excès > 1,5 ATR du VWAP)             −0,0570R     51,5 %
--   VWAP rebond (retour au-dessus du VWAP)          −0,0935R     47,6 %
--   ─────────────────────────────────────────────────────────────────
--   TÉMOIN ALÉATOIRE                                −0,027 à −0,103R  ~50 %
--
-- Le scalp de confluence EN PRODUCTION, mesuré sur 865 signaux réels avec le harnais corrigé :
--   gestion d'avant le 10/08 (be 0.15, trail .60/.35)     +0,0130R · 153 stops · 380 miettes · 71,8 % verts
--   après #290 (be 0.10, trail .45/.25)                   +0,0121R · 129 stops · 344 miettes · 70,2 % verts
--   après #292 (be 0.10 + paliers + trail .30/.18)        +0,0098R · 129 stops · 197 miettes · 70,2 % verts
-- Lecture honnête : les changements du 10/08 réduisent les STOPS PLEINS (153→129) et surtout les
-- MIETTES (380→197, le reproche « mes gains font 1,15$ »), au prix d'un peu d'espérance (−0,003R,
-- soit dans le bruit). Ils n'ont PAS amélioré l'espérance comme annoncé avant correctif.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- USAGE : régler SYMBOLE / TIMEFRAME / HORIZON. Ajouter une famille = ajouter un bloc UNION ALL
-- dans la CTE `sig`. TOUJOURS garder les trois lignes ALÉATOIRE : elles sont le témoin.
--   HORIZON : M5 → 200-288 bougies · H1 → 120. Vérifier le taux de non-résolus (requête en pied).

with b as (
  select time, open::float8 o, high::float8 h, low::float8 l, close::float8 c, volume::float8 v,
         row_number() over (order by time) i, lag(close::float8) over (order by time) pc,
         (to_timestamp(time/1000)::date) d
  from candles where symbol='XAUUSD' and timeframe='M5'              -- ← SYMBOLE / TIMEFRAME
),
tr as (select *, greatest(h-l, abs(h-coalesce(pc,c)), abs(l-coalesce(pc,c))) t, (h+l+c)/3 tp from b),
ind as (
  select time, i, d, o, h, l, c, tp,
         avg(t) over (order by i rows between 13 preceding and current row) atr,          -- ATR14
         avg(c) over (order by i rows between 49 preceding and current row) sma,          -- SMA50
         sum(tp*greatest(v,1)) over (partition by d order by i)
           / nullif(sum(greatest(v,1)) over (partition by d order by i),0) vwap,          -- VWAP du jour
         max(h) over (order by i rows between 20 preceding and 1 preceding) hh20,
         min(l) over (order by i rows between 20 preceding and 1 preceding) ll20,
         max(h) over (order by i rows between 13 preceding and current row) hh14,
         min(l) over (order by i rows between 13 preceding and current row) ll14,
         count(*) over (order by i rows between 49 preceding and current row) nn,
         row_number() over (partition by d order by i) bj                                  -- bougie du jour
  from tr
),
x as (
  select ind.*, lag(c) over (order by i) c1, lag(vwap) over (order by i) vw1,
         lag(atr) over (order by i) atr1, lag(sma) over (order by i) sma1,
         lead(o) over (order by i) nexto,          -- entrée à l'open de i+1 : jamais de lookahead
         lead(time) over (order by i) nextt,
         (c - ll14)/nullif(hh14-ll14,0) stoch
  from ind
),
sig as (
  -- ═══ TÉMOIN — NE JAMAIS RETIRER. Doit ressortir NÉGATIF (~−0,03 à −0,10R, ~50 % verts). ═══
  select 'Z ALÉATOIRE long 1/40' fam, i, nextt t_entry, 1 dir from x where nn=50 and atr>0 and nexto is not null and i % 40 = 0
  union all select 'Z ALÉATOIRE short 1/40', i, nextt, -1 from x where nn=50 and atr>0 and nexto is not null and i % 40 = 7
  union all select 'Z ALÉATOIRE alterné', i, nextt, case when (i/25) % 2 = 0 then 1 else -1 end from x where nn=50 and atr>0 and nexto is not null and i % 25 = 3
  -- ═══ FAMILLES ═══ (déclencheur sur FRANCHISSEMENT, pas sur état : sinon le signal se répète des
  --     dizaines de bougies d'affilée et le compte explose — 3 313 au lieu de ~800 sur F3)
  union all select 'F1 VWAP fade', i, nextt, -1 from x where nn=50 and atr>0 and nexto is not null and bj>12 and c > vwap + 1.5*atr and not (c1 > vw1 + 1.5*atr1)
  union all select 'F1 VWAP fade', i, nextt,  1 from x where nn=50 and atr>0 and nexto is not null and bj>12 and c < vwap - 1.5*atr and not (c1 < vw1 - 1.5*atr1)
  union all select 'F2 VWAP rebond', i, nextt,  1 from x where nn=50 and atr>0 and nexto is not null and bj>12 and c1 < vw1 and c > vwap and c > sma
  union all select 'F2 VWAP rebond', i, nextt, -1 from x where nn=50 and atr>0 and nexto is not null and bj>12 and c1 > vw1 and c < vwap and c < sma
  union all select 'F3 SMA stretch', i, nextt,  1 from x where nn=50 and atr>0 and nexto is not null and c < sma - 2.0*atr and not (c1 < sma1 - 2.0*atr1)
  union all select 'F3 SMA stretch', i, nextt, -1 from x where nn=50 and atr>0 and nexto is not null and c > sma + 2.0*atr and not (c1 > sma1 + 2.0*atr1)
  union all select 'F4 Momentum', i, nextt,  1 from x where nn=50 and atr>0 and nexto is not null and h-l > 1.8*atr and c > l + 0.75*(h-l)
  union all select 'F4 Momentum', i, nextt, -1 from x where nn=50 and atr>0 and nexto is not null and h-l > 1.8*atr and c < l + 0.25*(h-l)
  union all select 'F5 Donchian 20', i, nextt,  1 from x where nn=50 and atr>0 and nexto is not null and c > hh20 and not (c1 > hh20)
  union all select 'F5 Donchian 20', i, nextt, -1 from x where nn=50 and atr>0 and nexto is not null and c < ll20 and not (c1 < ll20)
  union all select 'F6 Stoch extrême', i, nextt,  1 from x where nn=50 and atr>0 and nexto is not null and stoch < 0.08
  union all select 'F6 Stoch extrême', i, nextt, -1 from x where nn=50 and atr>0 and nexto is not null and stoch > 0.92
),
tra as (
  select s.fam, s.i, s.t_entry, s.dir,
         x.nexto + s.dir*0.15 entry,      -- coût d'ENTRÉE : demi-spread + slippage, contre nous
         x.atr*1.5 rd                     -- stop initial = 1,5 × ATR14
  from sig s join x on x.i = s.i
),
fwd as (
  select t.fam, t.i, t.t_entry, t.rd, ind.i fi,
         t.dir*(case when t.dir=1 then ind.l else ind.h end - t.entry)/t.rd adv,  -- excursion défavorable
         t.dir*(case when t.dir=1 then ind.h else ind.l end - t.entry)/t.rd fav,  -- excursion favorable
         t.dir*(ind.o - t.entry)/t.rd opn,                                        -- OUVERTURE (le correctif)
         row_number() over (partition by t.fam, t.i order by ind.i) rn
  from tra t join ind on ind.i > t.i and ind.i <= t.i + 200                        -- ← HORIZON
),
path as (
  select fam, i, t_entry, rd, rn, adv, fav, opn,
         -- pic atteint AVANT cette bougie : c'est lui qui arme BE/paliers/trailing (causal)
         greatest(coalesce(max(fav) over (partition by fam, i order by rn
                                          rows between unbounded preceding and 1 preceding),0),0) fp
  from fwd
),
ex0 as (
  select fam, i, t_entry, rd, rn, adv, fav, opn,
         -- miroir de manage.ts:61-67 — max(stop initial, BE, paliers, trailing)
         greatest(-1.0, case when fp>=0.10 then 0.05 else -1.0 end,
                        case when fp>=0.18 then 0.12 else -1.0 end,
                        case when fp>=0.28 then 0.20 else -1.0 end,
                        case when fp>=0.38 then 0.30 else -1.0 end,
                        case when fp>=0.30 then fp-0.18 else -1.0 end) sr
  from path
),
ex as (
  -- ⚠️ LE CORRECTIF DU 10/08 : `least(sr, opn)`. Si la bougie OUVRE au-delà du stop, on est rempli à
  -- l'OUVERTURE, pas au niveau du stop. Sans ça, la simulation invente des gagnants et TOUTE famille
  -- ressort à ~84 % de verts, y compris des entrées tirées au hasard. Symétrique sur le TP :
  -- `greatest(1.0, opn)` — un gap FAVORABLE au-delà du TP est un vrai bonus, lui.
  select distinct on (fam, i) fam, i, t_entry,
         (case when adv <= sr then least(sr, opn) else greatest(1.0, opn) end)
           - (0.15/rd + 7.0/(rd*100)) rr        -- coût de SORTIE + commission, en R
  from ex0 where adv <= sr or fav >= 1.0 order by fam, i, rn
)
select fam, count(*) signaux,
       round(avg(rr)::numeric,4) esp_R_net,
       round(100.0*count(*) filter (where rr>0)/count(*),1) pct_vert,
       count(*) filter (where rr <= -0.9) stops_pleins,
       count(*) filter (where rr > 0 and rr < 0.10) miettes,
       round(avg(rr) filter (where to_timestamp(t_entry/1000) <  '2026-07-06')::numeric,4) moitie1,
       round(avg(rr) filter (where to_timestamp(t_entry/1000) >= '2026-07-06')::numeric,4) moitie2
from ex group by fam order by esp_R_net desc;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- CONTRÔLE — trades non résolus dans l'horizon. Écartés silencieusement par la CTE `ex` (aucune ligne
-- ne satisfait la condition), ils biaisent le résultat sans prévenir. Doit ressortir à 0 ou quasi.
--
--   select count(*) filter (where not resolu) non_resolus, count(*) total
--   from (select i, bool_or(adv <= -1.0 or fav >= 1.0) resolu from fwd group by i) r;
--
-- Relevé du 10/08/2026 sur M5 : 0 non résolu sur 799 signaux (horizon 288 bougies).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
