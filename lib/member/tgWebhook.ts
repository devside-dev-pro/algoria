// Les updates que le webhook UNIQUE du bot (/api/telegram) doit recevoir — une seule liste, partagée par le
// bouton ENABLE INBOX de l'admin, sa remise à niveau automatique et /api/tg-repair (qui avait sa propre copie,
// restée sans callback_query : une réparation aurait coupé les boutons « Envoyer la réponse »).
//   callback_query (03/09)       : boutons sous les brouillons.
//   business_* (29/09/2026)      : Telegram Business — brouillons pour le compte support de Mathieu.
export const TG_ALLOWED_UPDATES = [
  'chat_join_request', 'chat_member', 'message', 'channel_post', 'my_chat_member', 'callback_query',
  'business_connection', 'business_message',
];
