import * as Sdk from 'metaapi.cloud-sdk/esm-node';
import { recordTradeClose } from '../../lib/supabase/sync';
import { pushToAll } from '../../lib/push/send';
import { postVip, VIP_TAG, usd } from '../telegram';
import type { Signal } from '../../lib/engine/types';

// Push "WIN" vers les membres (PWA) — 70/30 : jamais de push sur une perte. Anti-spam : seuil $ + cooldown.
const WIN_PUSH_MIN = Number(process.env.PUSH_WIN_MIN_USD ?? 100); // en dessous, pas de notif (sinon ~20/jour)
const WIN_PUSH_COOLDOWN_MS = 20 * 60_000;
let lastWinPush = 0;
function maybePushWin(displaySymbol: string, pnl: number) {
  if (pnl < WIN_PUSH_MIN || Date.now() - lastWinPush < WIN_PUSH_COOLDOWN_MS) return;
  lastWinPush = Date.now();
  void pushToAll({
    title: `✓ +$${Math.round(pnl)} on ${displaySymbol}`,
    body: 'Algoria just cashed a win — copied to your account.',
    url: '/member',
    tag: 'algoria-win',
  }).then((n) => n && console.log(`[algoria] push win +$${Math.round(pnl)} → ${n} appareil(s)`)).catch(() => {});
}

// ===== ANNONCES VIP PAR TRADE — le canal VIT : chaque runner poste SES clôtures avec son étiquette.
// Gains : dès VIP_WIN_MIN (les scratchs BE ne spamment pas). Pertes : pédagogie « le stop a fait son travail »,
// max 3/jour/stratégie (au-delà, le message « journée coupée » du latch prend le relais).
const VIP_WIN_MIN = Number(process.env.VIP_WIN_MIN_USD ?? 150);
const VIP_SL_MAX_PER_DAY = 3;
let vipSlDay = '';
let vipSlCount = 0;
const SL_NOTES = [
  "The stop was set before entry — that's the max this trade could ever lose. Losses are capped, winners run.",
  'Defined risk did its job: one controlled loss, capital protected, on to the next setup.',
  'No stop-loss would mean unlimited risk. This is the cost of doing business — bounded and planned.',
];
function vipTradeClose(displaySymbol: string, pnl: number, reason: string, entry?: number, exit?: number) {
  const px = entry != null && exit ? `<i>${displaySymbol} · ${entry} → ${exit}</i>\n` : `<i>${displaySymbol}</i>\n`;
  if (pnl >= VIP_WIN_MIN) {
    const how = reason === 'tp' ? 'target hit' : reason === 'trail' ? 'profit locked by trailing stop' : 'banked';
    // Carte GAIN — titre chiffré en gras, contexte en italique, promesse de copie en clôture.
    void postVip(`✅ <b>+${usd(pnl)}</b> · ${VIP_TAG}\n${px}<i>${how}</i>\n\nMaster-account scale — copied to your size automatically.`);
  } else if (reason === 'sl' && pnl < 0) {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== vipSlDay) { vipSlDay = day; vipSlCount = 0; }
    if (vipSlCount >= VIP_SL_MAX_PER_DAY) return;
    vipSlCount++;
    // Carte STOP — perte bornée, note pédagogique tournante en italique (« le stop a fait son travail »).
    void postVip(`🛡️ <b>−${usd(pnl)}</b> · ${VIP_TAG}\n${px}\n<i>${SL_NOTES[vipSlCount % SL_NOTES.length]}</i>`);
  }
}

// La classe de base (toutes ses méthodes sont des no-op) est exposée en named export sur la build esm-node.
const Base: any = (Sdk as any).SynchronizationListener ?? (Sdk as any).default?.SynchronizationListener;

interface TradeCtx {
  entry: number;
  sl: number;
  tp: number;
  direction: 'long' | 'short';
}

/**
 * Enregistre la CLÔTURE des trades dans Supabase à partir des deals MetaApi.
 * - Filtre par ANCIENNETÉ (deal < 5 min) : on ignore l'historique rejoué à la connexion mais on capte TOUTES les
 *   clôtures live, même juste après un redémarrage du runner (le filtre onDealsSynchronized ratait des clôtures).
 * - L'ouverture est écrite ailleurs (runner/index.ts au moment du placeSignal), où l'on a déjà le SL pour le R.
 */
export class DealRecorder extends Base {
  private readonly ctx = new Map<string, TradeCtx>(); // positionId → contexte (pour calculer R + reason)

  constructor(private readonly brokerSymbol: string, private readonly displaySymbol: string) {
    super();
  }

  /** Mémorise entry/SL/TP d'une position fraîchement ouverte → permet de calculer R et d'inférer la raison de sortie. */
  remember(ticket: string, s: Signal) {
    this.ctx.set(ticket, { entry: s.entry, sl: s.stopLoss, tp: s.takeProfits[0], direction: s.direction });
  }

  async onDealAdded(_instanceIndex: string, deal: any): Promise<void> {
    if (deal?.symbol !== this.brokerSymbol) return;
    if (deal?.type !== 'DEAL_TYPE_BUY' && deal?.type !== 'DEAL_TYPE_SELL') return; // ignore balance/commission/etc.
    if (deal?.entryType === 'DEAL_ENTRY_IN') return; // l'ouverture est gérée par le runner (placeSignal)

    const ticket = deal.positionId ? String(deal.positionId) : String(deal.id);
    const exit = typeof deal.price === 'number' ? deal.price : 0;
    const pnl = typeof deal.profit === 'number' ? deal.profit : 0;
    const when = deal.time ? new Date(deal.time).getTime() : Date.now();
    if (Date.now() - when > 5 * 60_000) return; // deal ancien → historique rejoué, on ignore (recordTradeClose reste idempotent)

    const c = this.ctx.get(ticket);
    let r: number | null = null;
    let reason: string;
    if (c) {
      const dir = c.direction === 'long' ? 1 : -1;
      const riskDist = Math.abs(c.entry - c.sl);
      if (riskDist) r = (dir * (exit - c.entry)) / riskDist;
      reason = this.inferReason(exit, c);
      this.ctx.delete(ticket);
    } else {
      reason = pnl >= 0 ? 'win' : 'loss'; // position ouverte avant ce process → on ne connaît pas le SL initial
    }

    await recordTradeClose(ticket, this.displaySymbol, { exit, pnl, r, reason, closedAt: when });
    if (pnl > 0) maybePushWin(this.displaySymbol, pnl);
    vipTradeClose(this.displaySymbol, pnl, reason, c?.entry, exit);
  }

  /** Raison de sortie par proximité : TP, SL, breakeven — ou TRAIL (stop verrouillé NET au-dessus de l'entrée,
   *  même convention que le simulateur : > 0.1 × risque en profit). */
  private inferReason(exit: number, c: TradeCtx): string {
    const dEntry = Math.abs(exit - c.entry);
    const dTp = Math.abs(exit - c.tp);
    const dSl = Math.abs(exit - c.sl);
    const min = Math.min(dEntry, dTp, dSl);
    if (min === dTp) return 'tp';
    const dir = c.direction === 'long' ? 1 : -1;
    const riskDist = Math.abs(c.entry - c.sl);
    if (riskDist && (dir * (exit - c.entry)) / riskDist > 0.1) return 'trail';
    if (min === dEntry) return 'be';
    return 'sl';
  }
}
