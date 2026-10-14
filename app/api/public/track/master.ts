// LES JOURS DU MASTER (14/10/2026) — sortis de route.ts pour servir aussi la liste trade par trade
// (/api/public/track/trades). Une seule lecture, un seul calcul : le total du mois et la liste qu'on déplie
// dessous ne peuvent pas se contredire.
//
// Par jour DE PARIS (14/10/2026, voir lib/display/tradingDay.ts ; jour UTC jusque-là) : les trades COPIÉS du master (mêmes exclusions que le récap du canal et l'onglet History :
// micro-scalps de démonstration, NAS100, autres stratégies), son VRAI solde au début du jour (state_snapshots,
// via la fonction SQL master_paris_day_balances) et le swap. La table trades n'enregistre que le profit du deal :
// le swap se retrouve dans l'écart de solde que les trades n'expliquent pas. Au-delà de FEE_MAX_SHARE du solde,
// cet écart est un dépôt ou un retrait (`cash`), qui ne compte pas dans le rendement.
import { isShowTrade } from '@/lib/cockpit/showTrades';
import { LIVE_STRATEGY } from '@/lib/member/maintenance';
import { tradingDayOf, tradingDayStartMs } from '@/lib/display/tradingDay';

const FEE_MAX_SHARE = 0.02;

export type MasterTrade = {
  ticket: string; symbol: string; direction: string | null; entry: number | null; exit: number | null;
  pnl: number; lot: number | null; strategy: number | null; reason: string | null; opened_at: string | null; closed_at: string;
};
/** base = solde au début du jour (null si aucun relevé ce jour-là) ; fee = swap du jour, en dollars du compte. */
export type MasterDay = { d: string; base: number | null; fee: number; cash: number; trades: MasterTrade[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (f: string, a: object) => any };

/** Jours du master de `fromDay` (inclus) à `toDay` (exclu, facultatif), du plus ancien au plus récent. */
export async function loadMaster(db: Db, fromDay: string, toDay?: string): Promise<{ days: MasterDay[]; last: { close: number; ts: string } | null }> {
  const fromIso = new Date(tradingDayStartMs(fromDay)).toISOString();
  const all: MasterTrade[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from('trades').select('ticket,symbol,direction,entry,exit,pnl,lot,strategy,reason,opened_at,closed_at')
      .not('closed_at', 'is', null).not('pnl', 'is', null).gte('closed_at', fromIso);
    if (toDay) q = q.lt('closed_at', new Date(tradingDayStartMs(toDay)).toISOString());
    const { data, error } = await q.order('closed_at', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as MasterTrade[]));
    if (!data || data.length < 1000) break;
  }
  const { data: sig } = await db.from('signals').select('ticket,rationale').gte('created_at', fromIso).limit(5000);
  const rafale = new Set(((sig ?? []) as Array<{ ticket: string; rationale: unknown }>)
    .filter((x) => { const j = JSON.stringify(x.rationale ?? ''); return j.includes('RAFALE') || j.includes('ACTION mode'); }).map((x) => String(x.ticket)));
  const copied = (t: MasterTrade) => !isShowTrade(t, rafale) && String(t.symbol) !== 'NAS100' && Number(t.strategy ?? 2) === LIVE_STRATEGY;
  const { data: balRows, error: balErr } = await db.rpc('master_paris_day_balances', { since: fromIso });
  if (balErr) throw new Error(balErr.message);
  const bals = new Map(((balRows ?? []) as Array<{ d: string; b_open: number; b_close: number; last_ts: string }>)
    .map((b) => [String(b.d).slice(0, 10), { open: Number(b.b_open), close: Number(b.b_close), ts: b.last_ts }]));

  const inRange = (d: string) => d >= fromDay && (!toDay || d < toDay);
  const dayOf = new Map(all.map((t) => [t, tradingDayOf(t.closed_at)]));
  const dayKeys = [...new Set([...dayOf.values(), ...bals.keys()])].filter(inRange).sort();
  const days: MasterDay[] = [];
  for (const d of dayKeys) {
    const b = bals.get(d);
    const mine = all.filter((t) => dayOf.get(t) === d);
    const kept = mine.filter(copied);
    const next = bals.get(new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
    // écart de solde du jour (jusqu'au premier relevé du lendemain) moins TOUS les trades clôturés, démonstration comprise
    const rest = b ? (next?.open ?? b.close) - b.open - mine.reduce((s, t) => s + Number(t.pnl), 0) : 0;
    const isFee = b != null && Math.abs(rest) <= FEE_MAX_SHARE * b.open;
    if (!kept.length && Math.abs(rest) < 0.005) continue;
    days.push({ d, base: b ? b.open : null, fee: isFee ? rest : 0, cash: isFee ? 0 : rest, trades: kept });
  }
  const lastBal = [...bals.values()].at(-1);
  return { days, last: lastBal ? { close: lastBal.close, ts: lastBal.ts } : null };
}
