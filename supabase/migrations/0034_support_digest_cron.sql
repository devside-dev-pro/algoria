-- 🌙 Le récap du soir du support (voir app/api/cron/support-digest/route.ts) : 19 h et 20 h UTC, la route n'envoie
-- qu'au passage qui tombe à 21 h à Paris (19 h UTC en heure d'été, 20 h UTC en hiver).
-- À APPLIQUER APRÈS LE DÉPLOIEMENT de la route.
select cron.schedule('support-digest-21h-paris', '0 19,20 * * *', $$select net.http_get(url := 'https://app.algoria.tech/api/cron/support-digest', timeout_milliseconds := 60000)$$);
