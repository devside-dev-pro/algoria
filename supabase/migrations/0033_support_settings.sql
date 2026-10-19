-- 🎚 LES INTERRUPTEURS DU SUPPORT AUTOMATIQUE (19/10/2026). Jusqu'ici : variables Vercel SUPPORT_WELCOME /
-- SUPPORT_AUTOPILOT, qu'on ne peut changer qu'avec un accès Vercel et un redéploiement. Mathieu : « n'active rien tant
-- que tout n'est pas terminé » puis « je suis débordé, on termine » → il faut pouvoir allumer et couper en une ligne.
-- key : 'welcome' (accueil bulle + question du pays) · 'autopilot' (réponses envoyées seules). value : 'on' | 'off'.
-- La variable Vercel à 'off' reste un coupe-circuit qui gagne toujours.
create table if not exists public.support_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.support_settings enable row level security;
insert into public.support_settings (key, value, updated_by) values ('welcome', 'off', 'migration 0033'), ('autopilot', 'off', 'migration 0033')
on conflict (key) do nothing;
