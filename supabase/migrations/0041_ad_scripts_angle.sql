-- ADS STUDIO · ANGLE DU SCRIPT (09/11/2026) — colonne additive pour mémoriser l'angle imposé
-- par le générateur (proof, time, beginner…). Aucun DROP. À appliquer manuellement ; le code
-- stocke déjà l'angle dans ad_hooks.angle et dans ad_scripts.notes (« Angle: … ») en attendant.
alter table public.ad_scripts add column if not exists angle text;
