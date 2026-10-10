-- SOLDE DU MASTER JOUR PAR JOUR (10/10/2026) — pour le track record public à partir d'octobre 2026.
-- Décision Mathieu : à partir du 1er octobre, le track record montre le MASTER (le compte que les membres copient
-- via le copieur), plus le compte source. Le runner écrit le solde du master toutes les 60 s dans state_snapshots ;
-- cette fonction en tire, par jour UTC, le premier et le dernier solde vus. Une seule requête au lieu de ~1 700
-- lignes par jour à rapatrier dans la route /api/public/track.
-- Le premier solde du jour sert de base au % du jour ; l'écart entre deux bases, moins les trades clôturés, donne
-- le swap (ou un dépôt/retrait) : la table trades n'enregistre que le profit du deal, sans swap.
create or replace function public.master_day_balances(since timestamptz)
returns table (d date, b_open numeric, b_close numeric, last_ts timestamptz)
language sql stable
set search_path = public
as $$
  select (ts at time zone 'UTC')::date as d,
         (array_agg(balance order by ts asc))[1] as b_open,
         (array_agg(balance order by ts desc))[1] as b_close,
         max(ts) as last_ts
  from public.state_snapshots
  where ts >= since and balance is not null
  group by 1
  order by 1
$$;
revoke all on function public.master_day_balances(timestamptz) from public, anon, authenticated;
grant execute on function public.master_day_balances(timestamptz) to service_role;
