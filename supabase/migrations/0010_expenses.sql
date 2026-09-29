-- COMPTA (30/09/2026) — les dépenses d'Algoria (pubs, abonnements, outils…), saisies par Mathieu dans l'onglet
-- COMPTA de l'admin. Les revenus, eux, existent déjà (member_actions kind='deposit' : commissions broker et
-- accès directs ; referral_payouts : parrainage payé). Sans les dépenses, pas de bénéfice net.
-- Lecture / écriture uniquement par le serveur (service role) : RLS activé, aucune policy.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  amount_usd numeric not null check (amount_usd > 0),
  category text not null,
  note text,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists expenses_spent_on_idx on public.expenses (spent_on desc);
alter table public.expenses enable row level security;
