-- Un signal est unique PAR STRATÉGIE, pas dans l'absolu (04/08/2026).
--
-- Les trois runners (S1/S2/S3) génèrent le MÊME `ref` pour un même signal — il vaut SYMBOL-time-direction,
-- sans la stratégie — et `logSignal` fait un INSERT simple. Avec un index unique sur `ref` SEUL, le premier
-- runner qui écrivait gagnait et les deux autres perdaient leur ligne en silence : `logSignal` ne fait que
-- `console.error`, donc rien n'apparaissait ni en base ni dans les logs applicatifs.
--
-- Constaté le 03/08 : un breakout réellement OUVERT par S3 n'existait en base qu'en strategy=2, avec le
-- statut « rejected · day closed ». La table racontait le contraire de ce qui s'était passé.
--
-- Deux dégâts :
--   1. la restauration de la gestion post-entrée (runner/index.ts) cherche `signals` par (ref, strategy)
--      et ne trouvait rien pour deux runners sur trois — les paliers et le trailing restaient morts ;
--   2. toute analyse de signaux par stratégie (rejets, seuils, minRR) était bâtie sur des données amputées.
--
-- Aucun doublon (ref, strategy) ne peut exister aujourd'hui puisque l'ancien index interdisait déjà les
-- doublons de `ref` : la bascule est sans risque et ne perd aucune ligne.
alter table public.signals drop constraint if exists signals_ref_key;
drop index if exists public.signals_ref_key;
create unique index if not exists signals_ref_strategy_key on public.signals (ref, strategy);
