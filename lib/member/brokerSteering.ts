// Ordre de PRÉSENTATION des brokers selon le budget annoncé — le tunnel « unlock my access » :
// on demande d'abord au prospect combien il compte investir, puis on met en avant le partenaire
// le plus rémunérateur pour cette tranche (barème admin : lib/member/commissions.ts).
// ⚠️ FICHIER CLIENT-SAFE : il part dans le bundle membre → UNIQUEMENT des ordres de présentation,
// JAMAIS les montants de commission (le barème reste dans le bundle admin). Ordres dérivés À LA
// MAIN du barème du 27/07/2026 — à re-dériver à chaque revalorisation d'un partenaire, en même
// temps que la mise à jour de commissions.ts (vérif rapide : rankBrokersByCommission(min) par tranche).
// Égalité impliquant RaiseFX → RaiseFX d'abord (notre broker, cohérence vitrine) ; sinon l'ordre de
// déclaration du barème tranche. Tranches alignées sur les paliers du barème ET sur le minimum
// stratégie ($200) : pas de tranche sous 200$ — un dépôt inférieur ne peut pas copier, on ne l'oriente
// nulle part.
// RE-DÉRIVÉ le 06/08/2026 après la revalorisation TradingSphere (400/700/900 + un palier à 4000$).
// La tranche « $3,000+ » a dû être COUPÉE EN DEUX : son palier à 4000$ vaut 1800$ quand le meilleur
// suivant plafonne à 1200$. Sans ce découpage, un prospect à 4000$+ était envoyé chez PU Prime — 600$
// de commission laissés sur la table à chaque fois, sans que rien ne le signale.

export interface BudgetBracket { key: string; label: string; min: number }

export const BUDGET_BRACKETS: BudgetBracket[] = [
  { key: 'b200', label: '$200 – $499', min: 200 },
  { key: 'b500', label: '$500 – $999', min: 500 },
  { key: 'b1000', label: '$1,000 – $2,999', min: 1000 },
  { key: 'b3000', label: '$3,000 – $3,999', min: 3000 },
  { key: 'b4000', label: '$4,000+', min: 4000 },
];

const ORDER: Record<string, string[]> = {
  b200: ['vtmarkets', 'tradingsphere', 'raisefx', 'puprime', 'fxcess'], // VT et TS à 400, VT déclaré avant
  b500: ['raisefx', 'vtmarkets', 'tradingsphere', 'puprime', 'fxcess'], // trio à 700, RaiseFX d'abord
  b1000: ['vtmarkets', 'raisefx', 'puprime', 'tradingsphere', 'fxcess'],
  b3000: ['puprime', 'vtmarkets', 'raisefx', 'tradingsphere', 'fxcess'],
  b4000: ['tradingsphere', 'puprime', 'vtmarkets', 'raisefx', 'fxcess'], // 1800$ — sans rival
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
