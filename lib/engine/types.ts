// Contrats partagés du moteur Algoria. Aucune dépendance — mêmes types en live et en backtest.

export type Direction = 'long' | 'short' | 'flat';
export type Mode = 'soft' | 'normal' | 'turbo';
export type Session = 'asia' | 'london' | 'overlap' | 'newyork' | 'closed';
export type Regime = 'trend' | 'range';

/** Une bougie. time = ms epoch UTC. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // tick volume MetaApi (proxy, pas du vrai volume spot)
}

/** Zone S/R construite par clustering des swings. */
export interface Zone {
  price: number;
  upper: number;
  lower: number;
  kind: 'support' | 'resistance';
  touches: number;
  strength: number; // 0..1
  isRound: boolean;
}

/** Sortie de l'étage 1 — le régime qui gate tout. */
export interface MarketContext {
  symbol: string;
  time: number;
  price: number;
  session: Session;
  regime: Regime;
  adx: number;
  atr: number;
  atrPercentile: number;
  emaBias: Direction;
  macroBias: number; // -1..+1 (DXY/US10Y). 0 si inconnu.
  spread: number;
  zones: Zone[];
  tradable: boolean;
}

/** Ce que chaque feature émet. signe du score = direction. */
export interface FeatureScore {
  key: string;
  score: number; // -1..+1 (baissier → haussier)
  strength: number; // 0..1
  note?: string;
}

export interface FeatureInput {
  bars: Bar[];
  htfBars?: Bar[];
  ctx: MarketContext;
}

/** Une preuve enfichable (étage 2). Vit dans /features/*. */
export interface Feature {
  key: string;
  compute(input: FeatureInput): FeatureScore | null; // null = non applicable ce tick
}

/** Résultat du modèle de confluence (étage 3). */
export interface Confluence {
  direction: Direction;
  rawScore: number;
  alignment: number;
  quality: number;
  macro: number;
  confidence: number; // 0..1
  contributions: Array<{ key: string; weight: number; score: number; weighted: number }>;
}

/** Trade construit et dimensionné (étage 4). */
export interface Signal {
  id: string;
  symbol: string;
  time: number;
  direction: Exclude<Direction, 'flat'>;
  mode: Mode;
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfits: number[];
  riskReward: number;
  lot: number;
  rationale: string[];
  confluence: Confluence;
}

export interface RiskVerdict {
  ok: boolean;
  reasons: string[];
}

/** Streamé vers le terminal ALGORIA AI. */
export interface EngineEvent {
  t: number;
  level: 'scan' | 'info' | 'signal' | 'order' | 'veto';
  msg: string;
  data?: Record<string, unknown>;
}

/** État du compte/session, possédé par le runner (ou simulé par le backtest). */
export interface EngineState {
  balance: number;
  equity: number;
  dayStartBalance: number;
  dayPnL: number;
  openPositions: number;
  openRiskPct: number;
  tradesToday: number;
  lastTradeTime?: number;
  spread: number;
  newsWindows: Array<{ start: number; end: number; label: string }>;
  killed: boolean;
}
