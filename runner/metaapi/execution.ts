import type { Signal } from '../../lib/engine/types';

const clientId = (s: Signal) => `ALG_${s.symbol}_${s.time}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);

/** SL/TP sont des PRIX. Buy: SL<prix<TP. Sell: TP<prix<SL (garanti par trade.ts). */
export async function placeSignal(stream: any, s: Signal) {
  const sl = s.stopLoss;
  const tp = s.takeProfits[0];
  const opts = { comment: `algoria ${s.mode}`, clientId: clientId(s) };
  const result =
    s.direction === 'long'
      ? await stream.createMarketBuyOrder(s.symbol, s.lot, sl, tp, opts)
      : await stream.createMarketSellOrder(s.symbol, s.lot, sl, tp, opts);
  return { ticket: result.positionId ?? result.orderId, code: result.stringCode };
}
