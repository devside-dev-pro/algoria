import 'dotenv/config';
// RÉGÉNÈRE LA FIXTURE DE PARITÉ DEPUIS LE LIVE (02/09/2026).
//
// POURQUOI CE FICHIER EXISTE. backtest/fixtures/live-daily.json était extrait À LA MAIN. Résultat : figé au
// 31/07 pendant cinq semaines, donc le test de parité ne voyait NI août (−27 568 $ sur l'or) NI septembre.
// L'outil censé répondre à « est-ce que le backtest colle à la réalité ? » comparait le simulateur à une
// réalité vieille de cinq semaines — et personne ne pouvait s'en apercevoir en lisant sa sortie.
// Une fixture qu'on doit penser à rafraîchir est une fixture qui sera périmée. Elle se régénère maintenant.
//
// CE QU'ELLE CONTIENT EN PLUS : la répartition des SORTIES (sl / be / trail / tp / …). C'est le seul angle
// qui teste ce qu'on reproche au simulateur — en live, 54 % des swings or et 44 % des scalps finissent au
// breakeven. Si le sim n'en produit pas autant, son modèle de sortie est faux et TOUS ses chiffres avec.
// Le P&L journalier seul ne pouvait pas le montrer : deux distributions très différentes peuvent donner
// la même somme.
//
//   tsx scripts/pull-live-fixture.ts            → tout l'historique
//   tsx scripts/pull-live-fixture.ts 2026-08-01 → depuis une date
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const since = process.argv[2] ?? '2000-01-01';

type Row = { signal_ref: string | null; symbol: string; closed_at: string; pnl: number | null; reason: string | null; strategy: number | null; lot: number | null };

/** Couche déduite du signal_ref, comme le runner la nomme : *-swing-*, *-bk-*, sinon scalp. */
const layerOf = (ref: string | null): string => {
  const r = (ref ?? '').toLowerCase();
  if (r.includes('-trend-')) return 'trend';
  if (r.includes('swing')) return 'swing';
  if (r.includes('-bk-') || r.includes('break')) return 'breakout';
  return 'scalp';
};

async function main() {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('trades')
      .select('signal_ref,symbol,closed_at,pnl,reason,strategy,lot')
      .not('closed_at', 'is', null)
      .gte('closed_at', since)
      .order('closed_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`lecture Supabase: ${error.message}`);
    if (!data?.length) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  if (!rows.length) { console.error('[fixture] aucun trade clos trouvé.'); process.exit(1); }

  // 1) P&L par JOUR × stratégie × couche × symbole — la comparaison historique, en gardant le symbole
  //    cette fois : la v1 était implicitement XAUUSD et rien ne le disait dans la donnée.
  const dayKey = new Map<string, { day: string; strategy: number; layer: string; symbol: string; n: number; pnl: number }>();
  // 2) Répartition des SORTIES — l'angle qui manquait.
  const exitKey = new Map<string, { symbol: string; layer: string; strategy: number; reason: string; n: number; pnl: number }>();

  for (const t of rows) {
    const day = t.closed_at.slice(0, 10);
    const layer = layerOf(t.signal_ref);
    const strategy = t.strategy ?? 2;
    const pnl = Number(t.pnl ?? 0);
    const reason = t.reason ?? 'inconnu';

    const dk = `${day}|${strategy}|${layer}|${t.symbol}`;
    const d = dayKey.get(dk) ?? { day, strategy, layer, symbol: t.symbol, n: 0, pnl: 0 };
    d.n++; d.pnl += pnl; dayKey.set(dk, d);

    const ek = `${t.symbol}|${layer}|${strategy}|${reason}`;
    const e = exitKey.get(ek) ?? { symbol: t.symbol, layer, strategy, reason, n: 0, pnl: 0 };
    e.n++; e.pnl += pnl; exitKey.set(ek, e);
  }

  const days = [...dayKey.values()].map((d) => ({ ...d, pnl: Math.round(d.pnl) })).sort((a, b) => a.day.localeCompare(b.day));
  const exits = [...exitKey.values()].map((e) => ({ ...e, pnl: Math.round(e.pnl) })).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.layer.localeCompare(b.layer) || b.n - a.n);

  const out = {
    generatedAt: new Date().toISOString(),
    from: days[0].day,
    to: days[days.length - 1].day,
    trades: rows.length,
    days,
    exits,
  };
  mkdirSync('backtest/fixtures', { recursive: true });
  writeFileSync('backtest/fixtures/live-daily.json', JSON.stringify(out, null, 1));
  console.log(`✅ fixture régénérée : ${rows.length} trades clos, ${out.from} → ${out.to}`);
  console.log(`   ${days.length} lignes jour×strat×couche×symbole · ${exits.length} lignes de sorties`);
  const or = exits.filter((e) => e.symbol === 'XAUUSD' && e.layer === 'swing');
  const nOr = or.reduce((s, e) => s + e.n, 0);
  for (const e of or) console.log(`   or swing · ${e.reason.padEnd(10)} ${String(e.n).padStart(4)} (${Math.round((100 * e.n) / nOr)}%)  $${e.pnl}`);
  process.exit(0);
}
main().catch((e) => { console.error('[fixture] crash:', e); process.exit(1); });
