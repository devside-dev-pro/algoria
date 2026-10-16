-- 🎥 La bibliothèque des bulles d'accueil (16/10/2026, Mathieu : « comment il va savoir quelle bulle envoyer à quel
-- moment ? »). Chaque bulle a un public et une langue, choisis avec les boutons sous la bulle (lib/member/supportAuto.ts).
-- situation : 'new' (pas encore l'app) · 'app' (déjà dans l'app) · 'all' (tout le monde, la bulle de secours).
alter table public.support_assets add column if not exists situation text not null default 'all';
alter table public.support_assets add column if not exists lang text not null default 'en';
alter table public.support_assets add column if not exists uses integer not null default 0;
