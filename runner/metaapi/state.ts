import type { EngineState } from '../../lib/engine/types';

/** Mappe le terminalState MetaApi (compte + positions + prix) vers EngineState.
 *  `dayCaps` (optionnel) : les plafonds journaliers de l'instrument primaire. Fournis, ils pilotent
 *  le RESET QUOTIDIEN (à minuit UTC, dayStartBalance/tradesToday repartent) et le LATCH « journée terminée » :
 *  dès que le P&L du jour touche +targetPct OU −lossPct, dayDone reste vrai jusqu'au lendemain (plus d'entrées). */
export function readState(
  terminal: any,
  symbol: string,
  prev: Partial<EngineState> = {},
  dayCaps?: { targetPct?: number; lossPct?: number },
): EngineState {
  const info = terminal.accountInformation ?? {};
  const positions = (terminal.positions ?? []).filter((p: any) => p.symbol === symbol);
  const px = terminal.price(symbol) ?? {};
  const spread = px.ask && px.bid ? px.ask - px.bid : 0;
  const openRisk = positions.reduce(
    (s: number, p: any) => s + (p.stopLoss ? Math.abs(p.openPrice - p.stopLoss) * p.volume * 100 : 0),
    0,
  );

  const balance = info.balance ?? 0;
  const equity = info.equity ?? balance;

  // Reset journalier : au changement de jour UTC, le solde de référence et les compteurs repartent de zéro.
  // (Avant : dayStartBalance était figé au démarrage du process → les plafonds « journaliers » se mesuraient
  //  depuis le dernier reboot et ne se déclenchaient jamais correctement.)
  const today = new Date().toISOString().slice(0, 10);
  const rollover = prev.dayStamp != null && prev.dayStamp !== today;
  const dayStartBalance = rollover ? balance : (prev.dayStartBalance ?? balance);
  const tradesToday = rollover ? 0 : (prev.tradesToday ?? 0);

  const dayPnlPct = dayStartBalance > 0 ? (equity - dayStartBalance) / dayStartBalance : 0;
  const hitTarget = dayCaps?.targetPct != null && dayPnlPct >= dayCaps.targetPct;
  const hitLoss = dayCaps?.lossPct != null && dayPnlPct <= -dayCaps.lossPct;
  const dayDone = rollover ? false : ((prev.dayDone ?? false) || hitTarget || hitLoss);
  // la RAISON latch avec le dayDone (première limite touchée) — perte prioritaire si les deux (cas théorique).
  const dayDoneReason = rollover ? undefined : (prev.dayDoneReason ?? (hitLoss ? 'loss' : hitTarget ? 'target' : undefined));

  return {
    balance,
    equity,
    dayStartBalance,
    dayPnL: equity - dayStartBalance,
    openPositions: positions.length,
    openRiskPct: balance ? openRisk / balance : 0,
    tradesToday,
    lastTradeTime: prev.lastTradeTime,
    spread,
    newsWindows: prev.newsWindows ?? [],
    killed: prev.killed ?? false,
    dayStamp: today,
    dayDone,
    dayDoneReason,
  };
}
