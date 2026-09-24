import { NextResponse } from 'next/server';
import { sdb } from '@/lib/member/server';
import { SOURCE_TRACK_START } from '@/lib/track/source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// TRACK RECORD RÉEL (24/09/2026) — l'historique du compte source qu'Algoria 2.0 copie, façon Myfxbook.
// Données : source_deals, remplie par le runner (runner/sourceHistory.ts) en lecture seule toutes les 6 h.
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
//     (trades et mouvements d'espèces) — le compte ne donne pas de solde historique, mais la somme exacte.
// Deux décimales partout : à 0.01 lot un jour vaut souvent quelques dollars.
const EXIT = new Set(['DEAL_ENTRY_OUT', 'DEAL_ENTRY_INOUT']);
const r2 = (x: number) => Math.round(x * 100) / 100;

export async function GET() {
  const db = sdb() as unknown as { from: (t: string) => any };
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

  const byDay = new Map<string, { u: number; net: number; cash: number; n: number; w: number }>();
  let sinceNet = 0;
  // PIRE CREUX AU TRADE PRÈS, PAS À LA JOURNÉE (24/09/2026). Agréger par jour lisse les creux
  // intra-journée : sur ce compte, −9,7 % à la journée contre −16,6 % trade par trade. C'est précisément
  // le chiffre qu'une page de track record ne doit pas embellir, donc il se calcule ici, deal par deal :
  //   · en % sur un indice chaîné (chaque résultat rapporté au solde d'avant) — un dépôt n'efface aucun creux ;
  //   · en $ sur la courbe ramenée à 1 lot — l'écran le multiplie par le lot choisi (la courbe est linéaire en lot).
  // Le solde de départ n'est connu qu'après la boucle ; on la parcourt donc une 2e fois plus bas.
  for (const d of rows) {
    const day = d.time.slice(0, 10);
    const cur = byDay.get(day) ?? { u: 0, net: 0, cash: 0, n: 0, w: 0 };
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
    byDay.set(day, cur);
  }
  const startBalance = Number(account.balance) - sinceNet;
  let bal = startBalance, idx = 1, peakIdx = 1, ddPct = 0, cumU = 0, peakU = 0, ddU = 0;
  for (const d of rows) {
    if (d.type === 'DEAL_TYPE_BALANCE') { bal += Number(d.profit ?? 0); continue; }
    const exit = d.entry_type ? EXIT.has(d.entry_type) : false;
    const net = exit ? Number(d.profit ?? 0) + Number(d.commission ?? 0) + Number(d.swap ?? 0) : Number(d.commission ?? 0) + Number(d.swap ?? 0);
    if (!net) continue;
    const lot = Number(d.volume) > 0 ? Number(d.volume) : 1;
    if (bal > 0) idx *= 1 + net / bal;
    bal += net;
    peakIdx = Math.max(peakIdx, idx); ddPct = Math.min(ddPct, (idx / peakIdx - 1) * 100);
    cumU += net / lot; peakU = Math.max(peakU, cumU); ddU = Math.min(ddU, cumU - peakU);
  }
  const days = [...byDay.entries()].map(([d, v]) => ({ d, u: r2(v.u), net: r2(v.net), cash: r2(v.cash), n: v.n, w: v.w }));
  const res = NextResponse.json({
    since: SOURCE_TRACK_START,
    updatedAt: account.updated_at,
    currency: account.currency ?? 'USD',
    startBalance: r2(startBalance),
    balance: r2(Number(account.balance)),
    maxDdPct: r2(ddPct), // ≤ 0, trade par trade
    maxDdU: r2(ddU),     // ≤ 0, en $ à 1 lot — × lot choisi à l'écran
    days,
  });
  // la donnée ne bouge que toutes les 6 h : un cache CDN de 10 min suffit largement
  res.headers.set('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  return res;
}
