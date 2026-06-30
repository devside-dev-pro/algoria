import type { Signal } from '../../lib/engine/types';

const clientId = (s: Signal) => `ALG_${s.symbol}_${s.time}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);

/** Place l'ordre sur le compte master. `symbol` = nom du symbole CHEZ LE BROKER (ex. "Gold"). */
export async function placeSignal(stream: any, s: Signal, symbol: string) {
  const sl = s.stopLoss;
  const tp = s.takeProfits[0];
  const opts = { comment: `algoria ${s.mode}`, clientId: clientId(s) };
  const result =
    s.direction === 'long'
      ? await stream.createMarketBuyOrder(symbol, s.lot, sl, tp, opts)
      : await stream.createMarketSellOrder(symbol, s.lot, sl, tp, opts);
  return { ticket: result.positionId ?? result.orderId, code: result.stringCode };
}

/** Ferme TOUTES les positions ouvertes sur le symbole (bouton « close all » du cockpit). */
export async function closeAll(stream: any, symbol: string) {
  return stream.closePositionsBySymbol(symbol, {});
}
