-- 🤖 Le passage des envois différés du support, chaque minute (voir app/api/cron/support-jobs/route.ts).
-- À APPLIQUER APRÈS LE DÉPLOIEMENT de la route.
select cron.schedule('support-jobs-1min', '* * * * *', $$select net.http_get(url := 'https://app.algoria.tech/api/cron/support-jobs', timeout_milliseconds := 60000)$$);
