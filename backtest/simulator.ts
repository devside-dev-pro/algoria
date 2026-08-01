import type { Bar, EngineState, Feature, Mode, Signal } from '../lib/engine/types';
import type { EngineConfig } from '../lib/engine/config';
import { runTick } from '../lib/engine/pipeline';
import { regimeMask } from '../lib/engine/regime';

export interface SimParams {
  symbol: string;
  mode: Mode;
  startBalance: number;
  spread: number; // en prix ($/once)
  slippage: number;
  commissionPerLot: number;
  contractSize: number;
  warmup: number; // bougies avant de commencer (≥210)
  window?: number; // si défini, le moteur ne voit que les N dernières bougies (= comportement live après un restart). 0/undefined = tout l'historique.
  // Gestion de trade dynamique (optionnelle) :
  beTrigger?: number; // déplace le SL à ~breakeven quand le profit ≥ beTrigger × riskDist
  beOffset?: number; // niveau du SL breakeven en × riskDist AU-DESSUS de l'entrée (défaut 0.05 = BE+ couvre les coûts)
  hardCap?: boolean; // cap de perte DUR : ferme les positions ouvertes dès que le plancher du jour latche
  // RATCHET JOURNALIER (étude) : une fois le pic du jour ≥ dayLockTrigger (fraction du solde), la journée se
  // coupe si l'equity retombe à dayLockFloor — le « +1600 qui finit à 0 » devient « +1600 qui finit ≥ floor ».
  dayLockTrigger?: number;
  dayLockFloor?: number;
  trailActivate?: number; // active le trailing quand le profit ≥ trailActivate × riskDist
  trailDist?: number; // distance du trailing en × riskDist (le SL suit à peak − trailDist)
  // ÉCHELLE de verrouillage (étude 28/07 — spec Mathieu « à +1000 lock +500, à +1500 lock +1000 ») :
  // paliers [déclencheur, verrou] en × riskDist sur le PIC favorable — dès pic ≥ déclencheur, SL ≥ entrée + verrou.
  // Complémentaire du trailing continu (le plus haut des deux gagne, jamais de recul).
  ladder?: Array<[number, number]>;
  // FLAT WEEK-END (étude 28/07 — les 2 stops de ~−1850$ du dim. 26 étaient des shorts portés depuis ven. 19h) :
  // ferme toute position le vendredi ≥ 20h UTC au close de la bougie, et n'ouvre plus rien dans la fenêtre.
  // Les overnights en semaine restent INTACTS (décision Mathieu : les nuits performent).
  weekendFlat?: boolean;
  // FILTRE DE SESSION (étude 29/07 — live 20→29/07 : scalp S2/S3 −12,7k$ sur Londres+US-open, Asie/nuit OK ;
  // le sim dit pareil : l'edge scalp vit la nuit) : bloque les NOUVELLES entrées dont l'heure UTC tombe dans
  // [from, to). Les positions déjà ouvertes vivent leur vie (les overnights restent intacts).
  blockEntryHours?: Array<[number, number]>;
  // FILTRE DE RÉGIME (étude 01/08 — « le trend following nous tue quand le marché range ») : refuse les
  // NOUVELLES entrées quand l'ADX et/ou l'Efficiency Ratio disent que le marché n'a pas de direction.
  // Les positions ouvertes vivent leur vie. Le masque est causal (valeur en i = bougies ≤ i seulement).
  regime?: import('../lib/engine/regime').RegimeFilter;
  // GESTION INTRA-BOUGIE (étude 01/08 — LE trou de la parité breakout). Le live gère le stop TOUTES LES
  // SECONDES (manage.ts sur le tick) ; le sim ne le déplaçait qu'en fin de bougie et ne le testait qu'à la
  // bougie SUIVANTE. Une bougie qui monte à +0,75R puis revient à l'entrée sort au breakeven en live, alors
  // que le sim offrait au trade une bougie de survie en plus — le temps de repartir et d'atteindre le
  // trailing. D'où 41 % de sorties 'trail' en sim contre 7 % en live, et tout l'edge simulé qui vient de là.
  // Activé : après avoir monté le stop avec l'extrême FAVORABLE de la bougie, on teste immédiatement
  // l'extrême ADVERSE de la MÊME bougie. Un seul chemin supposé (ça monte, puis ça redescend) — donc pas de
  // double peine avec le stop initial, déjà testé avant.
  intrabarManage?: boolean;
  ignoreTp?: boolean; // ignore le TP fixe → on ne sort que sur le stop (trailing) ou en fin de données
  ctxOpts?: Partial<import('../lib/engine/context').ContextOptions>; // options de contexte (session/vol) pour l'exploration
}

