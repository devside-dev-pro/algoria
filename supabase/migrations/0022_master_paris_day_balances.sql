-- SOLDE DU MASTER PAR JOUR DE PARIS (14/10/2026) — voir lib/display/tradingDay.ts.
-- Une seule horloge pour tout Algoria : la journée de trading est celle de Paris (minuit → minuit), qui colle à la
-- séance de l'or. Même calcul que master_day_balances (0021), coupé à minuit à Paris au lieu de minuit UTC.
-- Fonction à part (0021 reste) : la route déjà déployée continue d'appeler l'ancienne jusqu'au déploiement.
create or replace function public.master_paris_day_balances(since timestamptz)
returns table (d date, b_open numeric, b_close numeric, last_ts timestamptz)
language sql stable
set search_path = public
as $$
  select (ts at time zone 'Europe/Paris')::date as d,
         (array_agg(balance order by ts asc))[1] as b_open,
         (array_agg(balance order by ts desc))[1] as b_close,
         max(ts) as last_ts
  from public.state_snapshots
  where ts >= since and balance is not null
  group by 1
  order by 1
$$;
revoke all on function public.master_paris_day_balances(timestamptz) from public, anon, authenticated;
grant execute on function public.master_paris_day_balances(timestamptz) to service_role;
