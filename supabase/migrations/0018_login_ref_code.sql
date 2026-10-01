-- PARRAINAGE QUI NE SE PERD PLUS (02/10/2026). Le code du parrain (cookie alg_ref posé par /r/<code>) est
-- recopié sur le code de connexion AU MOMENT où le navigateur le crée. La connexion peut ensuite se terminer
-- ailleurs (bouton du bot ouvert dans le navigateur intégré de Telegram, autre onglet) : le parrain voyage
-- avec le code, côté serveur, au lieu de dépendre du cookie du navigateur qui termine la connexion.
alter table public.member_login_codes add column if not exists ref_code text;
