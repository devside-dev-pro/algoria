-- ADS STUDIO · AVIS DE MATHIEU (01/10/2026) — « cliquer sur une ad et dire : cette ad ne me convient pas, et
-- donner une raison » ; et l'inverse (« j'adore, plus comme ça »). Le but : que Claude apprenne pourquoi certaines
-- ads ne sont jamais tournées, et en propose de plus en plus qui le sont. Une ad rejetée n'est pas supprimée :
-- elle sort des listes, garde sa raison, et se restaure d'un clic. Même chose pour les hooks de la banque.
-- verdict : 'rejected' | 'loved' | null ; verdict_reasons : clés fixes (lib/admin/ads.ts) ; verdict_note : texte libre.
alter table public.ad_scripts
  add column if not exists verdict text check (verdict in ('rejected', 'loved')),
  add column if not exists verdict_reasons text[] not null default '{}',
  add column if not exists verdict_note text,
  add column if not exists verdict_at timestamptz;
alter table public.ad_hooks
  add column if not exists verdict text check (verdict in ('rejected', 'loved')),
  add column if not exists verdict_reasons text[] not null default '{}',
  add column if not exists verdict_note text,
  add column if not exists verdict_at timestamptz;
