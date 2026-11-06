/**
 * Sync « Dépôts Algoria » → Google Sheet (service account).
 *
 * Env requis (sinon no-op silencieux) :
 *   DEPOSITS_SHEET_ID
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  (PEM ; \n échappés OK sur Vercel)
 * Optionnel :
 *   DEPOSITS_SHEET_TAB_PREFIX (défaut "Dépôts") — onglet = `${prefix} ${Mois} ${YYYY}`
 *
 * Règles (Mathieu 05/11/2026) :
 *  - un onglet PAR mois comptable ; on ne touche JAMAIS aux autres mois
 *  - les mois historiques (Juillet, Août compta manuelle, Hind…) ne sont PAS réécrits
 *    → sync = mois courant Dubai seulement (+ veilleur : mois précédent UNIQUEMENT
 *      les 3 premiers jours du mois, et seulement si l'onglet n'existe pas encore
 *      ou porte le marqueur sync auto — jamais un onglet déjà rempli à la main)
 *  - lignes canceled : conservées (ANNULÉ dans Note via buildDepositSheet) — pas de delete
 *  - non-bloquant côté admin (fire-and-forget)
 */
import { createSign } from 'crypto';
import { buildDepositSheet, type SheetConnect, type SheetDeposit, type SheetRow, SHEET_HEADER } from './depositSheet';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const MONTH_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export type SyncEnv = { sheetId: string; email: string; privateKey: string };

export function readDepositSheetEnv(): SyncEnv | null {
  const sheetId = String(process.env.DEPOSITS_SHEET_ID ?? '').trim();
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim();
  let privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').trim();
  if (!sheetId || !email || !privateKey) return null;
  privateKey = privateKey.replace(/\\n/g, '\n');
  return { sheetId, email, privateKey };
}

export function dubaiYm(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}

export function dubaiDay(d = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', day: '2-digit' }).formatToParts(d);
  return Number(parts.find((p) => p.type === 'day')?.value ?? 1);
}

export function tabTitleForYm(ym: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return ym;
  const [y, m] = ym.split('-');
  const prefix = String(process.env.DEPOSITS_SHEET_TAB_PREFIX ?? 'Dépôts').trim() || 'Dépôts';
  return `${prefix} ${MONTH_FR[Number(m) - 1]} ${y}`;
}

