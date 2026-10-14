-- 📣 LE CM AUTOMATIQUE DU CANAL PUBLIC (15/10/2026, décision Mathieu) — voir lib/channel/cm.ts.
-- Une ligne par post prévu : chaque matin le bot prépare les posts du jour (How it works, CTA, cartes de gain) et
-- les envoie aux admins ; rien ne part sans un clic. draft → approved → publishing → published, ou skipped / expired.
-- (day, slot) est unique : un second passage le même jour ne recrée rien.
create table if not exists public.channel_posts (
  id bigserial primary key,
  day date not null,
  slot text not null,
  kind text not null,
  ref text,
  text text,
  button_text text,
  button_url text,
  photo_url text,
  scheduled_at timestamptz not null,
  status text not null default 'draft',
  decided_by text,
  decided_at timestamptz,
  message_id bigint,
  report jsonb,
  created_at timestamptz not null default now(),
  unique (day, slot)
);
create index if not exists channel_posts_due on public.channel_posts (status, scheduled_at);
alter table public.channel_posts enable row level security;
