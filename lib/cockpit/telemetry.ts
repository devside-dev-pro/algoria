// Générateur de télémétrie "mission control" pour le terminal ALGORIA. Pur (aucun React/IO).
// Tout est formaté à partir de VRAIS chiffres (prix live, état moteur) — le cockpit ne fait que
// densifier le flux pour le rendre vivant tick par tick entre les mises à jour réelles.

export const TAG_COLOR: Record<string, string> = {
  FEED: '#2be3f5',
  TICK: '#2e8bf0',
  MOM: '#1fd8b0',
  VOL: '#f5c24a',
  TREND: '#4fb8ff',
  SESS: '#8298be',
  LVL: '#7fc4ff',
  RISK: '#1fd8b0',
  SYS: '#54688e',
  SCAN: '#3aa0ff',
  // injectés (events réels)
  AI: '#7ef0ff',
  SIGNAL: '#1fd8b0',
  EXEC: '#2be3f5',
  VETO: '#ff6b8a',
  ENGINE: '#8298be',
};

export interface Feed {
  mid: number; bid: number; ask: number; spread: number;
  dPx: number; dPct: number; velocity: number; ticks: number; vwap: number; up: boolean;
  session: string; regime: string; tradable: boolean; emaBias: string;
  atr: number; atrPct: number; adx: number;
  equity: number; balance: number; dayPnL: number; openPositions: number; openRiskPct: number;
  mode: string; killed: boolean;
  uptimeMs: number; feedLagMs: number; live: boolean;
}

const n0 = (x: number) => x.toFixed(0);
const n1 = (x: number) => x.toFixed(1);
const n2 = (x: number) => x.toFixed(2);
const sgn = (x: number, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
const grp = (x: number) => Math.round(x).toLocaleString('en-US');
const arrow = (x: number) => (x > 0 ? '▲' : x < 0 ? '▼' : '·');
const pctf = (x: number, d = 1) => (x * 100).toFixed(d) + '%';
const bar = (frac: number, w = 8) => {
  const k = Math.max(0, Math.min(w, Math.round(frac * w)));
  return '█'.repeat(k) + '·'.repeat(w - k); // '·' (pas '░') → rendu net dans toutes les polices
};
export const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return [h, m, x].map((v) => String(v).padStart(2, '0')).join(':');
};

const pick = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];

// minutes jusqu'à l'open NY (~13:00 UTC) — réel, donne le tempo "compte à rebours"
function nyCountdown(): string {
  const now = new Date();
  const o = new Date(now);
  o.setUTCHours(13, 0, 0, 0);
  if (o.getTime() <= now.getTime()) o.setUTCDate(o.getUTCDate() + 1);
  const mins = Math.floor((o.getTime() - now.getTime()) / 60000);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

type Gen = (f: Feed) => { tag: string; text: string };

const GENERATORS: Array<{ w: number; fn: Gen }> = [
  { w: 9, fn: (f) => ({ tag: 'FEED', text: `bid ${n2(f.bid)}  ask ${n2(f.ask)}  spr ${n2(f.spread)}  Δ ${sgn(f.dPx)}` }) },
  { w: 7, fn: (f) => ({ tag: 'TICK', text: `px ${n2(f.mid)}  ${arrow(f.dPx)} ${sgn(f.dPct, 3)}%  vwap~${n1(f.vwap)}  n ${f.ticks.toLocaleString('en-US')}` }) },
  { w: 5, fn: (f) => ({ tag: 'MOM', text: `mom ${sgn(f.dPct * 20, 2)}σ  vel ${sgn(f.velocity, 3)}/s  ${f.up ? 'streak ▲▲▲' : 'streak ▼▼▼'}` }) },
  { w: 4, fn: (f) => ({ tag: 'VOL', text: `atr ${n2(f.atr)}  pctl ${n0(f.atrPct)}  band ±${n2((f.atr / Math.max(1, f.mid)) * 100)}%  ${bar(f.atrPct / 100)}` }) },
  { w: 4, fn: (f) => ({ tag: 'TREND', text: `adx ${n1(f.adx)} ${f.adx > 25 ? '↑ strong' : f.adx < 18 ? '· weak' : '· building'}  bias ${f.emaBias}  regime ${f.regime}` }) },
  { w: 3, fn: (f) => ({ tag: 'SESS', text: `${f.session.toUpperCase()} ${f.tradable ? 'OPEN' : 'LOCKED'}  ·  NY T-${nyCountdown()}  ·  liq ${f.session === 'overlap' ? 'PEAK' : f.session === 'closed' ? 'thin' : 'rising'}` }) },
  {
    w: 4,
    fn: (f) => {
      const rl = Math.round(f.mid / 5) * 5;
      const d = f.mid - rl;
      const big = Math.round(f.mid / 50) * 50;
      return { tag: 'LVL', text: `round ${n1(rl)} (Δ ${sgn(d, 1)})  ·  psy ${n0(big)} magnet  ·  ${Math.abs(d) < 0.6 ? 'TAGGED' : 'tracking'}` };
    },
  },
  { w: 3, fn: (f) => ({ tag: 'RISK', text: `eq ${grp(f.equity)}  dP&L ${sgn(f.dayPnL, 1)}  expo ${pctf(f.openRiskPct)}  pos ${f.openPositions}${f.killed ? '  [KILL]' : ''}` }) },
  {
    w: 4,
    fn: (f) =>
      ({
        tag: 'SCAN',
        text: pick([
          `scan ema(8·21·55) · rsi(14) · sweep · round-levels`,
          `confluence engine ${f.tradable ? 'live' : 'idle'}  ·  next M5 close pending`,
          `liquidity-sweep detector armed  ·  ${f.regime} regime gate`,
          `grid: trend ${f.adx > 25 ? '✓' : '·'} · pullback · sweep · round ${Math.abs(f.mid - Math.round(f.mid / 5) * 5) < 0.6 ? '✓' : '·'}`,
        ]),
      }),
  },
  {
    w: 6,
    fn: (f) =>
      ({
        tag: 'SYS',
        text: pick([
          `data-feed ${f.live ? 'LIVE ●' : 'SIM ○'}  ·  lag ${f.live ? f.feedLagMs + 'ms' : '—'}  ·  up ${hms(f.uptimeMs)}`,
          `metaapi ${f.live ? '● up' : '○ idle'}  ·  realtime ●  ·  q 0  ·  seq ${f.ticks % 9999}`,
          `heartbeat ok  ·  feed ${f.live ? 'LIVE' : 'SIM'}  ·  engine ${f.tradable ? 'armed' : 'idle'}`,
        ]),
      }),
  },
];

const TOTAL_W = GENERATORS.reduce((s, g) => s + g.w, 0);

/** Tire une ligne de télémétrie (pondérée) à partir de l'état courant. */
export function pickLine(f: Feed): { tag: string; text: string } {
  let r = Math.random() * TOTAL_W;
  for (const g of GENERATORS) {
    if ((r -= g.w) <= 0) return g.fn(f);
  }
  return GENERATORS[0].fn(f);
}
