-- ═══ L'AGRÉGAT REVIENT DANS SQL (17/09/2026) ══════════════════════════════════════════════════════
-- Chaque chargement de l'admin lisait ~8 100 lignes, dont 5 145 servaient UNIQUEMENT à produire une
-- vingtaine de lignes d'agrégat et deux dates par membre. Et les trois plus grosses grossissent avec
-- l'activité : une ligne dans telegram_joins par clic de pub (4 712), ~200 relances par jour.
-- Compter, c'est le travail de la base. Ces vues rendent le résultat, pas la matière première.
-- Mesuré après création : 5 145 lignes lues → 879.
--
-- security_invoker = on : une vue s'exécute par défaut avec les droits de son PROPRIÉTAIRE, ce qui
-- contournerait la RLS des tables sources (toutes deux protégées). Avec l'invocateur, la RLS s'applique
-- normalement. Les révocations qui suivent sont la seconde ceinture : PostgREST expose les vues du schéma
-- public, et ces lignes contiennent des identifiants Telegram.

-- ① SOURCES DES DEMANDES D'ADHÉSION — 3 000 lignes lues → 13.
-- ⚠️ CHANGEMENT DE PÉRIMÈTRE ASSUMÉ : l'ancien code agrégeait les 1 000 demandes les PLUS RÉCENTES sur
-- 4 712 en base. Le panneau annonçait « par source » sans dire qu'il tronquait — les campagnes anciennes
-- étaient sous-comptées en silence. La vue couvre tout, donc les chiffres MONTENT : c'est la correction
-- d'une troncature, pas une inflation.
create or replace view admin_join_sources
with (security_invoker = on) as
select
  coalesce(nullif(btrim(invite_name), ''), '(lien direct / inconnu)') as source,
  count(*)::int                                        as n,
  count(*) filter (where status = 'accepted')::int     as accepted,
  count(*) filter (where dm_status = 'sent')::int      as dm_sent,
  count(*) filter (where dm_status = 'failed')::int    as dm_failed,
  max(joined_at)                                       as last
from telegram_joins
group by 1;

-- ② LES CANAUX CONNUS PAR LES DEMANDES — 2 000 lignes lues pour en extraire 4 identifiants.
create or replace view admin_join_chats
with (security_invoker = on) as
select distinct chat_id
from telegram_joins
where chat_id is not null;

-- ③ DERNIER CONTACT PAR MEMBRE — 2 145 lignes lues pour n'en garder que deux dates par personne :
-- le dernier contact HUMAIN et le dernier passage de la relance automatique. Seule cette distinction
-- compte (un passage du bot ne doit pas masquer quelqu'un de la file), donc on ne renvoie qu'elle.
-- Fenêtre de 15 jours : identique à l'ancienne requête, elle couvre les cooldowns de 3 à 14 jours.
-- `done_by` est réduit à 'auto' / 'human' — c'est le seul test que fait l'écran.
create or replace view admin_nudge_last
with (security_invoker = on) as
select
  tg_id,
  case when done_by = 'auto' then 'auto' else 'human' end as done_by,
  max(created_at) as created_at
from member_actions
where kind = 'nudge'
  and status = 'done'
  and created_at >= now() - interval '15 days'
group by tg_id, (done_by = 'auto');

revoke all on admin_join_sources, admin_join_chats, admin_nudge_last from anon, authenticated;
grant select on admin_join_sources, admin_join_chats, admin_nudge_last to service_role;
