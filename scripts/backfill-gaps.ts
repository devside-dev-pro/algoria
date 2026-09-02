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
//   tsx scripts/backfill-gaps.ts XAUUSD M5 --from 2024-10-01    (ÉTEND l'historique en arrière jusqu'à cette date)
//
// --from (02/09/2026, soir) : par construction ce script ne comble que les trous ENTRE deux bougies existantes ;
// ce qui précède la première bougie n'est pas un trou, c'est le bord. Or l'étude d'edge par session
// (backtest/edge-sessions.ts) a besoin du trajet M5 sur deux ans, et le M5 en base commence le 10/04/2026 :
// tout ce qu'on croit savoir du scalp par session vient des trois mêmes mois que le live. Avec --from, la
// plage [from, première bougie) est traitée comme un trou de plus, pagé en arrière comme les autres.
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
const fromIdx = process.argv.indexOf('--from');
const fromMs = fromIdx > 0 ? Date.parse(process.argv[fromIdx + 1]) : NaN;
if (fromIdx > 0 && !Number.isFinite(fromMs)) { console.error('--from attend une date ISO, ex. 2024-10-01'); process.exit(1); }

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
  // Extension en arrière : la plage avant la première bougie devient un trou comme les autres.
  if (Number.isFinite(fromMs) && times.length && times[0] - fromMs > step) gaps.push({ from: fromMs, to: times[0] - step });
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

/**
 * DÉDOUBLONNAGE OBLIGATOIRE AVANT ÉCRITURE (02/09/2026, constaté en production sur le 4e trou).
 * MetaApi renvoie parfois DEUX FOIS la même bougie dans une seule page. Postgres refuse alors le lot
 * entier : « ON CONFLICT DO UPDATE command cannot affect row a second time » — un même INSERT ne peut pas
 * mettre à jour la même ligne deux fois. Un seul doublon faisait donc échouer 1 000 bougies valides, et
 * l'erreur ne dit rien de sa cause réelle.
 * On garde la DERNIÈRE occurrence : à égalité d'horodatage, la plus récemment renvoyée par l'API.
 */
function dedupe(bars: Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const b of bars) byTime.set(b.time, b);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

async function upsert(rows: Bar[]) {
  const bars = dedupe(rows);
  const CHUNK = 2000;
  for (let i = 0; i < bars.length; i += CHUNK) {
    const { error } = await db.from('candles').upsert(
      bars.slice(i, i + CHUNK).map((b) => ({ symbol, timeframe: tf, time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
      { onConflict: 'symbol,timeframe,time' },
    );
    if (error) throw new Error(`écriture Supabase: ${error.message}`);
  }
}

/**
 * FUSION DES TROUS VOISINS (03/09/2026). Le journalier BTC de 2013–2018 présentait 261 trous de quelques
 * jours, traités un par un : un appel MetaApi chacun, une heure de course, alors qu'UNE page de l'API (1 000
 * bougies) couvre trois ans de journalier. Deux trous séparés de moins d'une page sont fusionnés en une seule
 * plage ; les bougies déjà en base qui tombent dedans sont simplement ré-écrites à l'identique (upsert).
 */
function coalesce(gaps: Gap[]): Gap[] {
  const out: Gap[] = [];
  for (const g of gaps) {
    const last = out[out.length - 1];
    if (last && g.from - last.to < 1000 * step) last.to = g.to;
    else out.push({ ...g });
  }
  return out;
}

async function main() {
  const before = await existingTimes();
  const raw = findGaps(before);
  const gaps = coalesce(raw);
  if (gaps.length < raw.length) console.log(`[gaps] ${raw.length} trous fusionnés en ${gaps.length} plage(s) (moins d'une page d'API entre eux)`);
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
  const failed: string[] = [];
  for (const [n, gap] of gaps.entries()) {
    const label = `${new Date(gap.from).toISOString().slice(0, 10)}→${new Date(gap.to).toISOString().slice(0, 10)}`;
    let cursor = gap.to + step; // on demande les bougies AVANT la fin du trou
    let got = 0;
    // UN TROU QUI ÉCHOUE NE DOIT PAS JETER LE TRAVAIL DES AUTRES (02/09/2026). La première version
    // remontait l'erreur jusqu'en haut : un incident sur le 4e trou arrêtait la course et les 50 suivants
    // n'étaient jamais tentés. Le script est idempotent et recalcule les trous à chaque lancement, donc
    // continuer ne coûte rien et ne masque rien — les échecs sont comptés et listés à la fin.
    try {
      // Garde-fou : un broker qui ne détient plus cet historique renvoie du vide ou du hors-plage.
      // On s'arrête alors au lieu de boucler — c'est une limite du broker, pas un bug à contourner.
      // Le garde-fou est dimensionné sur le trou : 50 pages suffisaient aux trous ordinaires, pas à une
      // extension --from de deux ans en M5 (~150 000 bougies = 150 pages). Le script reste idempotent :
      // interrompu, il reprend là où il s'est arrêté au prochain lancement.
      const maxPages = Math.max(50, Math.ceil((gap.to - gap.from) / step / 1000) + 5);
      for (let guard = 0; guard < maxPages; guard++) {
        const bars = await page(account, new Date(cursor));
        const useful = bars.filter((b) => b.time >= gap.from && b.time <= gap.to);
        if (useful.length) { await upsert(useful); got += useful.length; written += useful.length; }
        if (!bars.length) break;
        const oldest = Math.min(...bars.map((b) => b.time));
        if (oldest <= gap.from) break;
        if (oldest >= cursor) break; // l'API ne recule plus : historique épuisé
        cursor = oldest;
      }
    } catch (e) {
      const why = (e as { message?: string })?.message ?? String(e);
      failed.push(`${label} (${why})`);
      // La RAISON s'affiche tout de suite, pas seulement dans le bilan final (02/09, soir) : quinze trous qui
      // échouent d'affilée avec un message caché jusqu'à la fin, c'est un quart d'heure perdu à regarder
      // « ÉCHEC — on continue » sans savoir si c'est le symbole broker, le token ou l'historique.
      console.error(`[gaps] ${String(n + 1).padStart(3)}/${gaps.length}  ${label}  ÉCHEC — ${why.slice(0, 160)}`);
      if (n === 0 && /symbol|not found|invalid/i.test(why)) console.error(`[gaps] ⚠️ le broker ne connaît probablement pas « ${brokerSymbol} » — relancer avec --broker <nom exact chez le broker> (valeur d'ALGORIA_SYMBOL / BTCUSD_SYMBOL sur Railway)`);
      continue;
    }
    console.log(`[gaps] ${String(n + 1).padStart(3)}/${gaps.length}  ${label}  +${got}`);
  }

  const after = await existingTimes();
  const left = findGaps(after);
  console.log(`\n[gaps] ${written} bougies écrites. Trous restants : ${left.length} (avant : ${gaps.length}).`);
  if (failed.length) {
    console.error(`[gaps] ${failed.length} trou(x) en échec — relancer le script les retentera :`);
    for (const f of failed) console.error(`   ${f}`);
  }
  if (left.length) console.log('[gaps] les trous restants sont de l\'historique que le broker ne détient plus — rien de plus à récupérer par cette voie.');
  process.exit(0);
}

main().catch((e) => { console.error('[gaps] crash:', e); process.exit(1); });
