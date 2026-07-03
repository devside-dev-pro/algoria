// Brokers partenaires (liens IB/affiliés ALGORIA — commission au dépôt ≥ 500$).
// RaiseFX en VEDETTE (le broker d'Algoria : mêmes spreads que le maître + meilleure commission),
// les autres en alternatives si le membre a déjà un compte ailleurs. Constantes client-safe (liens publics).
export interface Broker {
  key: string;
  name: string;
  url: string;
  featured?: boolean;
  note?: string;
}

export const BROKERS: Broker[] = [
  {
    key: 'raisefx',
    name: 'RaiseFX',
    url: 'https://partners.raisefx.com/visit/?bta=168726&brand=raisefx&afp=ALGORIA',
    featured: true,
    note: "Algoria's own broker — the exact same spreads as the AI you watch live.",
  },
  { key: 'vtmarkets', name: 'VT Markets', url: 'https://go.vtaffiliates.com/visit/?bta=35824&brand=vt' },
  { key: 'puprime', name: 'PU Prime', url: 'https://go.puprime.partners/visit/?bta=35491&brand=pu&campaign=230205&afp=ALGORIA' },
  { key: 'fxcess', name: 'FXCESS', url: 'https://go.fxcess.com/visit/?bta=35526&brand=fxcess&afp=ALGORIA' },
  { key: 'tradingsphere', name: 'TradingSphere', url: 'https://go.tradingsphere.com/visit/?bta=35182&brand=tradingsphere&afp=ALGORIA' },
];
