// Risque PORTEFEUILLE — plafond GLOBAL au-dessus des limites par-symbole.
// En multi-instruments, l'or + le Nasdaq (+ Forex à venir) peuvent tous déclencher en même temps.
// Sans garde-fou global, on empile des positions corrélées → risque de drawdown corrélé en live.
//
// Chaque trade auto est déjà sizé pour risquer un % ~fixe de l'equity (cf. config.risk dans constructTrade),
// donc PLAFONNER LE NOMBRE de positions ouvertes plafonne de fait le risque agrégé — pas besoin de calcul
// de contract-size par broker. Simple, robuste, testable. Ne s'applique qu'aux trades AUTO (confluence) :
// le manuel et les modes show restent la décision explicite de l'utilisateur.

export interface PortfolioConfig {
  maxOpenPositions: number; // total de positions concurrentes TOUS instruments confondus
  maxPositionsPerInstrument: number; // cap par symbole (empilement d'un même instrument)
}

const n = (v: string | undefined, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : d;
};

// Défauts prudents pour du live : ~6 positions max au total, 3 max par instrument.
// Pilotables par env (Railway) sans redéploiement de code.
export const PORTFOLIO: PortfolioConfig = {
  maxOpenPositions: n(process.env.PORTFOLIO_MAX_OPEN, 6),
  maxPositionsPerInstrument: n(process.env.PORTFOLIO_MAX_PER_INSTRUMENT, 3),
};

/**
 * Décide si un nouveau trade AUTO sur `symbol` doit être bloqué par le risque portefeuille.
 * @returns une raison (string) si bloqué, sinon null.
 */
export function portfolioVeto(p: {
  positions: { symbol: string }[]; // positions ouvertes chez le broker, TOUS symboles
  symbol: string; // symbole broker du candidat
  cfg?: PortfolioConfig;
}): string | null {
  const cfg = p.cfg ?? PORTFOLIO;
  const total = p.positions.length;
  if (total >= cfg.maxOpenPositions) return `portfolio cap — ${total}/${cfg.maxOpenPositions} positions ouvertes (tous instruments)`;
  const forSym = p.positions.filter((x) => x.symbol === p.symbol).length;
  if (forSym >= cfg.maxPositionsPerInstrument) return `${p.symbol} cap — ${forSym}/${cfg.maxPositionsPerInstrument} positions ouvertes`;
  return null;
}
