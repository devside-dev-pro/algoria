// ENTONNOIR D'INSCRIPTION (01/10/2026) — ce que l'app membre mesure, écran par écran, pour savoir OÙ les inscrits
// s'arrêtent (74 % ne choisissent jamais de broker, 20 % n'envoient jamais leurs identifiants MT5). Table
// funnel_events (migration 0017). Aucune donnée sensible : jamais d'identifiant, de mot de passe ni de montant.
// L'envoi ne bloque jamais rien : sendBeacon (survit à la fermeture de l'onglet), sinon fetch keepalive, et
// toute erreur est ignorée. Une mesure perdue vaut mieux qu'un écran qui rame.
export const FUNNEL_EVENTS = [
  'home_view',          // l'accueil prospect (accès non activé) est affiché
  'unlock_open',        // « ⚡ UNLOCK MY ACCESS » sur l'accueil : la feuille explicative s'ouvre
  'unlock_cta',         // le bouton de la feuille qui mène au parcours
  'ob_view',            // un écran du parcours est affiché (step = 0 broker, 1 MT5, 2 confirmation)
  'ob_budget',          // tranche de budget choisie (écran broker)
  'ob_broker_link',     // lien d'ouverture de compte chez un broker cliqué
  'ob_others',          // « autres brokers » déplié
  'ob_bonus_shown',     // popup bonus affichée (45 s sans choix de broker)
  'ob_bonus_click',     // lien broker cliqué depuis la popup bonus
  'ob_broker_confirm',  // « j'ai mon compte » : passage à l'écran MT5
  'ob_origin',          // compte neuf ou existant (écran MT5)
  'ob_mt5_click',       // identifiants MT5 envoyés (bouton cliqué)
  'ob_error',           // le serveur a refusé un envoi (message court, jamais de donnée saisie)
  'ob_strategy_done',   // dernier écran validé : demande envoyée
  'ob_back',            // retour à un écran précédent
  'ob_leave',           // onglet quitté / caché pendant le parcours, avec le temps passé sur l'écran
  'ob_help',            // 🆘 « je bloque » envoyé (meta.topic)
  'share_open',         // 📤 feuille « partager ce gain » ouverte (meta.ticket)
  'share_done',         // 📤 partage lancé (meta.channel : image | whatsapp | telegram | copy)
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
type Meta = Record<string, string | number | boolean | null>;

const sentOnce = new Set<string>();

/** Envoie une mesure, sans jamais bloquer ni lever d'erreur. Côté navigateur uniquement. */
export function track(event: FunnelEvent, step: number | null = null, meta: Meta = {}): void {
  try {
    if (typeof window === 'undefined') return;
    const body = JSON.stringify({ event, step, meta });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/member/track', new Blob([body], { type: 'application/json' }))) return;
    void fetch('/api/member/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* mesure perdue : sans importance */ }
}

/** Une seule fois par chargement de page pour cette clé (un écran ré-affiché par un re-rendu ne compte pas double). */
export function trackOnce(key: string, event: FunnelEvent, step: number | null = null, meta: Meta = {}): void {
  if (sentOnce.has(key)) return;
  sentOnce.add(key);
  track(event, step, meta);
}

/** 🆘 « Je bloque » : les sujets proposés au membre. Clés fixes (comptées dans le panneau FUNNEL) ; libellé
 *  français pour l'alerte de Mathieu, les libellés membre sont dans ui-text (help.t.<clé>). */
export const HELP_TOPICS = {
  open_account: 'ouvrir le compte broker',
  verify: 'vérification d’identité (KYC)',
  deposit: 'faire le dépôt',
  credentials: 'trouver ses identifiants MT5',
  refused: 'l’app refuse ses identifiants',
  other: 'autre',
} as const;
export type HelpTopic = keyof typeof HELP_TOPICS;
