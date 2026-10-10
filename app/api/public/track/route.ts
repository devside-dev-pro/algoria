import { NextResponse } from 'next/server';
import { sdb } from '@/lib/member/server';
import { MASTER_TRACK_FROM, SOURCE_TRACK_START } from '@/lib/track/source';
import { isShowTrade } from '@/lib/cockpit/showTrades';
import { LIVE_STRATEGY } from '@/lib/member/maintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// TRACK RECORD RÉEL (24/09/2026) — l'historique du compte source qu'Algoria 2.0 copie, façon Myfxbook.
// Données : source_deals, remplie par le runner (runner/sourceHistory.ts) en lecture seule toutes les 6 h.
//
// À PARTIR DU 1er OCTOBRE 2026 (MASTER_TRACK_FROM, décision Mathieu du 10/10) : chaque jour est celui du MASTER,
// le compte que les membres copient. Ses trades copiés viennent de la table trades (mêmes exclusions que le
// récap du canal et l'onglet History : micro-scalps de démonstration, NAS100, autres stratégies) ; son vrai
// solde, de state_snapshots (le runner l'écrit toutes les 60 s, lu ici jour par jour via master_day_balances).
// Voir lib/track/source.ts pour le pourquoi.
//
// Ce que la route renvoie, et pourquoi sous cette forme :
//   · un point PAR JOUR, pas un par trade (~1 400 trades depuis juillet, ~90 jours) : léger, et c'est la
//     maille d'une courbe de compte ;
//   · `u` = le P&L du jour RAMENÉ À 1 LOT, trade par trade (net ÷ lot de la sortie). C'est ce qui permet
//     au sélecteur de lot de l'écran de tout recalculer côté client : montant à L lots = u × L. Diviser le
//     net du jour par un lot moyen serait faux — le compte a tradé de 0.01 à 11 lots ;
//   · `net` = le résultat réel du jour en dollars du compte, pour la vue en POURCENTAGE, qui est le
//     rendement réel du compte et ne dépend d'aucun lot ;
//   · `startBalance` = solde au premier jour, déduit du solde actuel moins tout ce qui s'est passé depuis
//     (trades et mouvements d'espèces) — le compte ne donne pas de solde historique, mais la somme exacte ;
//   · `base` (jours du master seulement) = le VRAI solde du master au début du jour. L'écran repart de lui
//     au lieu de chaîner : c'est ce qui fait passer le % du solde du compte source (~400 k$) à celui du
//     master, et ce qui neutralise ce que le % ne doit pas compter (dépôts, retraits, trades de démonstration).
// Deux décimales partout : à 0.01 lot un jour vaut souvent quelques dollars.
const EXIT = new Set(['DEAL_ENTRY_OUT', 'DEAL_ENTRY_INOUT']);
const r2 = (x: number) => Math.round(x * 100) / 100;
const lotOf = (lot: unknown) => (Number(lot) > 0 ? Number(lot) : 1);
// Écart de solde non expliqué par les trades d'un jour : du swap tant qu'il reste petit, un dépôt ou un retrait
// au-delà. En octobre : −192 $ (triple swap), −8,40 $, −6 $ — total −206,40 $, le swap du MetaTrader 5.
const FEE_MAX_SHARE = 0.02;

type MasterTrade = { ticket: string; symbol: string; pnl: number; lot: number | null; strategy: number | null; closed_at: string };
type Day = { d: string; u: number; net: number; cash: number; n: number; w: number; base?: number };

