// Brokers partenaires (liens IB/affiliés ALGORIA — commission au dépôt ≥ 500$).
// RaiseFX en VEDETTE (le broker d'Algoria : mêmes spreads que le maître + meilleure commission),
// les autres en alternatives si le membre a déjà un compte ailleurs. Constantes client-safe (liens publics).
export interface Broker {
  key: string;
  name: string;
  url: string;
  featured?: boolean;
  note?: string;
  // Noms EXACTS des serveurs MT5 (au caractère près) — proposés en menu déroulant à la connexion.
  // Le copieur STH exige la chaîne EXACTE : « PuPrime Live6 » ≠ « PUPrime-Live 6 » → erreur, la copie ne démarre pas.
  // Relevés directement dans la liste serveur de STH/MT5 (screens Mathieu). SERVEURS LIVE UNIQUEMENT (pas de demo :
  // un membre doit être en réel). Serveur non listé → saisie libre en repli, donc jamais de blocage.
  servers?: string[];
}

export const BROKERS: Broker[] = [
  {
    key: 'raisefx',
    name: 'RaiseFX',
    url: 'https://partners.raisefx.com/visit/?bta=168726&brand=raisefx&afp=ALGORIA',
    featured: true,
    note: "Algoria's own broker — the exact same spreads as the AI you watch live.",
    servers: ['RaiseGlobal-Live'], // société "RaiseGlobal"
  },
  { key: 'vtmarkets', name: 'VT Markets', url: 'https://go.vtaffiliates.com/visit/?bta=35824&brand=vt', servers: ['VTMarkets-Live', 'VTMarkets-Live 2', 'VTMarkets-Live 3', 'VTMarkets-Live 5', 'VTMarkets-Live 6', 'VTMarkets-Live 7', 'VTMarkets-Live 8'] },
  // PU Prime — attention : « PUPrime-Live2 » (sans espace) ET « PUPrime-Live 2 » (avec espace) sont DEUX serveurs distincts.
  { key: 'puprime', name: 'PU Prime', url: 'https://go.puprime.partners/visit/?bta=35491&brand=pu&campaign=230205&afp=ALGORIA', servers: ['PUPrime-Live', 'PUPrime-Live 2', 'PUPrime-Live2', 'PUPrime-Live 4', 'PUPrime-Live 5', 'PUPrime-Live 6', 'PUPrime-Live 7'] },
  { key: 'fxcess', name: 'FXCESS', url: 'https://go.fxcess.com/visit/?bta=35526&brand=fxcess&afp=ALGORIA', servers: ['FXCESS-Live01'] },
  { key: 'tradingsphere', name: 'TradingSphere', url: 'https://go.tradingsphere.com/visit/?bta=35182&brand=tradingsphere&afp=ALGORIA', servers: ['TradingSphere-Real1'] },
];
