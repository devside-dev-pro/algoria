-- HISTORIQUE RÉEL DU COMPTE SOURCE (24/09/2026) — la future page « track record » façon Myfxbook.
--
-- Algoria 2.0 copie un compte source. Plutôt qu'un backtest, on publiera son VRAI historique, lu en lecture
-- seule (mot de passe investisseur, saisi côté MetaApi — il ne passe jamais par le code ni par la base).
--
-- On stocke les DEALS BRUTS, pas des trades reconstruits : c'est la matière première, fidèle au terminal.
-- Les lignes de solde (dépôts, retraits) sont gardées avec leur type : elles expliquent la courbe et
-- doivent être exclues du calcul de performance, jamais confondues avec un trade.
--
-- RLS activée, AUCUNE politique : seules les routes serveur (clé service) y lisent.

create table if not exists public.source_deals (
  id           text primary key,          -- id du deal chez le broker
  time         timestamptz not null,
  type         text not null,             -- DEAL_TYPE_BUY / SELL / BALANCE / …
  entry_type   text,                      -- DEAL_ENTRY_IN / OUT / INOUT
  position_id  text,
  symbol       text,
  volume       numeric,
  price        numeric,
  profit       numeric,
  commission   numeric,
  swap         numeric,
  reason       text,
  synced_at    timestamptz not null default now()
);
create index if not exists source_deals_time_idx on public.source_deals (time);
create index if not exists source_deals_position_idx on public.source_deals (position_id);
alter table public.source_deals enable row level security;

-- l'état du compte au dernier passage : solde, equity, devise — de quoi dater et vérifier la courbe
create table if not exists public.source_account (
  id             text primary key,        -- id MetaApi
  name           text,
  server         text,
  currency       text,
  leverage       numeric,
  balance        numeric,
  equity         numeric,
  deals          integer,
  first_deal_at  timestamptz,
  last_deal_at   timestamptz,
  updated_at     timestamptz not null default now()
);
alter table public.source_account enable row level security;
