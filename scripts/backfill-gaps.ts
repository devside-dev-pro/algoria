import 'dotenv/config'; // charge le .env AVANT que le client MetaApi lise process.env (no-op sur Railway)
// BOUCHE-TROUS d'historique — le complément indispensable de scripts/backfill-index.ts.
//
// POURQUOI CE FICHIER EXISTE (constat du 01/09/2026). `backfill-index.ts` pagine en arrière À PARTIR DE
// MAINTENANT : chaque exécution ramène `pages × 1000` bougies depuis le jour où on la lance, et rien
// d'autre. Lancé de temps en temps, il empile donc des BLOCS qui se recouvrent près du présent et laisse
// des TROUS entre deux exécutions. Sur BTCUSD H1 le résultat mesuré est sans appel :
//     46 vrais trous, 13 367 heures absentes sur 24 648 → 54 % du calendrier manquant,
//     plus long bloc continu : 1 426 bougies.
// (l'or est sain : 5 trous, 482 heures — d'où le fait que le walk-forward or tourne et pas celui du BTC.)
//
// CE QUE ÇA CASSE. Le cache backtest est un simple tableau : deux bougies séparées de trois semaines y
// deviennent VOISINES. EMA(600), EMA(50) et ATR14 traversent alors une discontinuité invisible, et la
// stratégie swing — qui exige 700 bougies de chauffe — se retrouve à « chauffer » sur un collage de
// fragments. Un walk-forward BTC lancé là-dessus ne mesure pas une stratégie, il mesure des trous.
// Tant que ce script n'a pas tourné, AUCUN chiffre de backtest BTC n'est défendable.
//
// CE QU'IL FAIT. Il lit les horodatages DÉJÀ en base, en déduit les trous réels, et ne redemande à MetaApi
// que ces intervalles-là — en paginant vers l'arrière depuis la fin de chaque trou. Il est idempotent
// (upsert sur symbol+timeframe+time) : on peut le relancer sans rien abîmer.
//
// OÙ LE LANCER. Là où METAAPI_TOKEN / METAAPI_ACCOUNT_ID / SUPABASE_* existent ET où api.metaapi.cloud est
// joignable — ta machine ou Railway. PAS depuis un bac à sable dont la sortie réseau est filtrée.
//   tsx scripts/backfill-gaps.ts BTCUSD H1
//   tsx scripts/backfill-gaps.ts BTCUSD H1 --broker BTCUSD.a   (si le nom broker diffère du label stocké)
//
// PRUDENCE VOLONTAIRE : on ne comble PAS les trous de forme « week-end » (le marché était fermé, il n'y a
// rien à récupérer et on ferait tourner l'API pour rien). Seuil par défaut : 6 h en M1/M5/M15/H1, 4 jours
// en D1 — au-delà, c'est un vrai trou.
import { createClient } from '@supabase/supabase-js';
import { connectAccount } from '../runner/metaapi/client';

const TF_API: Record<string, string> = { M1: '1m', M5: '5m', M15: '15m', H1: '1h', D1: '1d' };
const TF_MS: Record<string, number> = { M1: 60_000, M5: 300_000, M15: 900_000, H1: 3_600_000, D1: 86_400_000 };

const symbol = process.argv[2] ?? '';
const tf = (process.argv[3] ?? 'H1').toUpperCase();
const brokerIdx = process.argv.indexOf('--broker');
const brokerSymbol = brokerIdx > 0 ? process.argv[brokerIdx + 1] : symbol;

if (!symbol || !TF_API[tf]) {
  console.error('usage: tsx scripts/backfill-gaps.ts <SYMBOLE_STOCKÉ> <M1|M5|M15|H1|D1> [--broker <SYMBOLE_BROKER>]');
  process.exit(1);
}

const step = TF_MS[tf];
// Au-delà de ce vide, on considère qu'il s'agit d'un vrai trou et pas d'une fermeture de marché.
const MARKET_CLOSE_MS = tf === 'D1' ? 4 * 86_400_000 : 6 * 3_600_000;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Gap = { from: number; to: number };

