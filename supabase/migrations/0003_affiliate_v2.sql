-- AFFILIATION 2.0 — wallet de commissions + retraits USDT TRC20 + paliers.
-- Cycle de vie d'une commission (la protection anti-abus centrale) :
--   pending   → filleul activé, la commission broker n'est PAS encore reçue → visible mais non retirable
--   confirmed → l'admin a reçu la commission broker → retirable
--   canceled  → le client a retiré son dépôt / le broker a annulé → re-débitée (balance négative possible → flag admin)
-- Balance retirable = Σ confirmed − Σ payouts (requested + paid). Tables service-role uniquement (RLS sans policy).

create table if not exists public.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  referrer_tg_id bigint not null,
  referred_tg_id bigint,                       -- null pour un bonus de palier
  kind text not null default 'referral',      -- 'referral' | 'milestone'
  amount numeric not null,
  status text not null default 'pending',     -- pending | confirmed | canceled
  reason text,                                 -- raison d'annulation
  detail jsonb not null default '{}'::jsonb,   -- referred_member_no, milestone_at, …
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);
alter table public.referral_commissions enable row level security;
create index if not exists referral_commissions_referrer_idx on public.referral_commissions (referrer_tg_id, status);

create table if not exists public.referral_payouts (
  id uuid primary key default gen_random_uuid(),
  tg_id bigint not null,
  amount numeric not null,
  address text not null,                       -- adresse USDT TRC20 au moment de la demande (audit)
  status text not null default 'requested',   -- requested | paid | rejected
  tx_hash text,                                -- preuve on-chain une fois payé
  reason text,                                 -- raison de rejet
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);
alter table public.referral_payouts enable row level security;
create index if not exists referral_payouts_tg_idx on public.referral_payouts (tg_id, status);

-- adresse de retrait du membre (une seule, modifiable — chaque payout fige l'adresse utilisée)
alter table public.members add column if not exists usdt_trc20 text;

-- REPRISE de l'ancien système (member_actions kind='referral_reward') :
-- done = déjà payé à la main → confirmed ; pending = à traiter → pending. Puis on clôt les actions
-- (la file admin ne doit plus les montrer : les commissions vivent désormais dans leur propre table).
insert into public.referral_commissions (referrer_tg_id, referred_tg_id, kind, amount, status, detail, created_at, decided_at, decided_by)
select a.tg_id, null, 'referral', coalesce((a.detail->>'amount')::numeric, 50),
       case when a.status = 'done' then 'confirmed' else 'pending' end,
       coalesce(a.detail, '{}'::jsonb), a.created_at, a.done_at, a.done_by
from public.member_actions a
where a.kind = 'referral_reward';

update public.member_actions set status = 'done', done_at = now(), done_by = 'migrated:affiliate_v2'
where kind = 'referral_reward' and status = 'pending';
