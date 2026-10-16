-- 🤖 LE SUPPORT EN PILOTE AUTOMATIQUE (16/10/2026, décision Mathieu) — voir lib/member/supportAuto.ts.
-- support_jobs : les envois différés sur le compte support de Mathieu (Telegram Business). L'accueil part 3 à 4 min
-- après le premier message ; une réponse part ~75 s après le DERNIER message reçu (on attend que la personne ait
-- fini d'écrire). Une ligne « pending » par conversation et par sorte : un nouveau message repousse l'échéance.
create table if not exists public.support_jobs (
  id bigserial primary key,
  tg_id bigint not null,
  conn text not null,
  kind text not null,
  due_at timestamptz not null,
  status text not null default 'pending',
  payload jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_jobs_due on public.support_jobs (status, due_at);
create index if not exists support_jobs_chat on public.support_jobs (tg_id, kind, status);
alter table public.support_jobs enable row level security;

-- support_assets : les bulles vidéo d'accueil de Mathieu, envoyées au bot en privé (file_id Telegram, valable pour
-- ce bot). Le bot alterne : la moins récemment utilisée d'abord.
create table if not exists public.support_assets (
  id bigserial primary key,
  kind text not null,
  file_id text not null,
  file_unique_id text not null unique,
  chat_id bigint,
  message_id bigint,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.support_assets enable row level security;
