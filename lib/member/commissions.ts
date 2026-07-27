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

export const BROKER_COMMISSIONS: Record<string, CommissionTier[]> = {
  // format : raisefx: [{ min: 500, usd: 650 }] → tout dépôt ≥ 500$ chez RaiseFX rapporte 650$.
  // multi-paliers : [{ min: 200, usd: 300 }, { min: 1000, usd: 650 }] → 200-999$ = 300$, ≥ 1000$ = 650$.
  raisefx: [],
  vtmarkets: [],
  puprime: [],
  fxcess: [],
  tradingsphere: [],
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
