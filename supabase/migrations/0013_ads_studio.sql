-- ADS STUDIO (01/10/2026) — la bibliothèque d'ads de Mathieu, dans l'admin. Demande : « une sorte de bibliothèque
-- d'ads avec un stock d'ads, là où je peux stocker tous mes scripts, idées etc. » et « si je suis en manque de
-- hooks je vais dans ma banque de hooks ». Avant : des scripts éparpillés (PDF de Benjamin, fichiers, WhatsApp).
-- ad_scripts : une fiche par ad (pôle, hook, déroulé, besoins, statut idée → à tourner → tournée → montée → en ligne).
-- ad_hooks   : la banque de hooks (de rechange ou isolés), avec leur statut de test.
-- seed_key : identifie les fiches de la bibliothèque de départ, pour que l'import ne crée jamais de doublon.
-- Lecture / écriture uniquement par le serveur (service role) : RLS activé, aucune policy.
create table if not exists public.ad_scripts (
  id uuid primary key default gen_random_uuid(),
  pole text not null check (pole in ('street', 'scene', 'acting', 'ugly', 'broll', 'other')),
  title text not null,
  hook text,
  body text,
  prep text,
  needs text[] not null default '{}',
  duration text,
  status text not null default 'idea' check (status in ('idea', 'to_shoot', 'shot', 'edited', 'live')),
  source text,
  notes text,
  meta_flag text,
  seed_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);
create index if not exists ad_scripts_pole_idx on public.ad_scripts (pole, created_at);
alter table public.ad_scripts enable row level security;

create table if not exists public.ad_hooks (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  angle text,
  status text not null default 'untested' check (status in ('untested', 'testing', 'winner', 'loser')),
  script_id uuid references public.ad_scripts (id) on delete set null,
  notes text,
  seed_key text unique,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists ad_hooks_script_idx on public.ad_hooks (script_id);
alter table public.ad_hooks enable row level security;
