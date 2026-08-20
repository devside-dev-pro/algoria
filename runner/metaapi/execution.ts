import type { Signal } from '../../lib/engine/types';
import { ACTIVE_STRATEGY } from '../../lib/engine/strategies';
import { inMaintenance } from '../../lib/member/maintenance';

/**
 * Prépare lot + SL/TP selon les contraintes DU BROKER.
 * - Trade « nu » (stopLoss=0 ET takeProfits vide) → on N'ENVOIE PAS de SL/TP (l'utilisateur gère la sortie).
 * - Sinon : SL/TP au moins à `stopsLevel` points du prix ; volume borné et arrondi au pas.
 */
function prepareOrder(stream: any, s: Signal, symbol: string): { sl?: number; tp?: number; lot: number } {
  const spec = stream?.terminalState?.specification?.(symbol);
  const digits = typeof spec?.digits === 'number' ? spec.digits : 2;
  const point = Math.pow(10, -digits);
  const round = (x: number) => Number(x.toFixed(digits));

  // ----- volume : bornes + pas -----
  const minV = typeof spec?.minVolume === 'number' ? spec.minVolume : 0.01;
  const maxV = typeof spec?.maxVolume === 'number' ? spec.maxVolume : 100;
  const stepV = typeof spec?.volumeStep === 'number' && spec.volumeStep > 0 ? spec.volumeStep : 0.01;
  let lot = Math.min(Math.max(s.lot, minV), maxV);
  lot = Math.round(lot / stepV) * stepV;
  lot = Number(lot.toFixed(2));

  // ----- ordre nu : aucun SL/TP envoyé -----
  const hasSL = typeof s.stopLoss === 'number' && s.stopLoss > 0;
  const hasTP = Array.isArray(s.takeProfits) && typeof s.takeProfits[0] === 'number' && s.takeProfits[0] > 0;
  if (!hasSL && !hasTP) return { lot };

  // ----- SL / TP : au moins à `stopsLevel` du prix marché -----
  const minDist = (typeof spec?.stopsLevel === 'number' ? spec.stopsLevel : 0) * point;
  const buf = Math.max(minDist * 1.15, point * 10);
  const px = stream?.terminalState?.price?.(symbol);
  const long = s.direction === 'long';
  const ref = long ? px?.ask ?? s.entry : px?.bid ?? s.entry;
  let sl = hasSL ? s.stopLoss : undefined;
  let tp = hasTP ? s.takeProfits[0] : undefined;
  if (long) {
    if (sl != null) sl = round(Math.min(sl, ref - buf));
    if (tp != null) tp = round(Math.max(tp, ref + buf));
  } else {
    if (sl != null) sl = round(Math.max(sl, ref + buf));
    if (tp != null) tp = round(Math.min(tp, ref - buf));
  }
  return { sl, tp, lot };
}

/** Place l'ordre sur le compte master. `symbol` = nom CHEZ LE BROKER (ex. "Gold"). */
export async function placeSignal(stream: any, s: Signal, symbol: string) {
  // ═══ VERROU DE MAINTENANCE ═══════════════════════════════════════════════════════════════════════
  // Une stratégie retirée de la circulation n'ouvre plus AUCUNE position. Le contrôle est ici, dans le
  // goulot par lequel passe TOUTE création d'ordre — scalp, breakout, swing, modes show — plutôt que
  // dispersé sur chaque chemin d'entrée, où il suffirait d'en oublier un pour que la stratégie continue
  // de trader l'argent des membres. On lève une erreur : les appelants la traitent déjà comme un refus
  // broker et enregistrent le signal en 'rejected', donc la trace reste.
  // Les positions DÉJÀ OUVERTES ne sont pas touchées : elles gardent leur gestion (stop, paliers,
  // trailing) jusqu'à leur sortie normale. On ne liquide rien dans le dos des membres.
  if (inMaintenance(ACTIVE_STRATEGY.id)) throw new Error(`strategy S${ACTIVE_STRATEGY.id} is in maintenance — no new positions`);
  const { sl, tp, lot } = prepareOrder(stream, s, symbol);
  const opts = { comment: 'algoria' }; // PAS de clientId : MetaApi impose un pattern strict et on suit nos trades par positionId
  const result =
    s.direction === 'long'
      ? await stream.createMarketBuyOrder(symbol, lot, sl, tp, opts)
      : await stream.createMarketSellOrder(symbol, lot, sl, tp, opts);
  return { ticket: result.positionId ?? result.orderId, code: result.stringCode };
}

/** Ferme une position précise (mode Action : clôture programmée). */
export async function closePosition(stream: any, ticket: string) {
  return stream.closePosition(String(ticket), {});
}

/** Ferme TOUTES les positions ouvertes sur le symbole (bouton « close all »). */
export async function closeAll(stream: any, symbol: string) {
  return stream.closePositionsBySymbol(symbol, {});
}
