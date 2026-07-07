// BEAST/RAFALE = du SHOW (micro-lot 0.05, brûle des frais) — jamais compté dans les stats, les annonces
// vocales ni le flux membre. Détection ROBUSTE : ticket taggé RAFALE via les signaux (fenêtre glissante)
// OU lot micro ≤ 0.05. Le tag seul fuyait : quand le BEAST spam, les vieux tickets sortent de la fenêtre
// des ~60 derniers signaux et leurs trades diluaient le win rate (93 trades comptés → tuile masquée à
// « — » malgré 25 vrais wins). Le lot, lui, est porté par CHAQUE ligne trade — aucune fenêtre.
export const SHOW_LOT_MAX = 0.05; // RAFALE_LOT du runner — toutes les vraies stratégies sont au-dessus (0.10 manuel min)

export const isShowTrade = (t: { ticket?: unknown; lot?: unknown }, rafaleTickets?: Set<string>): boolean =>
  (rafaleTickets != null && t.ticket != null && rafaleTickets.has(String(t.ticket))) ||
  (t.lot != null && Number(t.lot) > 0 && Number(t.lot) <= SHOW_LOT_MAX);
