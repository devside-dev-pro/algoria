// SOURCE UNIQUE du track record simulé d'Algoria — lue à la fois par la page PUBLIQUE (app/backtest/Report.tsx)
// et par l'écran NATIF de l'app (app/member/track-record/page.tsx). Une seule vérité : le jour où on régénère
// (ex. quand le mois en cours passe live), on met à jour ICI et les deux surfaces suivent.
//
// Fenêtre = 16 mois PLEINS (mars 2025 → juin 2026), config EXACTE de prod (SCALP_CONFIG maxOpenPositions:1
// + emaGate 'notOpposed' + mode 'scalp'), un seul compte à 1% de risque/trade composé, base 1 000 $.
// Chiffres issus du backtester causal du repo (backtest/simulator.ts + labcore.ts) via scripts/backtest-12mo.ts.

export interface RecordMonth { label: string; n: number; win: number; net: number }

export const RECORD = {
  window: { from: 'Mar 2025', to: 'Jun 2026', months: 16 },
  start: 1_000,
  end: 4_437,
  returnPct: 344, // (4437-1000)/1000
  trades: 6_773,
  winRate: 83, // %
  profitFactor: 1.12,
  maxDrawdownPct: 30.7,
  split: 'gold scalp + swing',
  // équité SIMULÉE du LIVRE COMPLET (scalp+swings, un compte, composé), ~143 pts, base 1 000 $
  eq: [1000, 986, 935, 933, 918, 1019, 1093, 1092, 1084, 1127, 1128, 1111, 1148, 1095, 1055, 1221, 1217, 1190, 1135, 1160, 1180, 1180, 1213, 1190, 1286, 1270, 1230, 1243, 1214, 1227, 1246, 1382, 1386, 1391, 1464, 1484, 1403, 1417, 1349, 1306, 1336, 1306, 1403, 1468, 1522, 1459, 1481, 1449, 1381, 1365, 1283, 1243, 1164, 1183, 1124, 1094, 1096, 1128, 1173, 1398, 1385, 1354, 1415, 1320, 1458, 1448, 1530, 1564, 1782, 1754, 1740, 1757, 1776, 1798, 1777, 1802, 1844, 1822, 1879, 1946, 1926, 1925, 1895, 2248, 2253, 2317, 2291, 2333, 2388, 2529, 3124, 2857, 2774, 2661, 2730, 2725, 2662, 2754, 2689, 2969, 3264, 3183, 3440, 3511, 3490, 3505, 3414, 3387, 3603, 3644, 3481, 3468, 3491, 3674, 3815, 3575, 3486, 3260, 3195, 3276, 3412, 3285, 3132, 3090, 2980, 3205, 3230, 3536, 3578, 3202, 3184, 3078, 3093, 3187, 3228, 3098, 3572, 3694, 3728, 3861, 3757, 4312, 4437] as number[],
  months: [
    { label: 'Mar 25', n: 397, win: 85, net: 131 }, { label: 'Apr 25', n: 411, win: 80, net: 1 },
    { label: 'May 25', n: 445, win: 84, net: 96 }, { label: 'Jun 25', n: 447, win: 85, net: 169 },
    { label: 'Jul 25', n: 458, win: 82, net: 69 }, { label: 'Aug 25', n: 428, win: 78, net: -383 },
    { label: 'Sep 25', n: 435, win: 84, net: 395 }, { label: 'Oct 25', n: 498, win: 82, net: 299 },
    { label: 'Nov 25', n: 414, win: 84, net: 320 }, { label: 'Dec 25', n: 478, win: 85, net: 552 },
    { label: 'Jan 26', n: 349, win: 83, net: 603 }, { label: 'Feb 26', n: 365, win: 84, net: 268 },
    { label: 'Mar 26', n: 434, win: 80, net: -290 }, { label: 'Apr 26', n: 440, win: 83, net: 43 },
    { label: 'May 26', n: 366, win: 79, net: -149 }, { label: 'Jun 26', n: 408, win: 87, net: 1314 },
  ] as RecordMonth[],
};

export const greenMonths = RECORD.months.filter((m) => m.net >= 0).length;
