-- Mesure de la fenêtre 05:00–09:00 Asia/Dubai (spec perimetre_auto_5h9h.md, section 5).
-- REQUÊTE DE LECTURE. Ne pas l'appliquer en production tant que Mathieu n'a pas dit OK.
-- Pas de migration : la lancer dans le SQL editor (rôle capable de lire member_actions).
--
-- Définition, à garder identique entre la base et le suivi après une éventuelle mise en prod :
--   · messages clients (member_actions kind = biz_msg, detail.from = client) écrits entre 05:00 inclus
--     et 09:00 exclus, heure Asia/Dubai ;
--   · première réponse conversationnelle = première ligne owner après ce message dont via n'est PAS
--     un non-réponse (welcome, country_voice, intro, link, live_welcome, followup) NI le seul accusé
--     d'attente de la fenêtre (window_wait) ; ou un answered_at posé sur le message client
--     (envoi auto, vocal FAQ, draft envoyé) ;
--   · « attente seule » : un window_wait est parti, sans réponse conversationnelle ensuite ;
--   · « encore en relecture » : pas de réponse conversationnelle (la carte est chez Mathieu).
-- Délai en minutes jusqu'à la première réponse conversationnelle. Médiane et p90 sur les messages
-- qui en ont reçu une. Les messages très récents biaisent (censure) : prendre une fenêtre assez longue.

with params as (
  select timestamptz '2026-10-26 00:00:00+04' as since,
         timestamptz '2026-11-18 00:00:00+04' as until
),
not_answer(via) as (
  values ('welcome'), ('country_voice'), ('intro'), ('link'), ('live_welcome'), ('followup'), ('window_wait')
),
clients as (
  select a.id, a.tg_id, a.created_at, a.detail,
         extract(hour from (a.created_at at time zone 'Asia/Dubai'))::int as dubai_hour
  from public.member_actions a, params p
  where a.kind = 'biz_msg'
    and a.detail->>'from' = 'client'
    and a.created_at >= p.since and a.created_at < p.until
    and (a.created_at at time zone 'Asia/Dubai')::time >= time '05:00'
    and (a.created_at at time zone 'Asia/Dubai')::time <  time '09:00'
),
scored as (
  select c.id, c.created_at, c.dubai_hour, c.detail,
         c.detail->>'answered_at' as answered_at,
         c.detail->>'window_wait_at' as window_wait_at,
         c.detail->>'window_action' as window_action,
         (
           select min(o.created_at)
           from public.member_actions o
           where o.tg_id = c.tg_id and o.kind = 'biz_msg' and o.detail->>'from' = 'owner'
             and o.created_at > c.created_at
             and coalesce(o.detail->>'via', '') not in (select via from not_answer)
         ) as owner_replied_at
  from clients c
),
final as (
  select s.*,
         coalesce(s.owner_replied_at, (s.answered_at)::timestamptz) as first_conversational_at,
         (s.window_wait_at is not null or s.window_action = 'wait') as had_wait
  from scored s
)
select
  dubai_hour,
  count(*) as client_msgs,
  count(*) filter (where first_conversational_at is not null) as conversational_replies,
  round(100.0 * count(*) filter (where first_conversational_at is not null) / nullif(count(*), 0), 1) as reply_rate_pct,
  round((percentile_cont(0.5) within group (
    order by extract(epoch from (first_conversational_at - created_at)) / 60
  ) filter (where first_conversational_at is not null))::numeric, 0) as median_delay_min,
  round((percentile_cont(0.9) within group (
    order by extract(epoch from (first_conversational_at - created_at)) / 60
  ) filter (where first_conversational_at is not null))::numeric, 0) as p90_delay_min,
  count(*) filter (where first_conversational_at is null and had_wait) as wait_only,
  count(*) filter (where first_conversational_at is null) as still_in_review
from final
group by grouping sets ((dubai_hour), ())
order by dubai_hour nulls last;
