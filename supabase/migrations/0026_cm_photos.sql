-- 📸 LA BANQUE DE PHOTOS DU BONJOUR DU MATIN (15/10/2026) — voir lib/channel/cm.ts.
-- Mathieu envoie ses photos au bot en privé ; chacune est gardée ici par son file_id Telegram (valable pour ce bot,
-- sans rien télécharger ni stocker ailleurs). Le CM prend chaque matin la moins récemment utilisée.
create table if not exists public.cm_photos (
  id bigserial primary key,
  file_id text not null,
  file_unique_id text not null unique,
  chat_id bigint,
  message_id bigint,
  media_group_id text,
  added_by text,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.cm_photos enable row level security;
