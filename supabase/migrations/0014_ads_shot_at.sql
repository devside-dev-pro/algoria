-- ADS STUDIO · DATE DE TOURNAGE (01/10/2026) — Mathieu : « un endroit où on peut passer une ad de à tourner à
-- tournée, que je refasse pas les mêmes ». La vue SHOOT LIST range les ads en « à tourner » / « déjà tournées »
-- et affiche le jour du tournage. shot_at est posé par l'API au premier passage en shot / edited / live, et
-- effacé si l'ad revient en idée ou en « à tourner ». Colonne additive : rien d'existant ne change.
alter table public.ad_scripts add column if not exists shot_at timestamptz;
