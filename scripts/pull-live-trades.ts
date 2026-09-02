import 'dotenv/config';
// EXPORTE LES TRADES LIVE BRUTS POUR LE TRIBUNAL DES ENTRÉES (02/09/2026) — voir backtest/replay.ts.
//
// POURQUOI UN DEUXIÈME EXPORT à côté de pull-live-fixture.ts : la fixture de parité est AGRÉGÉE (P&L par
// jour, répartition des sorties). Elle sert à juger le simulateur. Ici on a besoin de chaque trade avec
// son heure d'entrée, son prix, son stop et sa direction, pour rejouer la position sur les bougies M1
// sous d'autres règles de sortie. Aucun secret dans le fichier produit : des prix et des horodatages.
//
//   tsx scripts/pull-live-trades.ts               → depuis le 2026-07-01 (début de l'historique exploitable)
//   tsx scripts/pull-live-trades.ts 2026-08-01    → depuis une date
//
// STOP INITIAL (correction du 02/09, soir). `trades.sl` est le stop COURANT : le runner le réécrit à chaque
// breakeven / palier / trailing (sync.ts updateTradeStop). Sur un trade sorti au BE il vaut ~l'entrée, et
// tout ce qui est exprimé en R devient faux (première version du tribunal : +150 R pour −18 591 $). Le
// stop D'ORIGINE vit dans `signals.stop_loss` — c'est aussi là que le runner va le rechercher pour restaurer
// sa gestion après un redémarrage (listOpenTradesWithInitialStop). Même jointure ici : par `ref`, en
// préférant la ligne de la même stratégie, avec repli sur une autre (jusqu'au 04/08 un index unique sur
// `ref` seul faisait perdre leur ligne à deux runners sur trois ; le stop d'un signal ne dépend pas de la
// stratégie). La colonne `r` de `trades` a le même défaut : le rejeu recalcule R depuis le P&L.
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const since = process.argv[2] ?? '2026-07-01';

export interface LiveTrade {
  ref: string | null;
  symbol: string;
  strategy: number;
  dir: 'long' | 'short';
  openedAt: string;
  closedAt: string;
  entry: number;
  exit: number | null;
  sl: number | null; // stop COURANT à la clôture (après BE/paliers/trailing) — inutilisable pour le risque
  sl0: number | null; // stop INITIAL du signal (signals.stop_loss) — la seule base valable pour le R
  lot: number;
  pnl: number;
  r: number | null;
  reason: string;
}

type Row = { signal_ref: string | null; symbol: string; direction: string; opened_at: string | null; closed_at: string; entry: number | null; exit: number | null; sl: number | null; lot: number | null; pnl: number | null; r: number | null; reason: string | null; strategy: number | null };

async function main() {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('trades')
      .select('signal_ref,symbol,direction,opened_at,closed_at,entry,exit,sl,lot,pnl,r,reason,strategy')
      .not('closed_at', 'is', null)
      .gte('closed_at', since)
      .order('closed_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`lecture Supabase: ${error.message}`);
    if (!data?.length) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  if (!rows.length) { console.error('[trades] aucun trade clos trouvé.'); process.exit(1); }

  // Stops initiaux : signals.stop_loss par ref, ligne de la même stratégie de préférence.
  const refs = [...new Set(rows.map((r) => r.signal_ref).filter((r): r is string => !!r))];
  const sigByRef = new Map<string, Array<{ strategy: number | null; stop_loss: number | null }>>();
  for (let i = 0; i < refs.length; i += 200) {
    const { data, error } = await db.from('signals').select('ref,stop_loss,strategy' as never).in('ref', refs.slice(i, i + 200));
    if (error) throw new Error(`lecture signals: ${error.message}`);
    for (const s of (data ?? []) as unknown as Array<{ ref: string; stop_loss: number | null; strategy: number | null }>) {
      const a = sigByRef.get(s.ref) ?? [];
      a.push({ strategy: s.strategy, stop_loss: s.stop_loss });
      sigByRef.set(s.ref, a);
    }
  }
  const initialStop = (ref: string | null, strategy: number): number | null => {
    const a = ref ? sigByRef.get(ref) : undefined;
    if (!a?.length) return null;
    const own = a.find((s) => Number(s.strategy) === strategy && s.stop_loss != null) ?? a.find((s) => s.stop_loss != null);
    return own?.stop_loss != null ? Number(own.stop_loss) : null;
  };

  let skipped = 0;
  const trades: LiveTrade[] = [];
  for (const t of rows) {
    // Sans heure d'entrée ou sans prix d'entrée, le trade ne peut pas être rejoué — on le compte, on ne le cache pas.
    if (!t.opened_at || t.entry == null || (t.direction !== 'long' && t.direction !== 'short')) { skipped++; continue; }
    trades.push({
      ref: t.signal_ref, symbol: t.symbol, strategy: t.strategy ?? 2, dir: t.direction,
      openedAt: t.opened_at, closedAt: t.closed_at,
      entry: Number(t.entry), exit: t.exit == null ? null : Number(t.exit), sl: t.sl == null ? null : Number(t.sl),
      sl0: initialStop(t.signal_ref, t.strategy ?? 2),
      lot: Number(t.lot ?? 1), pnl: Number(t.pnl ?? 0), r: t.r == null ? null : Number(t.r), reason: t.reason ?? 'inconnu',
    });
  }

  const out = { generatedAt: new Date().toISOString(), since, trades: trades.length, skipped, rows: trades };
  mkdirSync('backtest/fixtures', { recursive: true });
  writeFileSync('backtest/fixtures/live-trades.json', JSON.stringify(out));
  const by = new Map<string, number>();
  for (const t of trades) by.set(`${t.symbol}·S${t.strategy}`, (by.get(`${t.symbol}·S${t.strategy}`) ?? 0) + 1);
  const noSl0 = trades.filter((t) => t.sl0 == null).length;
  console.log(`✅ ${trades.length} trades écrits dans backtest/fixtures/live-trades.json (${skipped} ignorés : sans heure/prix d'entrée · ${noSl0} sans stop initial dans signals → non rejouables)`);
  console.log('   ' + [...by.entries()].map(([k, n]) => `${k} ${n}`).join(' · '));
}

main().catch((e) => { console.error(e); process.exit(1); });
