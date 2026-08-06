// Barème des commissions broker (CPA au dépôt) — par broker partenaire, par palier de dépôt.
// Sert au PRÉ-REMPLISSAGE du champ « expected com $ » du registre DEPOSITS (admin) : la valeur
// proposée reste éditable ligne par ligne, et le statut received/lost fait foi — le barème est
// une estimation, jamais la vérité comptable.
// Montants fixes négociés avec chaque partenaire (fournis par Mathieu). Si un partenaire
// revalorise (volume de dépôts ↑), mettre à jour ICI — pas de table en base : mêmes raisons que
// BROKERS (une seule source, versionnée, zéro migration).
// Palier = « dépôt ≥ min → commission usd » ; on retient le palier LE PLUS HAUT atteint.
// [] = barème pas encore communiqué → aucun pré-remplissage (champ vide, saisie manuelle).
// NB : importé par la page admin donc présent dans son bundle client — n'y mettre que des
// montants, jamais d'identifiants partenaires ou de liens privés.

export type CommissionTier = { min: number; usd: number };

// Barèmes communiqués par Mathieu le 27/07/2026, TradingSphere revalorisé le 06/08/2026
// (tranches contiguës → paliers min croissants). Repères à jour :
//   • seul RaiseFX commissionne dès 100$ ;
//   • 200-499  : VT Markets et TradingSphere en tête (400$) ;
//   • 500-999  : RaiseFX, VT et TradingSphere à égalité (700$) ;
//   • 1000-2999: VT Markets devant (1100$) ;
//   • 3000-3999: PU Prime devant (1200$) ;
//   • ≥ 4000   : TradingSphere écrase le marché (1800$) — c'est LE lien des gros dépôts.
export const BROKER_COMMISSIONS: Record<string, CommissionTier[]> = {
  raisefx: [
    { min: 100, usd: 100 },
    { min: 200, usd: 350 },
    { min: 500, usd: 700 },
    { min: 1000, usd: 1000 },
  ],
  vtmarkets: [
    { min: 200, usd: 400 },
    { min: 500, usd: 700 },
    { min: 1000, usd: 1100 },
  ],
  puprime: [
    { min: 200, usd: 300 },
    { min: 500, usd: 650 },
    { min: 1000, usd: 950 },
    { min: 3000, usd: 1200 },
  ],
  fxcess: [
    { min: 200, usd: 300 },
    { min: 500, usd: 600 },
    { min: 1000, usd: 800 },
  ],
  // REVALORISÉ le 06/08/2026 (nouveau deal) : 300/650/800 → 400/700/900, plus un 4ᵉ palier à 4000$.
  // Ce que ça change en pratique : TradingSphere rejoint la tête à 200-499$ (400, à égalité avec VT) et
  // à 500-999$ (700, à égalité avec RaiseFX et VT) ; il reste derrière entre 1000 et 3999$ (900 contre
  // 1100 chez VT) ; mais à partir de 4000$ il écrase tout — 1800$ quand le meilleur suivant plafonne à
  // 1200$ (PU Prime). C'est désormais LE lien à envoyer sur un gros dépôt.
  tradingsphere: [
    { min: 200, usd: 400 },
    { min: 500, usd: 700 },
    { min: 1000, usd: 900 },
    { min: 4000, usd: 1800 },
  ],
};

// Commission estimée pour un dépôt chez un broker — null si barème inconnu (broker legacy,
// barème vide) ou palier minimum non atteint : null = on ne pré-remplit pas.
export function estimateCommission(brokerKey: string | null | undefined, amountUsd: number): number | null {
  const tiers = brokerKey ? BROKER_COMMISSIONS[brokerKey] : undefined;
  if (!tiers?.length || !Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  let best: number | null = null;
  for (const t of [...tiers].sort((a, b) => a.min - b.min)) if (amountUsd >= t.min) best = t.usd;
  return best;
}

// Classement des brokers par commission décroissante pour un budget donné — l'aide à la vente :
// « il veut mettre X $, quel lien lui envoyer ? ». Les brokers hors barème ou sous leur palier
// minimum sont écartés (rien à gagner) ; `exclude` = brokers où le prospect a DÉJÀ un compte
// (compte principal + multi-stratégies), à écarter aussi. Égalité de commission → l'ordre de
// déclaration du barème tranche (tri stable, RaiseFX déclaré en premier : notre broker).
export function rankBrokersByCommission(amountUsd: number, exclude?: Iterable<string>): { key: string; usd: number }[] {
  const out: { key: string; usd: number }[] = [];
  const skip = new Set(exclude ?? []);
  for (const key of Object.keys(BROKER_COMMISSIONS)) {
    if (skip.has(key)) continue;
    const usd = estimateCommission(key, amountUsd);
    if (usd != null) out.push({ key, usd });
  }
  return out.sort((a, b) => b.usd - a.usd);
}
