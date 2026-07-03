import { DEFAULT_CONFIG } from '../../lib/engine/config';
import { logNote } from '../../lib/supabase/sync';

// Gestion LIVE post-entrée, par position :
// - défaut (scalp/manuel) : breakeven précoce (beTrigger 0.15) — win rate 86% → 93% au backtest.
// - CUSTOM (stratégie breakout) : breakeven TARDIF + TRAILING — une cassure a besoin d'air, la sécuriser
//   trop tôt tue l'edge validé (labo : BE 0.8R, trailing 1.2R activé à 1.2R).
// Le riskDist custom est FIGÉ à l'entrée (après un BE, |open−SL| ne mesure plus le risque initial).
interface Mgmt { beTrigger: number; trailActivate?: number; trailDist?: number; riskDist: number }
const custom = new Map<string, Mgmt>(); // ticket → gestion spécifique (posée par le runner à l'exécution)
const peaks = new Map<string, number>(); // ticket → meilleur prix atteint (pour le trailing)
const done = new Map<string, true>(); // breakeven déjà appliqué
const r2 = (x: number) => Math.round(x * 100) / 100;

/** À appeler juste après l'exécution d'un trade géré différemment du défaut (ex. breakout). */
export function rememberManagement(ticket: string, m: Mgmt) {
  custom.set(ticket, m);
}

export async function manageBreakeven(stream: any, terminal: any, symbol: string) {
  const positions = (terminal.positions ?? []).filter((p: any) => p.symbol === symbol);
  const live = new Set<string>(positions.map((p: any) => String(p.id)));

  for (const p of positions) {
    const id = String(p.id);
    const long = p.type === 'POSITION_TYPE_BUY';
    const dir = long ? 1 : -1;
    const sl = p.stopLoss;
    if (sl == null) continue; // pas de SL → on ne touche pas (ordres nus des modes show)
    const mgmt = custom.get(id);
    const riskDist = mgmt?.riskDist ?? Math.abs(p.openPrice - sl);
    if (!riskDist) continue;
    const cur = p.currentPrice ?? p.openPrice;
    const profit = dir * (cur - p.openPrice);

    // ── TRAILING (custom uniquement) : suit le meilleur prix à trailDist × riskDist, jamais dans le mauvais sens.
    if (mgmt?.trailActivate && mgmt?.trailDist) {
      const prevPeak = peaks.get(id) ?? p.openPrice;
      const peak = long ? Math.max(prevPeak, cur) : Math.min(prevPeak, cur);
      peaks.set(id, peak);
      if (dir * (peak - p.openPrice) >= mgmt.trailActivate * riskDist) {
        const trail = r2(peak - dir * mgmt.trailDist * riskDist);
        // anti-spam : on ne modifie que si le SL avance d'au moins 5% du risque
        if (long ? trail > sl + 0.05 * riskDist : trail < sl - 0.05 * riskDist) {
          try {
            await stream.modifyPosition(id, trail, p.takeProfit);
            console.log(`[algoria] trailing → pos ${id} SL=${trail}`);
          } catch (e) {
            console.error('[algoria] trailing échec:', (e as { message?: string })?.message ?? e);
          }
          continue; // le trailing a la main — pas de logique BE en plus ce tick
        }
      }
    }

    // ── BREAKEVEN : déclencheur custom si posé, sinon défaut moteur (0.15).
    if (done.has(id)) continue;
    const beTrigger = mgmt?.beTrigger ?? DEFAULT_CONFIG.beTrigger ?? 0;
    if (!beTrigger || profit < beTrigger * riskDist) continue;

    const beSL = r2(p.openPrice + dir * 0.05 * riskDist); // BE+ (couvre les coûts)
    if (long ? beSL <= sl : beSL >= sl) {
      done.set(id, true); // le SL est déjà ≥ breakeven, rien à faire
      continue;
    }

    done.set(id, true); // optimiste : empêche un double-tir pendant l'await
    try {
      await stream.modifyPosition(id, beSL, p.takeProfit);
      console.log(`[algoria] breakeven → pos ${id} SL=${beSL}`);
      void logNote(`breakeven secured · ${long ? 'long' : 'short'} · SL → ${beSL} · trade can't lose now`, 'order');
    } catch (e) {
      done.delete(id); // échec → on réessaiera au prochain tick
      console.error('[algoria] breakeven échec:', (e as { message?: string })?.message ?? e);
    }
  }

  // nettoyage des positions fermées
  for (const id of done.keys()) if (!live.has(id)) done.delete(id);
  for (const id of peaks.keys()) if (!live.has(id)) peaks.delete(id);
  for (const id of custom.keys()) if (!live.has(id)) custom.delete(id);
}
