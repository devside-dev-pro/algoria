// HISTORIQUE RÉEL DU COMPTE SOURCE (24/09/2026) — la matière de la future page « track record ».
//
// Algoria 2.0 copie un compte source. Mathieu veut publier SON VRAI historique, façon Myfxbook, plutôt qu'un
// backtest. Ce module le lit via MetaApi et range les deals bruts dans Supabase (table source_deals).
//
// ── LECTURE SEULE, PAR CONSTRUCTION ─────────────────────────────────────────────────────────────────
// Le compte est ajouté sur MetaApi avec le mot de passe INVESTISSEUR, qui ne passe jamais par ici : ce code
// ne connaît que l'identifiant MetaApi (SOURCE_ACCOUNT_ID). Il n'appelle aucune méthode d'exécution — il ne
// peut pas trader, même par erreur, et le broker refuserait de toute façon.
//
// ── IL NE DOIT JAMAIS GÊNER LE RUNNER ───────────────────────────────────────────────────────────────
// Connexion RPC séparée, sur un AUTRE compte que le maître ; tout est dans un try/catch ; aucun await dans
// le chemin de démarrage. Si MetaApi, le broker ou Supabase tombent, on écrit une ligne de log et on
// réessaie au passage suivant. Le runner ne s'en aperçoit pas.
//
// Premier passage : TOUT l'historique, par pages de 1 000. Ensuite, toutes les 6 h, seulement depuis le
// dernier deal connu moins 2 jours (l'upsert par id rend la marge sans risque de doublon).
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
import { lastSourceDealTime, saveSourceAccount, upsertSourceDeals, type SourceDealRow } from '../lib/supabase/sync';

const MetaApi: any = (MetaApiPkg as any).default ?? MetaApiPkg;

const EVERY_MS = 6 * 3_600_000;
const FROM_THE_START = new Date('2015-01-01T00:00:00Z'); // antérieur à tout compte réaliste : « depuis l'ouverture »
const PAGE = 1000;

const num = (x: unknown): number | null => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));

function toRow(d: any): SourceDealRow | null {
  if (d?.id == null || !d?.time || !d?.type) return null;
  return {
    id: String(d.id),
    time: new Date(d.time).toISOString(),
    type: String(d.type),
    entry_type: d.entryType ? String(d.entryType) : null,
    position_id: d.positionId != null ? String(d.positionId) : null,
    symbol: d.symbol ? String(d.symbol) : null,
    volume: num(d.volume),
    price: num(d.price),
    profit: num(d.profit),
    commission: num(d.commission),
    swap: num(d.swap),
    reason: d.reason ? String(d.reason) : null,
  };
}

async function syncOnce(accountId: string): Promise<void> {
  const api = new MetaApi(process.env.METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(accountId);
  // un compte ajouté mais pas déployé ne répond pas — on le déploie (lecture seule, c'est le mot de passe qui décide)
  if (account.state !== 'DEPLOYED') await account.deploy();
  await account.waitConnected();
  const conn = account.getRPCConnection();
  await conn.connect();
  await conn.waitSynchronized();

  const last = await lastSourceDealTime();
  const since = last ? new Date(+last - 2 * 86_400_000) : FROM_THE_START;
  const until = new Date();
  let offset = 0;
  let got = 0;
  for (;;) {
    const res = await conn.getDealsByTimeRange(since, until, offset, PAGE);
    const deals: any[] = res?.deals ?? [];
    const rows = deals.map(toRow).filter((r): r is SourceDealRow => r !== null);
    if (rows.length) got += await upsertSourceDeals(rows);
    if (deals.length < PAGE) break;
    offset += PAGE;
  }

  const info = await conn.getAccountInformation().catch(() => null);
  await saveSourceAccount({
    id: accountId,
    name: account.name ?? null,
    server: account.server ?? null,
    currency: info?.currency ?? null,
    leverage: num(info?.leverage),
    balance: num(info?.balance),
    equity: num(info?.equity),
  });
  await conn.close?.().catch?.(() => {});
  console.log(`[algoria] historique source : ${got} deal(s) synchronisé(s) depuis ${since.toISOString().slice(0, 10)}${last ? '' : ' (premier passage, tout l’historique)'}`);
}

/** Démarre la synchro si SOURCE_ACCOUNT_ID est défini. Ne bloque jamais, ne lève jamais. */
export function startSourceHistorySync(): void {
  const accountId = process.env.SOURCE_ACCOUNT_ID?.trim();
  if (!accountId) { console.log('[algoria] historique source : OFF (SOURCE_ACCOUNT_ID absent)'); return; }
  if (!process.env.METAAPI_TOKEN) { console.log('[algoria] historique source : OFF (METAAPI_TOKEN absent)'); return; }
  let running = false;
  const tick = () => {
    if (running) return; // une synchro lente ne se superpose jamais à la suivante
    running = true;
    void syncOnce(accountId)
      .catch((e) => console.error('[algoria] historique source : échec, nouvel essai dans 6 h —', (e as { message?: string })?.message ?? e))
      .finally(() => { running = false; });
  };
  setTimeout(tick, 60_000); // après le démarrage du runner, jamais pendant
  setInterval(tick, EVERY_MS);
  console.log('[algoria] historique source : ON (1er passage dans 1 min, puis toutes les 6 h)');
}
