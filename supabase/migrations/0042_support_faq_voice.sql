-- 🎙 LA BANQUE DE VOCAUX FAQ (10/11/2026, validé par Mathieu) — voir lib/member/faqVoice.ts et lib/member/supportAuto.ts.
-- MIGRATION ADDITIVE : aucune table, colonne ou contrainte supprimée ou modifiée.
--
-- support_assets.kind : 'welcome_video' | 'country_voice' | 'faq_voice' (nouveau). Vérifié en lecture le 10/11/2026 :
-- il n'existe AUCUNE contrainte CHECK sur kind (seulement la clé primaire et l'unicité de file_unique_id), donc
-- 'faq_voice' est déjà accepté tel quel ; rien à relâcher. Pour un vocal FAQ, situation = l'identifiant du thème
-- ('faq_deposit', 'faq_broker'…), lang = 'en'. Tant que le thème n'est pas choisi, situation = 'all' : il ne part chez personne.

-- 1. Un seul vocal FAQ ACTIF par thème. Le code désactive l'ancien (active = false, jamais supprimé) avant d'activer le
--    nouveau. Aucun vocal FAQ n'existe encore en base : l'index se crée sans conflit.
create unique index if not exists support_assets_faq_topic_active
  on public.support_assets (situation)
  where kind = 'faq_voice' and active and situation like 'faq\_%';

-- 2. L'anti-spam (pas deux fois le même thème à la même personne en 30 jours) et la mesure lisent ces lignes.
create index if not exists member_actions_faq_voice
  on public.member_actions (tg_id, created_at)
  where kind = 'biz_msg' and detail->>'via' = 'faq_voice';

-- 3. LA MESURE (lecture seule) : connexion et dépôt à 7 jours après un vocal FAQ, comparés aux réponses en TEXTE SEUL
--    sur le même thème.
--    · bras « voice » : member_actions biz_msg via = 'faq_voice' (detail.topic, detail.asset_id), date d'envoi ;
--    · bras « text »  : le message du client où le thème a été reconnu avec une confiance haute (detail.faq_topic),
--      répondu (detail.answered_at) sans vocal ; les couples (personne, thème) qui ont eu le vocal en sont exclus.
--    Une exposition par personne, thème et bras (la première). Seules les personnes PAS encore connectées avant
--    l'exposition comptent (un membre déjà en copie qui demande « pas encore de trades » fausserait la connexion).
--    Taux sur les expositions de plus de 7 jours (mature). Biais : ce n'est pas un tirage au hasard.
create or replace function public.support_faq_voice_stats(since timestamptz default '2026-11-10')
returns table (topic text, arm text, people bigint, mature bigint, connect_7d bigint, deposit_7d bigint)
language sql stable security invoker as $$
  with voice as (
    select tg_id, detail->>'topic' as topic, min(created_at) as at
    from public.member_actions
    where kind = 'biz_msg' and detail->>'via' = 'faq_voice' and created_at >= since and detail->>'topic' is not null
    group by 1, 2
  ),
  text_only as (
    select a.tg_id, a.detail->>'faq_topic' as topic, min((a.detail->>'answered_at')::timestamptz) as at
    from public.member_actions a
    where a.kind = 'biz_msg' and a.detail->>'from' = 'client' and a.created_at >= since
      and a.detail->>'faq_topic' is not null and a.detail->>'answered_at' is not null
      and coalesce(a.detail->>'faq_arm', '') <> 'voice'
      and not exists (select 1 from voice v where v.tg_id = a.tg_id and v.topic = a.detail->>'faq_topic')
    group by 1, 2
  ),
  expo as (
    select tg_id, topic, at, 'voice'::text as arm from voice
    union all
    select tg_id, topic, at, 'text'::text from text_only
  ),
  prospects as (
    select e.* from expo e
    where not exists (
      select 1 from public.member_actions c
      where c.tg_id = e.tg_id and c.kind = 'connect' and c.status = 'done' and coalesce(c.done_at, c.created_at) < e.at
    )
  )
  select p.topic, p.arm,
    count(*) as people,
    count(*) filter (where p.at <= now() - interval '7 days') as mature,
    count(*) filter (where p.at <= now() - interval '7 days' and exists (
      select 1 from public.member_actions c where c.tg_id = p.tg_id and c.kind = 'connect' and c.status = 'done'
        and coalesce(c.done_at, c.created_at) between p.at and p.at + interval '7 days')) as connect_7d,
    count(*) filter (where p.at <= now() - interval '7 days' and exists (
      select 1 from public.member_actions d where d.tg_id = p.tg_id and d.kind = 'deposit' and d.status = 'done'
        and coalesce(d.done_at, d.created_at) between p.at and p.at + interval '7 days')) as deposit_7d
  from prospects p
  group by 1, 2
  order by 1, 2;
$$;
revoke all on function public.support_faq_voice_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.support_faq_voice_stats(timestamptz) to service_role;
