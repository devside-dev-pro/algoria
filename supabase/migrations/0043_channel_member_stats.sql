-- 📊 MESURE DU CANAL PUBLIC (10/11/2026, refonte du CM) — voir lib/channel/members.ts.
-- Additive uniquement (deux tables neuves, rien de modifié ni supprimé). Fichier seul : à appliquer par Mathieu.
--
-- channel_member_events : chaque entrée / sortie de membre reçue par le webhook existant (update chat_member, déjà dans
-- allowed_updates : lib/member/tgWebhook.ts). Le webhook n'est ni ré-enregistré ni modifié.
create table if not exists public.channel_member_events (
  id bigserial primary key,
  chat_id bigint not null,
  user_id bigint,
  old_status text,
  new_status text,
  invite_name text,
  at timestamptz not null default now()
);
create index if not exists channel_member_events_chat_at on public.channel_member_events (chat_id, at);
alter table public.channel_member_events enable row level security;

-- channel_member_stats : une photo par jour (Paris) et par canal : le nombre de membres (getChatMemberCount) et les
-- entrées / départs comptés depuis channel_member_events.
create table if not exists public.channel_member_stats (
  day date not null,
  chat_id bigint not null,
  label text,
  members integer,
  joins integer not null default 0,
  leaves integer not null default 0,
  captured_at timestamptz not null default now(),
  primary key (day, chat_id)
);
alter table public.channel_member_stats enable row level security;
