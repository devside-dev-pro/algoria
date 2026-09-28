-- LE CERVEAU D'ALGORIA AI (29/09/2026) — les documents que lit l'agent (bot Telegram, puis l'orbe de l'app),
-- modifiables par Mathieu dans l'admin sans redéploiement. `knowledge` = ce qu'il sait (écrit par Mathieu) ;
-- d'autres clés viendront (`memory`, leçons tirées des corrections). Chaque enregistrement garde une version.
-- Accès : service role uniquement (RLS activée, aucune policy) — lu et écrit par les routes serveur.
create table if not exists public.agent_docs (
  key text primary key,
  content text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists public.agent_doc_versions (
  id bigserial primary key,
  key text not null,
  content text not null,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists agent_doc_versions_key_created on public.agent_doc_versions (key, created_at desc);
alter table public.agent_docs enable row level security;
alter table public.agent_doc_versions enable row level security;
