-- 📣 RÉCAP DU SOIR DANS LE CANAL (02/10/2026) — voir lib/channel/recap.ts.
-- Un brouillon par jour (clé = le jour à Paris) : draft → publishing → published, ou skipped. Le passage de
-- draft à « publishing » est le verrou qui empêche une double publication (deux admins, double tap).
create table if not exists public.channel_recaps (
  day date primary key,
  kind text not null,
  text text not null,
  trades int not null default 0,
  net10 numeric,
  status text not null default 'draft',
  decided_by text,
  decided_at timestamptz,
  message_id bigint,
  report jsonb,
  created_at timestamptz not null default now()
);
alter table public.channel_recaps enable row level security;

-- DÉCLENCHEMENT : pg_cron + pg_net appellent la route à 19:15 et 20:15 UTC. Selon l'heure d'été ou d'hiver, l'un
-- des deux tombe à 21h15 à Paris ; la route refuse l'autre (contrôle d'heure). Du lundi au vendredi.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('channel-recap-1915', '15 19 * * 1-5', $$select net.http_get(url := 'https://app.algoria.tech/api/cron/channel-recap', timeout_milliseconds := 30000)$$);
select cron.schedule('channel-recap-2015', '15 20 * * 1-5', $$select net.http_get(url := 'https://app.algoria.tech/api/cron/channel-recap', timeout_milliseconds := 30000)$$);