/** Horodatages déjà en base, triés — lus par pages de 1000 (limite PostgREST). */
async function existingTimes(): Promise<number[]> {
  const out: number[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('candles').select('time')
      .eq('symbol', symbol).eq('timeframe', tf)
      .order('time', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`lecture Supabase: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) out.push(Number(r.time));
    if (data.length < 1000) break;
  }
  return out;
}

function findGaps(times: number[]): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < times.length; i++) {
    const delta = times[i] - times[i - 1];
    if (delta > MARKET_CLOSE_MS) gaps.push({ from: times[i - 1] + step, to: times[i] - step });
  }
  return gaps;
}

/** Une page MetaApi = les `count` bougies qui PRÉCÈDENT `before`. */
async function page(account: any, before: Date, count = 1000): Promise<Bar[]> {
  const raw = await account.getHistoricalCandles(brokerSymbol, TF_API[tf], before, count);
  return (raw ?? []).map((c: any) => ({
    time: new Date(c.time).getTime(),
    open: c.open, high: c.high, low: c.low, close: c.close, volume: c.tickVolume ?? 0,
  }));
}

async function upsert(bars: Bar[]) {
  const CHUNK = 2000;
  for (let i = 0; i < bars.length; i += CHUNK) {
    const { error } = await db.from('candles').upsert(
      bars.slice(i, i + CHUNK).map((b) => ({ symbol, timeframe: tf, time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
      { onConflict: 'symbol,timeframe,time' },
    );
    if (error) throw new Error(`écriture Supabase: ${error.message}`);
  }
}

async function main() {
  const before = await existingTimes();
  const gaps = findGaps(before);
  const missing = gaps.reduce((s, g) => s + (g.to - g.from) / step + 1, 0);
  console.log(`[gaps] ${symbol} ${tf} : ${before.length} bougies en base, ${gaps.length} trous, ~${Math.round(missing)} bougies manquantes`);
  if (!gaps.length) { console.log('[gaps] rien à faire.'); process.exit(0); }

  // CONNEXION RPC SEULE, PAS DE FLUX (connectAccount et non connectMaster). Deux raisons :
  //  1. on ne lit que de l'historique — `getHistoricalCandles` est un appel RPC, le streaming n'apporte rien ;
  //  2. ce script tourne depuis une machine locale PENDANT que le runner Railway tient déjà sa propre
  //     connexion streaming sur le MÊME compte master. Ouvrir un second flux synchronisé sur un compte qui
  //     trade en direct est un risque gratuit, et `waitSynchronized` peut faire attendre longtemps.
  // C'est exactement l'usage que le commentaire de connectAccount décrit : « historique de bougies, idéal
  // pour le backtest, même marché fermé ».
  console.log('[gaps] connexion MetaApi (RPC, sans flux)…');
  const { account } = await connectAccount();

  let written = 0;
  for (const [n, gap] of gaps.entries()) {
    const label = `${new Date(gap.from).toISOString().slice(0, 10)}→${new Date(gap.to).toISOString().slice(0, 10)}`;
    let cursor = gap.to + step; // on demande les bougies AVANT la fin du trou
    let got = 0;
    // Garde-fou : un broker qui ne détient plus cet historique renvoie du vide ou du hors-plage.
    // On s'arrête alors au lieu de boucler — c'est une limite du broker, pas un bug à contourner.
    for (let guard = 0; guard < 50; guard++) {
      const bars = await page(account, new Date(cursor));
      const useful = bars.filter((b) => b.time >= gap.from && b.time <= gap.to);
      if (useful.length) { await upsert(useful); got += useful.length; written += useful.length; }
      if (!bars.length) break;
      const oldest = Math.min(...bars.map((b) => b.time));
      if (oldest <= gap.from) break;
      if (oldest >= cursor) break; // l'API ne recule plus : historique épuisé
      cursor = oldest;
    }
    console.log(`[gaps] ${String(n + 1).padStart(3)}/${gaps.length}  ${label}  +${got}`);
  }

  const after = await existingTimes();
  const left = findGaps(after);
  console.log(`\n[gaps] ${written} bougies écrites. Trous restants : ${left.length} (avant : ${gaps.length}).`);
  if (left.length) console.log('[gaps] les trous restants sont de l\'historique que le broker ne détient plus — rien de plus à récupérer par cette voie.');
  process.exit(0);
}

main().catch((e) => { console.error('[gaps] crash:', e); process.exit(1); });
