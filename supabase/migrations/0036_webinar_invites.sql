-- 🎤 LES WEBINAIRES EN PILOTE AUTOMATIQUE (24/10/2026) — voir lib/member/webinar.ts.
-- Mathieu : « il faut un système automatique qui se répète toutes les semaines… et qu'on ne se fasse pas ban le bot à
-- spammer des milliers de gens ». Les sessions se créent seules (mercredi et dimanche, 19h UK), et le bot invite les
-- prospects le jour même, avec des règles strictes (une invitation par personne toutes les 3 semaines au plus, jamais
-- quelqu'un qui a bloqué le bot, 500 par session au plus, arrêt automatique si trop de gens bloquent le bot).

-- la campagne d'invitations d'une session est terminée (et pourquoi : tout le monde / plafond / trop de blocages)
alter table webinar_sessions add column if not exists invite_done_at timestamptz;
alter table webinar_sessions add column if not exists invite_note text;

-- une ligne par prospect invité (ou tenté) pour une session
create table if not exists webinar_invites (
  session_id text not null references webinar_sessions(id),
  tg_id bigint not null,
  sent_at timestamptz not null default now(),
  error text,              -- le refus de Telegram tel quel (« bot was blocked by the user »…)
  blocked_at timestamptz,  -- la personne a bloqué le bot APRÈS l'invitation (mesure du coupe-circuit)
  primary key (session_id, tg_id)
);
create index if not exists webinar_invites_tg_idx on webinar_invites (tg_id, sent_at);
alter table webinar_invites enable row level security;

-- Le prochain lot à inviter pour une session : les prospects (status 'onboarding'), les plus récents d'abord (les plus
-- chauds), jamais invités depuis 21 jours, jamais quelqu'un qui a bloqué le bot, pas déjà inscrits à cette session.
create or replace function webinar_invite_batch(p_session text, p_limit int)
returns table (tg_id bigint, tg_name text)
language sql stable
as $$
  select m.tg_id, m.tg_name from members m
  where m.status = 'onboarding' and m.banned_at is null
    and not exists (
      select 1 from webinar_invites i where i.tg_id = m.tg_id
        and (i.session_id = p_session or i.sent_at > now() - interval '21 days' or i.blocked_at is not null or i.error ilike '%blocked%')
    )
    and not exists (select 1 from webinar_registrations r where r.session_id = p_session and r.tg_id = m.tg_id)
  order by m.created_at desc
  limit p_limit
$$;
revoke execute on function webinar_invite_batch(text, int) from public, anon, authenticated;
grant execute on function webinar_invite_batch(text, int) to service_role;

-- les deux interrupteurs (changés par Mathieu en écrivant au bot « webinar off », « webinar invites on »…) :
-- 'webinars' = les sessions se créent seules ; 'webinar_invites' = le bot invite les prospects (coupé tant que Mathieu
-- n'a pas validé le texte et les règles)
insert into support_settings (key, value, updated_by) values ('webinars', 'on', 'migration 0036'), ('webinar_invites', 'off', 'migration 0036')
on conflict (key) do nothing;
