-- ADS STUDIO · GÉNÉRATEUR (01/10/2026) — chaque appel à Claude (✨ Generate, 🧠 mise à jour de la mémoire) est
-- journalisé : paramètres, modèle, tokens, coût en $. Sert au plafond quotidien et au « coût du mois » affiché
-- dans l'admin (la génération tourne sur la clé API de Mathieu, pas sur son abonnement).
-- ad_scripts.batch_id : le lot d'où vient une ad générée (pour le badge 🆕 et pour mesurer ce qui est gardé).
-- Lecture / écriture uniquement par le serveur (service role) : RLS activé, aucune policy.
create table if not exists public.ad_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'generate' check (kind in ('generate', 'memory')),
  params jsonb not null default '{}',
  model text,
  n_ads int not null default 0,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  cost_usd numeric,
  error text,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists ad_batches_created_idx on public.ad_batches (created_at desc);
alter table public.ad_batches enable row level security;
alter table public.ad_scripts add column if not exists batch_id uuid references public.ad_batches (id) on delete set null;