export async function GET() {
  const db = sdb() as unknown as { from: (t: string) => any; rpc: (f: string, a: object) => any };
  const rows: Array<{ time: string; type: string; entry_type: string | null; volume: number | null; profit: number | null; commission: number | null; swap: number | null }> = [];
  // PostgREST plafonne à 1 000 lignes par requête : on pagine
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('source_deals')
      .select('time,type,entry_type,volume,profit,commission,swap')
      .gte('time', SOURCE_TRACK_START).order('time', { ascending: true }).range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: acc } = await db.from('source_account').select('balance,equity,currency,updated_at').limit(1);
  const account = (acc as Array<{ balance: number | null; equity: number | null; currency: string | null; updated_at: string }> | null)?.[0];
  if (!account || account.balance == null) return NextResponse.json({ error: 'no data yet' }, { status: 503 });

  // ── LE MASTER, à partir de MASTER_TRACK_FROM ──────────────────────────────────────────────────────────
  const masterFrom = `${MASTER_TRACK_FROM}T00:00:00Z`;
  const allTrades: MasterTrade[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('trades').select('ticket,symbol,pnl,lot,strategy,closed_at')
      .not('closed_at', 'is', null).not('pnl', 'is', null).gte('closed_at', masterFrom)
      .order('closed_at', { ascending: true }).range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    allTrades.push(...((data ?? []) as MasterTrade[]));
    if (!data || data.length < 1000) break;
  }
  const { data: sig } = await db.from('signals').select('ticket,rationale').gte('created_at', masterFrom).limit(5000);
  const rafale = new Set(((sig ?? []) as Array<{ ticket: string; rationale: unknown }>)
    .filter((x) => { const j = JSON.stringify(x.rationale ?? ''); return j.includes('RAFALE') || j.includes('ACTION mode'); }).map((x) => String(x.ticket)));
  const copied = (t: MasterTrade) => !isShowTrade(t, rafale) && String(t.symbol) !== 'NAS100' && Number(t.strategy ?? 2) === LIVE_STRATEGY;
  const { data: balRows, error: balErr } = await db.rpc('master_day_balances', { since: masterFrom });
  if (balErr) return NextResponse.json({ error: balErr.message }, { status: 500 });
  const bals = new Map(((balRows ?? []) as Array<{ d: string; b_open: number; b_close: number; last_ts: string }>)
    .map((b) => [String(b.d).slice(0, 10), { open: Number(b.b_open), close: Number(b.b_close), ts: b.last_ts }]));

  const byDay = new Map<string, Day>();
  let sinceNet = 0;
  // PIRE CREUX AU TRADE PRÈS, PAS À LA JOURNÉE (24/09/2026). Agréger par jour lisse les creux
  // intra-journée : sur ce compte, −9,7 % à la journée contre −16,6 % trade par trade. C'est précisément
  // le chiffre qu'une page de track record ne doit pas embellir, donc il se calcule ici, deal par deal :
  //   · en % sur un indice chaîné (chaque résultat rapporté au solde d'avant) — un dépôt n'efface aucun creux ;
  //   · en $ sur la courbe ramenée à 1 lot — l'écran le multiplie par le lot choisi (la courbe est linéaire en lot).
  // Le solde de départ n'est connu qu'après la boucle ; on la parcourt donc une 2e fois plus bas.
  // Le compte source est lu JUSQU'AU BOUT pour `sinceNet` (le solde de départ en dépend), mais ses jours
  // s'arrêtent à MASTER_TRACK_FROM.
  for (const d of rows) {
    const day = d.time.slice(0, 10);
    const shown = day < MASTER_TRACK_FROM;
    const cur = byDay.get(day) ?? { d: day, u: 0, net: 0, cash: 0, n: 0, w: 0 };
    if (d.type === 'DEAL_TYPE_BALANCE') {
      // dépôt ou retrait : ce n'est PAS de la performance — il bouge le solde, jamais le rendement
      cur.cash += Number(d.profit ?? 0);
      sinceNet += Number(d.profit ?? 0);
    } else if (d.entry_type && EXIT.has(d.entry_type)) {
      const net = Number(d.profit ?? 0) + Number(d.commission ?? 0) + Number(d.swap ?? 0);
      const lot = Number(d.volume) > 0 ? Number(d.volume) : 1;
      cur.u += net / lot;
      cur.net += net;
      cur.n += 1;
      if (net > 0) cur.w += 1;
      sinceNet += net;
    } else {
      // la commission d'ouverture est un coût réel du trade
      const fee = Number(d.commission ?? 0) + Number(d.swap ?? 0);
      if (fee) { cur.net += fee; sinceNet += fee; const lot = Number(d.volume) > 0 ? Number(d.volume) : 1; cur.u += fee / lot; }
    }
    if (shown) byDay.set(day, cur);
  }
  const startBalance = Number(account.balance) - sinceNet;
  let bal = startBalance, idx = 1, peakIdx = 1, ddPct = 0, cumU = 0, peakU = 0, ddU = 0;
  const step = (net: number, u: number) => {
    if (bal > 0) idx *= 1 + net / bal;
    bal += net;
    peakIdx = Math.max(peakIdx, idx); ddPct = Math.min(ddPct, (idx / peakIdx - 1) * 100);
    cumU += u; peakU = Math.max(peakU, cumU); ddU = Math.min(ddU, cumU - peakU);
  };
  for (const d of rows) {
    if (d.time.slice(0, 10) >= MASTER_TRACK_FROM) break;
    if (d.type === 'DEAL_TYPE_BALANCE') { bal += Number(d.profit ?? 0); continue; }
    const exit = d.entry_type ? EXIT.has(d.entry_type) : false;
    const net = exit ? Number(d.profit ?? 0) + Number(d.commission ?? 0) + Number(d.swap ?? 0) : Number(d.commission ?? 0) + Number(d.swap ?? 0);
    if (!net) continue;
    step(net, net / (Number(d.volume) > 0 ? Number(d.volume) : 1));
  }

  // Jours du master : trades copiés + swap (l'écart de solde que les trades n'expliquent pas), sur son vrai solde.
  const masterDays = [...new Set([...allTrades.map((t) => t.closed_at.slice(0, 10)), ...bals.keys()])].sort();
  for (const day of masterDays) {
    const b = bals.get(day);
    const mine = allTrades.filter((t) => t.closed_at.slice(0, 10) === day);
    const kept = mine.filter(copied);
    const next = bals.get(new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
    // écart de solde du jour (jusqu'au premier solde du lendemain) moins TOUS les trades clôturés, démonstration comprise
    const rest = b ? (next?.open ?? b.close) - b.open - mine.reduce((s, t) => s + Number(t.pnl), 0) : 0;
    const isFee = b != null && Math.abs(rest) <= FEE_MAX_SHARE * b.open;
    const fee = isFee ? rest : 0;
    const cash = isFee ? 0 : rest;
    if (!kept.length && Math.abs(rest) < 0.005) continue;
    const cur: Day = { d: day, u: 0, net: 0, cash, n: kept.length, w: kept.filter((t) => Number(t.pnl) > 0).length, ...(b ? { base: b.open } : {}) };
    if (b) bal = b.open;
    for (const t of kept) {
      const pnl = Number(t.pnl);
      cur.net += pnl; cur.u += pnl / lotOf(t.lot);
      step(pnl, pnl / lotOf(t.lot));
    }
    // swap compté à 1 lot, la taille du master (101 trades sur 103 en octobre)
    if (fee) { cur.net += fee; cur.u += fee; step(fee, fee); }
    byDay.set(day, cur);
  }
  const lastBal = [...bals.values()].at(-1);

  const days = [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d))
    .map((v) => ({ d: v.d, u: r2(v.u), net: r2(v.net), cash: r2(v.cash), n: v.n, w: v.w, ...(v.base != null ? { base: r2(v.base) } : {}) }));
  const res = NextResponse.json({
    since: SOURCE_TRACK_START,
    masterFrom: MASTER_TRACK_FROM,
    updatedAt: lastBal?.ts ?? account.updated_at,
    currency: account.currency ?? 'USD',
    startBalance: r2(startBalance),
    balance: r2(lastBal?.close ?? Number(account.balance)),
    maxDdPct: r2(ddPct), // ≤ 0, trade par trade
    maxDdU: r2(ddU),     // ≤ 0, en $ à 1 lot — × lot choisi à l'écran
    days,
  });
  // le master bouge en continu : un cache CDN de 10 min (l'écran l'annonce)
  res.headers.set('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  return res;
}