export interface SimTrade {
  dir: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  reason: 'tp' | 'sl' | 'eod' | 'be' | 'trail' | 'wkd';
  lot: number;
  pnl: number;
  r: number;
  confidence: number;
}
export interface EquityPoint {
  time: number;
  equity: number;
}
export interface BacktestRun {
  trades: SimTrade[];
  equity: EquityPoint[];
  finalBalance: number;
}

interface OpenPos {
  signal: Signal;
  entryPrice: number;
  entryTime: number;
  risk: number; // risque $ (riskDist × lot × contractSize)
  riskDist: number; // distance prix entrée→SL initial
  stop: number; // SL COURANT (dynamique : breakeven puis trailing)
  peak: number; // meilleur prix atteint (high pour long, low pour short)
}
const dayOf = (t: number) => Math.floor(t / 86_400_000);
// fenêtre de coupe hebdo : vendredi ≥ 20h UTC (l'or clôture ~21h — on est flat 1h avant, conservateur)
const isFriCutoff = (t: number) => { const d = new Date(t); return d.getUTCDay() === 5 && d.getUTCHours() >= 20; };

export function backtest(bars: Bar[], features: Feature[], cfg: EngineConfig, p: SimParams): BacktestRun {
  let balance = p.startBalance;
  let dayStart = balance;
  let dayKilled = false;
  // LATCH « journée terminée » (étude 01/08 — 2ᵉ triche du sim, trouvée en cherchant pourquoi S1 tient en
  // live). En live, readState VERROUILLE la journée dès l'objectif atteint : plus aucune entrée jusqu'à
  // minuit (types.ts dayDone). Le sim, lui, ne faisait que relire checkRisk à chaque bougie — donc dès que
  // l'equity retombait sous l'objectif, il REPARTAIT trader. Il rendait exactement ce que S1 refuse de
  // faire : continuer après avoir gagné. Or « +1 % puis stop » EST le design de S1 : sans le verrou, on ne
  // simulait pas S1, on simulait une S1 sans discipline.
  let dayDone = false;
  let dayPeakEq = balance;
  let tradesToday = 0;
  let lastTradeTime: number | undefined;
  let lastDay = dayOf(bars[p.warmup].time);
  const open: OpenPos[] = [];
  const trades: SimTrade[] = [];
  const equity: EquityPoint[] = [];
  const beTrig = p.beTrigger ?? cfg.beTrigger ?? 0; // breakeven piloté par la config moteur (override possible via SimParams)
  const trailAct = p.trailActivate ?? cfg.trailActivate; // trailing lock piloté par la config moteur (même logique)
  const trailD = p.trailDist ?? cfg.trailDist;
  // masque de régime précalculé UNE fois : chaque valeur ne dépend que des bougies ≤ i, donc le calculer
  // d'avance ne donne aucune information future au moteur — c'est juste O(n) au lieu de O(n²).
  const regimeOk = p.regime ? regimeMask(bars, p.regime) : null;

  const close = (pos: OpenPos, px: number, time: number, reason: SimTrade['reason']) => {
    const dir = pos.signal.direction === 'long' ? 1 : -1;
    const pnl = (px - pos.entryPrice) * dir * pos.signal.lot * p.contractSize - p.commissionPerLot * pos.signal.lot;
    balance += pnl;
    trades.push({
      dir: pos.signal.direction,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime: time,
      exitPrice: px,
      reason,
      lot: pos.signal.lot,
      pnl,
      r: pos.risk ? pnl / pos.risk : 0,
      confidence: pos.signal.confidence,
    });
  };

  for (let i = p.warmup; i < bars.length - 1; i++) {
    const bar = bars[i];

    // 1) gestion + sorties sur la bougie i — stop dynamique (breakeven → trailing), pessimiste : stop avant TP.
    // Le stop testé sur la bougie i a été figé par les bougies ≤ i-1 (mis à jour en fin de boucle) → aucun lookahead.
    for (let k = open.length - 1; k >= 0; k--) {
      const pos = open[k];
      const long = pos.signal.direction === 'long';
      const dir = long ? 1 : -1;
      const tp = pos.signal.takeProfits[0];

      const hitStop = long ? bar.low <= pos.stop : bar.high >= pos.stop;
      const hitTp = !p.ignoreTp && (long ? bar.high >= tp : bar.low <= tp);
      let ex: { px: number; reason: SimTrade['reason'] } | null = null;
      if (hitStop) {
        const above = dir * (pos.stop - pos.entryPrice); // >0 = stop déjà en profit
        ex = { px: pos.stop, reason: above > 0.1 * pos.riskDist ? 'trail' : above >= -1e-9 ? 'be' : 'sl' };
      } else if (hitTp) {
        ex = { px: tp, reason: 'tp' };
      }
      if (ex) {
        close(pos, ex.px, bar.time, ex.reason);
        open.splice(k, 1);
        continue;
      }

      // sinon : on remonte le stop pour la PROCHAINE bougie (jamais dans le mauvais sens)
      pos.peak = long ? Math.max(pos.peak, bar.high) : Math.min(pos.peak, bar.low);
      const fav = dir * (pos.peak - pos.entryPrice); // distance favorable max atteinte
      if (beTrig && fav >= beTrig * pos.riskDist) {
        const be = pos.entryPrice + dir * (p.beOffset ?? 0.05) * pos.riskDist; // BE+ : couvre les coûts
        pos.stop = long ? Math.max(pos.stop, be) : Math.min(pos.stop, be);
      }
      if (p.ladder) // échelle : au palier atteint (pic), verrouille entrée + lock×R — même sémantique que manage.ts:46
        for (const [trig, lock] of p.ladder)
          if (fav >= trig * pos.riskDist) {
            const lvl = pos.entryPrice + dir * lock * pos.riskDist;
            pos.stop = long ? Math.max(pos.stop, lvl) : Math.min(pos.stop, lvl);
          }
      if (trailAct && trailD && fav >= trailAct * pos.riskDist) {
        const trail = pos.peak - dir * trailD * pos.riskDist;
        pos.stop = long ? Math.max(pos.stop, trail) : Math.min(pos.stop, trail);
      }

      // Le stop qu'on vient de remonter est-il déjà touché par l'extrême adverse de CETTE bougie ?
      // C'est ce que vit le live, qui gère à la seconde. Sans ça, le sim accorde un sursis d'une bougie.
      if (p.intrabarManage && (long ? bar.low <= pos.stop : bar.high >= pos.stop)) {
        const above = dir * (pos.stop - pos.entryPrice);
        close(pos, pos.stop, bar.time, above > 0.1 * pos.riskDist ? 'trail' : above >= -1e-9 ? 'be' : 'sl');
        open.splice(k, 1);
      }
    }

    // FLAT WEEK-END : vendredi ≥ 20h UTC → tout fermer au close (le stop/TP de la bougie a déjà été honoré ci-dessus)
    if (p.weekendFlat && open.length && isFriCutoff(bar.time)) {
      for (let k = open.length - 1; k >= 0; k--) { close(open[k], bar.close, bar.time, 'wkd'); open.splice(k, 1); }
    }

    // 2) frontière de jour → reset (kill switch, compteurs)
    const d = dayOf(bar.time);
    if (d !== lastDay) {
      lastDay = d;
      dayStart = balance;
      dayKilled = false;
      dayDone = false; // minuit UTC : le verrou du jour saute, comme en live
      tradesToday = 0;
      dayPeakEq = balance;
    }

    // 3) equity mark-to-market + kill switch journalier
    const floating = open.reduce(
      (sum, o) => sum + (bar.close - o.entryPrice) * (o.signal.direction === 'long' ? 1 : -1) * o.signal.lot * p.contractSize,
      0,
    );
    const eq = balance + floating;
    equity.push({ time: bar.time, equity: eq });
    const wasKilled = dayKilled;
    if ((dayStart - eq) / dayStart >= cfg.risk.maxDailyLossPct) dayKilled = true;
    dayPeakEq = Math.max(dayPeakEq, eq);
    const lockTrig = p.dayLockTrigger ?? cfg.risk.dayLockTriggerPct; // piloté par la config moteur (comme le trailing)
    const lockFloor = p.dayLockFloor ?? cfg.risk.dayLockFloorPct;
    if (lockTrig && lockFloor != null && (dayPeakEq - dayStart) / dayStart >= lockTrig && (eq - dayStart) / dayStart <= lockFloor) dayKilled = true;
    // CAP DUR (option) : au moment PRÉCIS où le cap latche, on FERME les positions ouvertes au close de la bougie
    // (au lieu de les laisser courir jusqu'à leur stop). Borne la journée rouge ~au cap au lieu de saigner au-delà.
    // LATCH du jour : objectif atteint OU cap de perte OU ratchet → verrouillé jusqu'à minuit. Une fois posé,
    // il ne se relève JAMAIS dans la journée, même si l'equity repasse sous le seuil — c'est tout l'intérêt.
    const target = cfg.risk.dailyProfitTargetPct;
    if (!dayDone && ((target && (eq - dayStart) / dayStart >= target) || dayKilled)) dayDone = true;
    if (p.hardCap && dayKilled && !wasKilled && open.length) {
      for (let k = open.length - 1; k >= 0; k--) { close(open[k], bar.close, bar.time, 'sl'); open.splice(k, 1); }
    }

    // 4) moteur sur clôture de i (fenêtre causale : rien après i)
    const state: EngineState = {
      balance,
      equity: eq,
      dayStartBalance: dayStart,
      dayPnL: eq - dayStart,
      openPositions: open.length,
      openRiskPct: open.reduce((s, o) => s + o.risk, 0) / balance,
      tradesToday,
      lastTradeTime,
      spread: p.spread,
      newsWindows: [],
      killed: dayKilled,
      dayDone,
    };
    const lo = p.window && p.window > 0 ? Math.max(0, i + 1 - p.window) : 0;
    const { signal } = runTick({ symbol: p.symbol, bars: bars.slice(lo, i + 1), mode: p.mode, state, ctxOpts: { spread: p.spread, ...(p.ctxOpts ?? {}) } }, features, cfg);

    // 5) entrée à l'OUVERTURE de i+1 (jamais sur la bougie qu'on vient de lire → pas de lookahead)
    const entryHour = new Date(bars[i + 1].time).getUTCHours();
    const hourBlocked = p.blockEntryHours?.some(([from, to]) => entryHour >= from && entryHour < to) ?? false;
    // régime lu sur la bougie i (la dernière CLÔTURÉE), jamais sur i+1 où l'on entre
    const regimeBlocked = regimeOk ? !regimeOk[i] : false;
    if (signal && !hourBlocked && !regimeBlocked && !(p.weekendFlat && isFriCutoff(bars[i + 1].time))) {
      const next = bars[i + 1];
      const dir = signal.direction === 'long' ? 1 : -1;
      const entryPrice = next.open + dir * (p.spread / 2 + p.slippage);
      const riskDist = Math.abs(entryPrice - signal.stopLoss);
      open.push({ signal, entryPrice, entryTime: next.time, risk: riskDist * signal.lot * p.contractSize, riskDist, stop: signal.stopLoss, peak: entryPrice });
      tradesToday++;
      lastTradeTime = signal.time;
    }
  }

  const lastBar = bars[bars.length - 1];
  for (const pos of open) close(pos, lastBar.close, lastBar.time, 'eod');
  return { trades, equity, finalBalance: balance };
}
