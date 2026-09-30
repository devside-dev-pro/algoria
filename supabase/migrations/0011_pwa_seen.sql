-- PWA (30/09/2026) — savoir combien de membres ont VRAIMENT installé l'app. Jusqu'ici aucune mesure : on
-- devinait à partir des abonnements push (fiables sur iPhone, où le push exige l'app installée, mais pas sur
-- Android, où Chrome accepte le push dans un simple onglet).
-- L'app, ouverte en plein écran (display-mode standalone = lancée depuis l'icône), le signale une fois par
-- jour via /api/member/pwa : dernière ouverture installée + plateforme.
alter table public.members add column if not exists pwa_seen_at timestamptz;
alter table public.members add column if not exists pwa_platform text;
