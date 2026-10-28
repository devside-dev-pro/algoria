-- channel_translations : verrous anti-doublon des miroirs (UK, IT, Cashflow).
-- La table était ouverte à la clé publique (anon/authenticated : SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE). Tout le code serveur l'utilise avec la clé service, qui ignore le RLS :
-- webhook Telegram, lib/channel/publish.ts, /api/channel-relink. Aucun accès côté navigateur.
-- On active le RLS sans politique et on retire les droits publics.
alter table public.channel_translations enable row level security;
revoke all on table public.channel_translations from anon, authenticated;
