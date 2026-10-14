-- 📣 LE CM AUTOMATIQUE : un passage toutes les 5 minutes (voir app/api/cron/channel-posts/route.ts). Le passage
-- prépare le plan du jour à partir de 8h30 (Paris) et publie ce qui a été validé et dont l'heure est venue.
-- Sans secret, comme le récap : la route ne publie que ce qu'un admin a validé.
-- À APPLIQUER APRÈS LE DÉPLOIEMENT de la route.
select cron.schedule('channel-posts-5min', '*/5 * * * *', $$select net.http_get(url := 'https://app.algoria.tech/api/cron/channel-posts', timeout_milliseconds := 60000)$$);
