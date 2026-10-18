-- 🧯 PLUS JAMAIS UN TRADE EN DOUBLE (18/10/2026). Le Monero ouvert le 22/09 (ticket 52370468) avait été enregistré
-- DEUX FOIS à l'ouverture par l'observateur de copie (runner/observer.ts : une lecture des tickets ouverts en erreur
-- rendait « aucun ticket connu »), puis la clôture du 18/10 a fermé les deux lignes d'un coup → deux gains de
-- +1 494 $ (à 1 lot) dans l'app, le bilan et les notifications. Rien en base n'empêchait le doublon.
--
-- ATTENTION AUX FERMETURES EN PLUSIEURS FOIS : un même ticket peut légitimement avoir plusieurs lignes FERMÉES
-- (ticket 51306458 : 0,25 lot fermé à −1 006,75 $ le 17/09, puis 0,75 lot à +199,43 $ le 18/09). D'où deux index
-- partiels : un seul trade OUVERT par ticket, et pas deux clôtures identiques (même ticket, même instant).
--
-- Appliqué en base le 18/10 en deux temps : sauvegarde + retrait du doublon et index (strategy, ticket) strict ;
-- le remplacement du strict par les deux partiels ci-dessous attend l'accord de Mathieu (suppression d'index).
-- La perte du 17/09 a été remise sous le ticket « 51306458-p1 » (l'index strict refusait le même ticket).
create table if not exists public.trades_duplicates_removed (like public.trades including defaults);
alter table public.trades_duplicates_removed add column if not exists removed_at timestamptz not null default now();
alter table public.trades_duplicates_removed enable row level security;

drop index if exists public.trades_strategy_ticket_uniq;
create unique index if not exists trades_open_ticket_uniq on public.trades (strategy, ticket) where closed_at is null;
create unique index if not exists trades_close_uniq on public.trades (strategy, ticket, closed_at) where closed_at is not null;
