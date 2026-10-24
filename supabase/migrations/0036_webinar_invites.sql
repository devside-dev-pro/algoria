-- 🎤 L'INVITATION DES PROSPECTS AU WEBINAIRE PAR LE BOT (24/10/2026) — voir lib/member/webinar.ts (runWebinarInvites).
-- Rien ne part tant que invite_at est vide : c'est Mathieu qui donne le feu vert (date et heure d'envoi).
alter table webinar_sessions add column if not exists invite_at timestamptz;       -- à partir de quand le bot invite
alter table webinar_sessions add column if not exists invite_done_at timestamptz;  -- tout le monde a été invité (Mathieu prévenu)

-- une ligne par prospect invité (ou tenté) : jamais deux invitations pour la même session
create table if not exists webinar_invites (
  session_id text not null references webinar_sessions(id),
  tg_id bigint not null,
  sent_at timestamptz not null default now(),
  error text,                                -- le refus de Telegram tel quel (« bot was blocked by the user »…)
  primary key (session_id, tg_id)
);
alter table webinar_invites enable row level security;

-- Le prochain lot à inviter : les prospects (status 'onboarding'), les plus récents d'abord (les plus chauds), ni déjà
-- invités ni déjà inscrits à cette session.
create or replace function webinar_invite_batch(p_session text, p_limit int)
returns table (tg_id bigint, tg_name text)
language sql stable
as $$
  select m.tg_id, m.tg_name from members m
  where m.status = 'onboarding' and m.banned_at is null
    and not exists (select 1 from webinar_invites i where i.session_id = p_session and i.tg_id = m.tg_id)
    and not exists (select 1 from webinar_registrations r where r.session_id = p_session and r.tg_id = m.tg_id)
  order by m.created_at desc
  limit p_limit
$$;
revoke execute on function webinar_invite_batch(text, int) from public, anon, authenticated;
grant execute on function webinar_invite_batch(text, int) to service_role;