function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function accessToken(env: SyncEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: env.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claim}`;
  const sign = createSign('RSA-SHA256');
  sign.update(unsigned);
  sign.end();
  const jwt = `${unsigned}.${b64url(sign.sign(env.privateKey))}`;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('google token missing access_token');
  return j.access_token;
}

const cells = (r: SheetRow) => [r.name, r.account, r.broker, r.date, r.deposit, r.country, r.commission, r.note, r.cpa ? 'TRUE' : 'FALSE'];

export type SyncResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped?: false; tab: string; rows: number; ym: string }
  | { ok: false; error: string };

type SheetMeta = { title: string; sheetId: number };

async function listTabs(sheetId: string, token: string): Promise<SheetMeta[]> {
  const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meta.ok) throw new Error(`meta ${meta.status}`);
  const j = (await meta.json()) as { sheets?: Array<{ properties?: { title?: string; sheetId?: number } }> };
  return (j.sheets ?? []).map((s) => ({ title: String(s.properties?.title ?? ''), sheetId: Number(s.properties?.sheetId ?? 0) }));
}

/** Onglets manuels / compta partenaire : ne jamais clear+rewrite. */
export function isProtectedHistoricalTab(title: string): boolean {
  const t = title.toLowerCase();
  if (/\bhind\b/.test(t)) return true;
  if (/mathieu/.test(t) && /octobre/.test(t)) return true; // feuille de travail Mathieu octobre
  // Mois clos avant le mois courant-1 : protégés par politique d'appel, pas par nom.
  return false;
}

async function ensureTab(sheetId: string, title: string, token: string): Promise<void> {
  const tabs = await listTabs(sheetId, token);
  if (tabs.some((t) => t.title === title)) return;
  const add = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  if (!add.ok) throw new Error(`addSheet ${add.status}: ${(await add.text()).slice(0, 200)}`);
}

async function rewriteTab(env: SyncEnv, tab: string, values: string[][], token: string): Promise<void> {
  if (isProtectedHistoricalTab(tab)) throw new Error(`refusing to rewrite protected tab: ${tab}`);
  await ensureTab(env.sheetId, tab, token);
  const enc = encodeURIComponent(tab);
  const clear = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.sheetId}/values/'${enc}':clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!clear.ok) throw new Error(`clear ${clear.status}: ${(await clear.text()).slice(0, 200)}`);
  const put = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.sheetId}/values/'${enc}'!A1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!put.ok) throw new Error(`update ${put.status}: ${(await put.text()).slice(0, 200)}`);
}

export type SyncLooseInput = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  ym: string;
  /** Si true : refuse d'écraser un onglet qui a déjà plus de 1 ligne (compta manuelle). */
  refuseNonEmpty?: boolean;
};

export async function syncDepositsYmLoose(input: SyncLooseInput): Promise<SyncResult> {
  const env = readDepositSheetEnv();
  if (!env) return { ok: true, skipped: true, reason: 'missing_env' };
  const { db, ym } = input;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: `bad ym ${ym}` };
  const tab = tabTitleForYm(ym);
  if (isProtectedHistoricalTab(tab)) return { ok: true, skipped: true, reason: `protected_tab:${tab}` };

  const { data: depRows } = await db.from('member_actions').select('id,tg_id,detail,created_at').eq('kind', 'deposit').limit(5000);
  const deposits = (depRows ?? []) as SheetDeposit[];
  const { data: connRows } = await db.from('member_actions').select('tg_id,detail,created_at').eq('kind', 'connect').eq('status', 'done').order('created_at', { ascending: true }).limit(5000);
  const connects = (connRows ?? []) as SheetConnect[];

  const tgIds = [...new Set(deposits.map((d) => Number(d.tg_id)).filter((n) => Number.isFinite(n)))];
  const { data: mems } = tgIds.length
    ? await db.from('members').select('tg_id,tg_name,tg_username,country').in('tg_id', tgIds)
    : { data: [] };
  type Mem = { tg_id: number; tg_name?: string | null; tg_username?: string | null; country?: string | null };
  const byTg = new Map(((mems ?? []) as Mem[]).map((m) => [Number(m.tg_id), m]));
  const nameOf = (tg: number) => {
    const m = byTg.get(tg);
    if (!m) return `#${tg}`;
    return String(m.tg_name || (m.tg_username ? `@${m.tg_username}` : '') || `#${tg}`).trim() || `#${tg}`;
  };
  const countryOf = (tg: number) => String(byTg.get(tg)?.country ?? '').trim();

  const rows = buildDepositSheet({ deposits, connects, ym, nameOf, countryOf });
  const values = [SHEET_HEADER, ...rows.map(cells)];

  try {
    const token = await accessToken(env);
    if (input.refuseNonEmpty) {
      const enc = encodeURIComponent(tab);
      const existing = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${env.sheetId}/values/'${enc}'!A1:A3`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (existing.ok) {
        const j = (await existing.json()) as { values?: string[][] };
        const n = (j.values ?? []).length;
        if (n > 1) return { ok: true, skipped: true, reason: `refuse_nonempty:${tab}:${n}` };
      }
    }
    await rewriteTab(env, tab, values, token);
    return { ok: true, tab, rows: rows.length, ym };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Après addDeposit / updateDeposit — ne throw jamais vers l'admin. */
export function scheduleDepositSheetSync(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  ym: string,
): void {
  if (!readDepositSheetEnv()) return;
  // Ne sync auto que le mois courant (Dubai) — un dépôt reporté sur un vieux mois
  // ne doit pas réécrire la compta Hind/Août.
  const cur = dubaiYm();
  if (ym !== cur) {
    console.log('[deposit-sheet-sync] skip non-current ym', ym, 'cur', cur);
    return;
  }
  void syncDepositsYmLoose({ db, ym }).then((r) => {
    if (!r.ok) console.error('[deposit-sheet-sync]', r.error);
    else console.log('[deposit-sheet-sync]', r);
  }).catch((e) => console.error('[deposit-sheet-sync]', e));
}

/** Cron quotidien : mois courant ; J1–J3 aussi le mois précédent SI onglet vide/absent. */
export async function syncDepositsCatchUp(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): Promise<{ current: SyncResult; previous?: SyncResult }> {
  const cur = dubaiYm();
  const current = await syncDepositsYmLoose({ db, ym: cur });
  let previous: SyncResult | undefined;
  if (dubaiDay() <= 3) {
    previous = await syncDepositsYmLoose({ db, ym: prevYm(cur), refuseNonEmpty: true });
  }
  return { current, previous };
}
