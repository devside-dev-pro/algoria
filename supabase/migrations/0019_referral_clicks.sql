-- CLICS SUR LES LIENS DE PARRAINAGE (02/10/2026). Le panneau 🤝 REFERRALS de l'admin (onglet Affiliate) montre,
-- par parrain : liens cliqués → inscrits → activés. Sans les clics, impossible de savoir si un parrain ne
-- partage pas ou si ses amis cliquent sans s'inscrire. Écrit par /r/<code> (un clic par navigateur et par code :
-- un ami qui rouvre le lien n'est pas recompté). Aucune donnée personnelle sur le visiteur.
create table if not exists public.referral_clicks (
  id bigserial primary key,
  referrer_tg_id bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists referral_clicks_referrer_idx on public.referral_clicks (referrer_tg_id, created_at);
alter table public.referral_clicks enable row level security;
