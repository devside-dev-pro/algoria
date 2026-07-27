// Ordre de PRÉSENTATION des brokers selon le budget annoncé — le tunnel « unlock my access » :
// on demande d'abord au prospect combien il compte investir, puis on met en avant le partenaire
// le plus rémunérateur pour cette tranche (barème admin : lib/member/commissions.ts).
// ⚠️ FICHIER CLIENT-SAFE : il part dans le bundle membre → UNIQUEMENT des ordres de présentation,
// JAMAIS les montants de commission (le barème reste dans le bundle admin). Ordres dérivés À LA
// MAIN du barème du 27/07/2026 — à re-dériver à chaque revalorisation d'un partenaire, en même
// temps que la mise à jour de commissions.ts (vérif rapide : rankBrokersByCommission(min) par tranche).
// Égalité sur 500-999 (RaiseFX = VT Markets) → RaiseFX d'abord (notre broker, cohérence vitrine).
// Tranches alignées sur les paliers du barème ET sur le minimum stratégie ($200) : pas de tranche
// sous 200$ — un dépôt inférieur ne peut pas copier, on ne l'oriente nulle part.

export interface BudgetBracket { key: string; label: string; min: number }

export const BUDGET_BRACKETS: BudgetBracket[] = [
  { key: 'b200', label: '$200 – $499', min: 200 },
  { key: 'b500', label: '$500 – $999', min: 500 },
  { key: 'b1000', label: '$1,000 – $2,999', min: 1000 },
  { key: 'b3000', label: '$3,000+', min: 3000 },
];

const ORDER: Record<string, string[]> = {
  b200: ['vtmarkets', 'raisefx', 'puprime', 'fxcess', 'tradingsphere'],
  b500: ['raisefx', 'vtmarkets', 'puprime', 'tradingsphere', 'fxcess'],
  b1000: ['vtmarkets', 'raisefx', 'puprime', 'fxcess', 'tradingsphere'],
  b3000: ['puprime', 'vtmarkets', 'raisefx', 'fxcess', 'tradingsphere'],
};

// null = pas de tranche choisie → l'appelant garde son ordre par défaut (RaiseFX en vedette)
export function brokerOrderFor(bracketKey: string | null | undefined): string[] | null {
  return bracketKey ? ORDER[bracketKey] ?? null : null;
}

// tranche correspondant à un montant connu (ex : minimum de la stratégie choisie en multi-comptes)
export function bracketForAmount(amountUsd: number): BudgetBracket | null {
  if (!Number.isFinite(amountUsd)) return null;
  let hit: BudgetBracket | null = null;
  for (const b of BUDGET_BRACKETS) if (amountUsd >= b.min) hit = b;
  return hit;
}
