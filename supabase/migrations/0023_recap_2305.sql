-- 📣 LE RÉCAP DU CANAL PASSE À 23H05, HEURE DE PARIS (14/10/2026, décision Mathieu) — voir lib/display/tradingDay.ts.
-- À 21h15 il ratait la dernière heure de séance : le DAILY WRAP du VIP (23h Paris) et le récap annonçaient deux
-- chiffres différents pour la même journée. 23h05 tombe après la fermeture de l'or : mêmes trades des deux côtés.
-- 21:05 UTC = 23h05 l'été, 22:05 UTC = 23h05 l'hiver ; la route refuse l'appel qui tombe à 22h05 ou 00h05.
-- À APPLIQUER APRÈS LE DÉPLOIEMENT de la route qui attend 23h : avant, elle refuserait les deux appels.
select cron.unschedule('channel-recap-1915');
select cron.unschedule('channel-recap-2015');
select cron.schedule('channel-recap-2105', '5 21 * * 1-5', $$select net.http_get(url := 'https://app.algoria.tech/api/cron/channel-recap', timeout_milliseconds := 30000)$$);
select cron.schedule('channel-recap-2205', '5 22 * * 1-5', $$select net.http_get(url := 'https://app.algoria.tech/api/cron/channel-recap', timeout_milliseconds := 30000)$$);
