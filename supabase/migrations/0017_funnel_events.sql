-- ENTONNOIR D'INSCRIPTION (01/10/2026) — 74 % des inscrits ne choisissent jamais de broker, 20 % s'arrêtent avant
-- d'envoyer leurs identifiants MT5 ; on sait QU'ILS s'arrêtent, pas OÙ ni POURQUOI. Une ligne par écran vu / geste
-- clé du parcours (ouvert, broker choisi, lien broker ouvert, formulaire MT5 vu, envoyé…), écrite par l'app membre,
-- sans rien bloquer (envoi « fire and forget »). Lue par le panneau FUNNEL de l'admin. Aucune donnée sensible :
-- pas d'identifiant MT5, pas de mot de passe, pas de montant.
-- Lecture / écriture uniquement par le serveur (service role) : RLS activé, aucune policy.
create table if not exists public.funnel_events (
  id bigserial primary key,
  tg_id bigint not null,
  event text not null,
  step int,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists funnel_events_tg_idx on public.funnel_events (tg_id, created_at);
create index if not exists funnel_events_event_idx on public.funnel_events (event, created_at);
alter table public.funnel_events enable row level security;
