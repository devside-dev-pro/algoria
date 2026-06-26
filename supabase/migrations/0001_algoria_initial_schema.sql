-- Algoria AI — schéma initial (appliqué via MCP le 2026-06-26).
-- Le runner écrit via la clé service (bypass RLS). Le cockpit lit via Realtime en tant qu'authenticated.

-- 1. events : flux du terminal ALGORIA AI
create table public.events (
  id     bigint generated always as identity primary key,
  ts     timestamptz not null default now(),
  symbol text not null default 'XAUUSD',
  level  text not null check (level in ('scan','info','signal','order','veto')),
  msg    text not null,
  data   jsonb
);
create index events_ts_idx on public.events (ts desc);

-- 2. signals
create table public.signals (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  created_at    timestamptz not null default now(),
  symbol        text not null default 'XAUUSD',
  direction     text not null check (direction in ('long','short')),
  mode          text not null,
  confidence    numeric not null,
  entry         numeric not null,
  stop_loss     numeric not null,
  take_profits  numeric[] not null,
  risk_reward   numeric,
  lot           numeric not null,
  rationale     jsonb,
  confluence    jsonb,
  ticket        text,
  result_code   text,
  status        text not null default 'sent'
);
create index signals_created_idx on public.signals (created_at desc);

-- 3. state_snapshots
create table public.state_snapshots (
  id              bigint generated always as identity primary key,
  ts              timestamptz not null default now(),
  symbol          text not null default 'XAUUSD',
  session         text, regime text,
  balance         numeric, equity numeric, day_pnl numeric,
  open_positions  int, open_risk_pct numeric,
  atr             numeric, atr_percentile numeric, adx numeric,
  spread          numeric, tradable boolean, mode text, killed boolean
);
create index state_ts_idx on public.state_snapshots (ts desc);

-- 4. trades
create table public.trades (
  id          uuid primary key default gen_random_uuid(),
  signal_ref  text, ticket text,
  symbol      text not null default 'XAUUSD',
  direction   text, opened_at timestamptz, closed_at timestamptz,
  entry       numeric, exit numeric, lot numeric,
  pnl         numeric, r numeric, reason text
);
create index trades_closed_idx on public.trades (closed_at desc);

-- 5. commands : cockpit -> runner
create table public.commands (
  id        bigint generated always as identity primary key,
  ts        timestamptz not null default now(),
  type      text not null check (type in ('set_mode','start','stop','kill','flatten')),
  payload   jsonb,
  consumed  boolean not null default false
);
create index commands_unconsumed_idx on public.commands (ts) where not consumed;

-- RLS
alter table public.events          enable row level security;
alter table public.signals         enable row level security;
alter table public.state_snapshots enable row level security;
alter table public.trades          enable row level security;
alter table public.commands        enable row level security;

create policy "auth read events"     on public.events          for select to authenticated using (true);
create policy "auth read signals"    on public.signals         for select to authenticated using (true);
create policy "auth read state"      on public.state_snapshots for select to authenticated using (true);
create policy "auth read trades"     on public.trades          for select to authenticated using (true);
create policy "auth read commands"   on public.commands        for select to authenticated using (true);
create policy "auth insert commands" on public.commands        for insert to authenticated with check (true);

-- Realtime
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.signals;
alter publication supabase_realtime add table public.state_snapshots;
alter publication supabase_realtime add table public.trades;
alter publication supabase_realtime add table public.commands;
