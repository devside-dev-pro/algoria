import type { Signal } from '../../lib/engine/types';

// MetaApi impose : longueur(clientId) + longueur(comment) ≤ 26. On reste court (base36 du timestamp).
const clientId = (s: Signal) => `a${s.time.toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);

/**
 * Prépare lot + SL/TP pour qu'ils respectent les contraintes DU BROKER (sinon « Validation failed ») :
 * - SL/TP au moins à `stopsLevel` points du prix marché (on élargit si besoin) ;
 * - volume clampé à [minVolume, maxVolume] et arrondi au `volumeStep`.
 */
function prepareOrder(stream: any, s: Signal, symbol: string) {
  const spec = stream?.terminalState?.specification?.(symbol);
  const digits = typeof spec?.digits === 'number' ? spec.digits : 2;
  const point = Math.pow(10, -digits);
  const round = (x: number) => Number(x.toFixed(digits));

  // ----- SL / TP : distance mini au prix marché -----
  const minDist = (typeof spec?.stopsLevel === 'number' ? spec.stopsLevel : 0) * point;
  const buf = Math.max(minDist * 1.15, point * 10); // marge de sécurité au-delà du stops level
  const px = stream?.terminalState?.price?.(symbol);
  const long = s.direction === 'long';
  const ref = long ? px?.ask ?? s.entry : px?.bid ?? s.entry;
  let sl = s.stopLoss;
  let tp = s.takeProfits[0];
  if (long) {
    sl = round(Math.min(sl, ref - buf));
    tp = round(Math.max(tp, ref + buf));
  } else {
    sl = round(Math.max(sl, ref + buf));
    tp = round(Math.min(tp, ref - buf));
  }

  // ----- volume : bornes + pas -----
  const minV = typeof spec?.minVolume === 'number' ? spec.minVolume : 0.01;
  const maxV = typeof spec?.maxVolume === 'number' ? spec.maxVolume : 100;
  const stepV = typeof spec?.volumeStep === 'number' && spec.volumeStep > 0 ? spec.volumeStep : 0.01;
  let lot = Math.min(Math.max(s.lot, minV), maxV);
  lot = Math.round(lot / stepV) * stepV;
  lot = Number(lot.toFixed(2));

  return { sl, tp, lot };
}

/** Place l'ordre sur le compte master. `symbol` = nom du symbole CHEZ LE BROKER (ex. "Gold"). */
export async function placeSignal(stream: any, s: Signal, symbol: string) {
  const { sl, tp, lot } = prepareOrder(stream, s, symbol);
  const opts = { comment: 'algoria', clientId: clientId(s) }; // ≤ 26 au total (sinon MetaApi rejette l'ordre)
  const result =
    s.direction === 'long'
      ? await stream.createMarketBuyOrder(symbol, lot, sl, tp, opts)
      : await stream.createMarketSellOrder(symbol, lot, sl, tp, opts);
  return { ticket: result.positionId ?? result.orderId, code: result.stringCode };
}

/** Ferme TOUTES les positions ouvertes sur le symbole (bouton « close all » du cockpit). */
export async function closeAll(stream: any, symbol: string) {
  return stream.closePositionsBySymbol(symbol, {});
}
