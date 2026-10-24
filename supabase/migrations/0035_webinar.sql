-- 🎤 LES WEBINAIRES (24/10/2026) — voir lib/member/webinar.ts.
-- Une ligne par webinaire (id = sa date, ex. '2026-10-28', utilisé dans le lien t.me/<bot>?start=wb_<id>), et une
-- ligne par inscrit. Le lien Zoom ne sort jamais de la base que vers les inscrits, en privé, par le bot.
create table if not exists webinar_sessions (
  id text primary key check (id ~ '^[a-z0-9-]{4,40}$'),
  starts_at timestamptz not null,
  zoom_url text,
  active boolean not null default true,
  alert_zoom_at timestamptz,   -- Mathieu prévenu : pas de lien Zoom à 3 h du début
  alert_count_at timestamptz,  -- Mathieu prévenu : le nombre d'inscrits à 1 h du début
  created_at timestamptz not null default now()
);

create table if not exists webinar_registrations (
  id bigint generated always as identity primary key,
  session_id text not null references webinar_sessions(id),
  tg_id bigint not null,
  name text,
  username text,
  created_at timestamptz not null default now(),
  reminded_24h_at timestamptz,
  reminded_1h_at timestamptz,
  reminded_live_at timestamptz,
  unique (session_id, tg_id)
);

-- lues et écrites seulement par le serveur (clé de service)
alter table webinar_sessions enable row level security;
alter table webinar_registrations enable row level security;

-- Les rappels, toutes les 5 min. À APPLIQUER APRÈS LE DÉPLOIEMENT de la route /api/cron/webinar :
-- select cron.schedule('webinar-reminders-5min', '*/5 * * * *', $$select net.http_get(url := 'https://app.getalgoria.com/api/cron/webinar', timeout_milliseconds := 60000)$$);
