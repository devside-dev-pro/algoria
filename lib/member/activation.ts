// RÈGLE D'ACTIVATION — le volume qu'un membre doit avoir tradé pour que sa commission soit validée par le
// broker, et la fenêtre pendant laquelle il ne doit pas retirer. Source de vérité UNIQUE, partagée par
// l'app membre, l'API et l'admin. Client-safe : aucune dépendance serveur, aucun secret.
//
// ── POURQUOI CE FICHIER EXISTE (25/08/2026) ────────────────────────────────────────────────────────────
// Au 25/08 : $21 950 de commissions en attente sur 49 dépôts, dont $17 150 (78 %) invalidables faute de
// volume tradé. $3 700 étaient DÉJÀ perdus. La cause n'était pas le sérieux de l'équipe — c'était qu'aucun
// champ, nulle part dans le système, n'enregistrait « lots validés ». Une règle qui ne vit que dans la tête
// de quelqu'un se perd. Elle vit désormais ici, et le code la fait respecter.
//
// ── CE QU'ON NE PEUT PAS FAIRE, ET IL FAUT LE SAVOIR ───────────────────────────────────────────────────
// On ne peut PAS vérifier ce volume automatiquement. L'API Partner de STH n'expose que connect / join /
// status / disconnect — ni volume, ni historique de deals — et on n'a aucune API vers les dashboards
// partenaires des brokers. Le pointage reste HUMAIN. Ce que le code apporte n'est donc pas l'automatisation
// du contrôle, c'est l'IMPOSSIBILITÉ DE L'OUBLIER : sans validation enregistrée, le copieur ne se branche
// pas. Toute la valeur est là, et elle ne tient qu'à ça.
// USDJPY et non l'or : le spread XAUUSD coûte au membre sur 1 lot aller-retour, une paire JPY presque rien (décision 03/09).
export const ACTIVATION_SYMBOL = 'USDJPY';

/** Les deux jambes demandées au membre. 0.5 à l'achat + 0.5 à la vente = 1 lot de volume, exposition nette
 *  NULLE : le membre ne prend aucun risque de marché et ne peut pas perdre d'argent en le faisant. C'est ce
 *  qui rend la demande acceptable — et c'est l'argument à garder dans tous les textes membres. */
export const ACTIVATION_LEGS: Array<{ side: 'BUY' | 'SELL'; lots: number }> = [
  { side: 'BUY', lots: 0.5 },
  { side: 'SELL', lots: 0.5 },
];

/** Volume total exigé, en lots. Dérivé des jambes : changer ACTIVATION_LEGS suffit, rien à tenir à jour. */
export const ACTIVATION_LOTS = ACTIVATION_LEGS.reduce((n, l) => n + l.lots, 0);

/** Jours pendant lesquels un retrait fait perdre la commission — donc l'accès. À DIRE AVANT LE DÉPÔT, pas
 *  après : un membre qui apprend la règle une fois son argent placé la vit comme un piège, et il a raison. */
export const WITHDRAW_LOCK_DAYS = 30;

/** Date à laquelle l'accès du membre devient définitivement acquis. null si la date de dépôt est absente
 *  ou illisible — on ne fabrique JAMAIS une échéance à partir d'une donnée manquante, elle finirait
 *  affichée au membre comme une promesse. */
export function lockUntil(depositedAt: string | Date | null | undefined): Date | null {
  if (depositedAt == null) return null;
  const t = depositedAt instanceof Date ? depositedAt.getTime() : Date.parse(String(depositedAt));
  if (!Number.isFinite(t)) return null;
  return new Date(t + WITHDRAW_LOCK_DAYS * 86_400_000);
}

/** Jours restants avant que l'accès soit acquis. 0 = acquis. null = date de dépôt inconnue. */
export function lockDaysLeft(depositedAt: string | Date | null | undefined, now: number = Date.now()): number | null {
  const until = lockUntil(depositedAt);
  if (!until) return null;
  return Math.max(0, Math.ceil((until.getTime() - now) / 86_400_000));
}

// ── ÉTAT DE VALIDATION PORTÉ PAR LA CARTE CONNECT ──────────────────────────────────────────────────────
// Trois champs, écrits dans `member_actions.detail` de la carte 'connect' :
//   · lots_claimed_at  — le membre DÉCLARE avoir tradé (bouton dans l'app). Ne prouve RIEN.
//   · lots_ok          — un humain a POINTÉ le dashboard partenaire et confirmé le volume. Seul champ qui
//                        débloque le copieur.
//   · lots_override    — motif écrit d'un passage en force. Rend l'exception VISIBLE au lieu de silencieuse ;
//                        sans motif obligatoire, un bouton « forcer » redevient le comportement par défaut.
export type LotsState = {
  claimedAt: string | null;
  ok: boolean;
  okBy: string | null;
  okAt: string | null;
  lots: number | null;
  override: string | null;
};

export function lotsStateOf(detail: Record<string, unknown> | null | undefined): LotsState {
  const d = detail ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const n = Number(d.lots_traded);
  return {
    claimedAt: str(d.lots_claimed_at),
    ok: d.lots_ok === true,
    okBy: str(d.lots_ok_by),
    okAt: str(d.lots_ok_at),
    lots: Number.isFinite(n) && n > 0 ? n : null,
    override: str(d.lots_override),
  };
}

/** LE VERROU. true = le copieur a le droit de se brancher. Un override motivé passe, un override vide non. */
export const lotsCleared = (detail: Record<string, unknown> | null | undefined): boolean => {
  const s = lotsStateOf(detail);
  return s.ok || s.override != null;
};
