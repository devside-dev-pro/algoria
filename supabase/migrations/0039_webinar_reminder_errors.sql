-- 🎤 LES RAPPELS DU WEBINAIRE GARDENT LEUR RÉSULTAT (28/10/2026) — voir lib/member/webinar.ts (runWebinarReminders).
-- Le 28/10, rappel d'1 h : 181 envois réussis sur 193 inscrits, 12 échecs muets (marqués « rappelés » avant l'envoi,
-- résultat de Telegram jeté, aucune reprise, impossible de savoir qui). Ces colonnes gardent le résultat :
--   · last_reminder_error / last_reminder_error_at : le dernier refus de Telegram, préfixé par le rappel (« 1h: »,
--     « live: »), tel quel (« Forbidden: bot was blocked by the user », « Too Many Requests… », « timeout »…) ;
--   · unreachable_at : refus définitif (bot bloqué, compte supprimé, chat introuvable) ; plus de rappel ensuite. Remis
--     à null quand la personne redémarre le bot (nouvelle inscription) ;
--   · reminder_retries : reprises déjà faites pour le rappel en cours après une erreur passagère (429, 5xx, réseau) ;
--     null = aucune. 2 au plus (REMINDER_MAX_RETRIES).
-- ADDITIVE SEULEMENT : colonnes nullables, aucune donnée réécrite, rien de supprimé. La RLS de la table (activée en
-- 0035, sans politique : clé de service seulement) couvre les nouvelles colonnes, rien à ajouter.
-- Le code fonctionne avec ou sans cette migration (il sonde les colonnes) ; sans elle, pas de reprise ni de suivi.
-- À APPLIQUER AVANT LA FUSION, hors live.
alter table webinar_registrations add column if not exists last_reminder_error text;
alter table webinar_registrations add column if not exists last_reminder_error_at timestamptz;
alter table webinar_registrations add column if not exists unreachable_at timestamptz;
alter table webinar_registrations add column if not exists reminder_retries smallint;
