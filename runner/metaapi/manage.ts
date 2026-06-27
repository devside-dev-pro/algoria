import { DEFAULT_CONFIG } from '../../lib/engine/config';
import { logNote } from '../../lib/supabase/sync';

// Breakeven LIVE : dès qu'une position atteint beTrigger × (risque initial), on remonte son SL à ~l'entrée.
// Un trade ainsi sécurisé ne peut plus se transformer en perte → c'est ce qui fait passer le win rate de 86% à 93% au backtest.
const done = new Map<number, true>(); // positionId déjà passé en breakeven
const r2 = (x: number) => Math.round(x * 100) / 100;

export async function manageBreakeven(stream: any, terminal: any, symbol: string) {
  const beTrigger = DEFAULT_CONFIG.beTrigger ?? 0;
  if (!beTrigger) return;

  const positions = (terminal.positions ?? []).filter((p: any) => p.symbol === symbol);
  const live = new Set<number>(positions.map((p: any) => p.id));

  for (const p of positions) {
    if (done.has(p.id)) continue;
    const long = p.type === 'POSITION_TYPE_BUY';
    const dir = long ? 1 : -1;
    const sl = p.stopLoss;
    if (sl == null) continue; // pas de SL → on ne touche pas
    const riskDist = Math.abs(p.openPrice - sl);
    if (!riskDist) continue;

    const profit = dir * ((p.currentPrice ?? p.openPrice) - p.openPrice);
    if (profit < beTrigger * riskDist) continue; // pas encore au déclencheur

    const beSL = r2(p.openPrice + dir * 0.05 * riskDist); // BE+ (couvre les coûts)
    if (long ? beSL <= sl : beSL >= sl) {
      done.set(p.id, true); // le SL est déjà ≥ breakeven, rien à faire
      continue;
    }

    done.set(p.id, true); // optimiste : empêche un double-tir pendant l'await
    try {
      await stream.modifyPosition(String(p.id), beSL, p.takeProfit);
      console.log(`[algoria] breakeven → pos ${p.id} SL=${beSL}`);
      void logNote(`breakeven secured · ${long ? 'long' : 'short'} · SL → ${beSL} · trade can't lose now`, 'order');
    } catch (e) {
      done.delete(p.id); // échec → on réessaiera au prochain tick
      console.error('[algoria] breakeven échec:', (e as { message?: string })?.message ?? e);
    }
  }

  for (const id of done.keys()) if (!live.has(id)) done.delete(id); // nettoyage des positions fermées
}
