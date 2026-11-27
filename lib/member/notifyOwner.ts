// ALERTE PROPRIÉTAIRE — ce que Mathieu doit savoir sans ouvrir l'admin (03/09/2026).
//
// Constat de l'audit produit (docs/AUDIT-PRODUIT.md §1) : aucun événement métier ne prévenait personne.
// Un membre qui finissait son dossier, déclarait son lot d'activation, demandait un retrait ou écrivait au
// bot n'était visible qu'en ouvrant le dashboard — « je n'ai même pas le temps de les voir ». Le 03/09,
// six dossiers attendaient, le plus vieux depuis huit jours.
//
// Deux canaux :
//   · DM Telegram par le bot — LE canal.
//     OWNER_TG_IDS : identifiants numériques, utilisés tels quels (ne dépend pas d'une fiche membre).
//     ADMIN_TG_USERNAMES : pseudos résolus dans members.tg_username → tg_id. La fiche existe parce que
//     la personne s'est connectée à l'app, pas parce qu'elle a écrit au bot. Telegram, lui, refuse le DM
//     tant qu'elle n'a pas ouvert la conversation (/start) : ça se voit au 403, pas à un identifiant vide.
//   · Web Push (pushToAdmins) — EN SECOURS SEULEMENT depuis le 30/09/2026 (décision Mathieu : « la notif
//     Telegram suffit largement »). Envoyées ensemble, chaque dossier et chaque message au bot arrivaient deux
//     fois sur son téléphone. Le push ne part plus que si AUCUN DM Telegram n'a été délivré (token absent,
//     Telegram injoignable, bot bloqué) : l'alerte n'est jamais perdue, et jamais doublée.
// Best effort, jamais bloquant : une alerte qui échoue ne doit pas casser l'action du membre.
//
// DIAGNOSTIC (27/11/2026) : un échec renvoyait { dm: 0, push: 0 } et le runner répétait « non délivrée »
// chaque minute, sans motif. On garde le motif (token présent ou non, jamais sa valeur ; identifiants
// exploitables ; pseudos résolus ; HTTP, error_code, description ; chat masqué ; souscriptions push et
// codes). La ligne part au plus toutes les 30 minutes, ou tout de suite si le motif change.
//
// LES LIENS SONT ABSOLUS vers admin.getalgoria.com. Les alertes techniques pointaient sur `/member/admin`
// (page morte) ou `/admin` (réécrit en `/member/admin` sur app.getalgoria.com par le middleware → boucle).
import { createClient } from '@supabase/supabase-js';
import { pushToAdminsReport, type AdminPushReport, type PushPayload } from '../push/send';

export const ADMIN_URL = (process.env.ADMIN_URL ?? 'https://admin.getalgoria.com').replace(/\/$/, '');
export const adminLink = (path = '/'): string => `${ADMIN_URL}${path.startsWith('/') ? path : `/${path}`}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Au plus une ligne identique par fenêtre. Un motif différent part tout de suite. */
export const OWNER_DIAGNOSTIC_MS = 30 * 60_000;

const USERNAME = /^[a-z0-9_]{1,32}$/;

export interface OwnerIdParse {
  ids: number[];
  rejected: number;
}

export interface AdminUsernameParse {
  /** Pseudos non vides, minuscules, dédupliqués. */
  names: string[];
  /** Sous-ensemble sûr à mettre dans un filtre SQL (lettres, chiffres, underscore). */
  queryable: string[];
}

/** Identifiants numériques seulement. `1e2`, un pseudo ou un texte entre guillemets mal fermé ne partent pas. */
export function parseOwnerTgIds(raw: string | undefined): OwnerIdParse {
  const ids: number[] = [];
  const seen = new Set<number>();
  let rejected = 0;
  for (const part of (raw ?? '').split(/[\s,;]+/)) {
    const token = part.trim().replace(/^['"]+|['"]+$/g, '').replace(/^\+/, '');
    if (!token) continue;
    if (!/^\d{1,16}$/.test(token)) { rejected++; continue; }
    const n = Number(token);
    if (!Number.isSafeInteger(n) || n <= 0) { rejected++; continue; }
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  return { ids, rejected };
}

export function parseAdminUsernames(raw: string | undefined): AdminUsernameParse {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? '').split(/[\s,@]+/)) {
    const name = part.trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return { names, queryable: names.filter((n) => USERNAME.test(n)) };
}

/** Derniers chiffres seulement. Le préfixe ne permet pas de reconstruire l'identifiant. */
export function maskChatId(id: number): string {
  const digits = String(Math.trunc(Math.abs(id))).replace(/\D/g, '');
  return `••••${digits.slice(-4)}`;
}

/** Retire token, URL et suites de chiffres. La description Telegram reste, le secret non. */
export function redactSecrets(raw: string): string {
  return raw
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{8,}\b/g, '[token]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\d{7,}/g, (m) => `••••${m.slice(-4)}`)
    .replace(/[\r\n]+/g, ' ');
}

export function sanitizeTelegramDescription(raw: string): string {
  const cleaned = redactSecrets(raw).replace(/"/g, "'").trim().slice(0, 180);
  return cleaned || 'sans description';
}

export function summarizeCodes(codes: string[]): string {
  const map = new Map<string, number>();
  for (const c of codes) map.set(c, (map.get(c) ?? 0) + 1);
  const parts = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!parts.length) return 'aucun';
  return parts.map(([c, n]) => (n > 1 ? `${c}x${n}` : c)).join(',');
}

/**
 * Le filtre SQL est insensible à la casse. `ilike` traite `_` comme un joker d'un caractère :
 * la ligne n'est retenue que si le pseudo, une fois mis en minuscules, est exactement celui demandé.
 */
export function idsFromUsernameRows(
  names: string[],
  rows: Array<{ tg_id: unknown; tg_username: unknown }>,
): number[] {
  const want = new Set(names);
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const name = String(row.tg_username ?? '').trim().toLowerCase();
    if (!want.has(name)) continue;
    const id = typeof row.tg_id === 'number' ? row.tg_id : Number(String(row.tg_id ?? '').trim());
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function adminUsernameOrFilter(names: string[]): string {
  return names.map((n) => `tg_username.ilike.${n}`).join(',');
}

export type AdminLookup = 'ok' | 'sans_base' | 'erreur' | 'pseudo_inutilisable' | 'non_tente';

async function lookupAdminIds(queryable: string[], configured: number): Promise<{ ids: number[]; lookup: AdminLookup }> {
  if (configured === 0) return { ids: [], lookup: 'non_tente' };
  if (!queryable.length) return { ids: [], lookup: 'pseudo_inutilisable' };
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { ids: [], lookup: 'sans_base' };
  try {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const first = await db.from('members').select('tg_id,tg_username').or(adminUsernameOrFilter(queryable));
    const rows = first.error
      ? await db.from('members').select('tg_id,tg_username').in('tg_username', queryable)
      : first;
    if (rows.error) return { ids: [], lookup: 'erreur' };
    const data = (rows.data ?? []) as Array<{ tg_id: unknown; tg_username: unknown }>;
    return { ids: idsFromUsernameRows(queryable, data), lookup: 'ok' };
  } catch {
    return { ids: [], lookup: 'erreur' };
  }
}

/** Identifiants Telegram des admins : OWNER_TG_IDS puis ADMIN_TG_USERNAMES résolus en base. */
export async function adminTgIds(): Promise<number[]> {
  const owners = parseOwnerTgIds(process.env.OWNER_TG_IDS);
  const admins = parseAdminUsernames(process.env.ADMIN_TG_USERNAMES);
  const found = await lookupAdminIds(admins.queryable, admins.names.length);
  return [...new Set([...owners.ids, ...found.ids])];
}

export interface OwnerAlert {
  title: string; // une ligne, avec l'emoji qui dit de quoi il s'agit
  lines?: string[]; // détail, une info par ligne (pseudo, broker, montant…)
  path?: string; // page admin à ouvrir (défaut : la racine)
  tag: string; // regroupe les pushs de même nature
  /** Boutons d'action dans le DM (callback_data, traités par le webhook Telegram). Ex. « Envoyer la réponse ». */
  buttons?: Array<{ text: string; data: string }>;
  /** Plusieurs rangées de boutons (bulles : Faite / Pas cette fois sous chaque demande). Si présent, remplace `buttons`. */
  buttonRows?: Array<Array<{ text: string; data: string }>>;
}

export interface TelegramSendFailure {
  chat: string;
  http: number | null;
  errorCode: number | null;
  description: string;
}

export interface OwnerDiagnostic {
  tokenPresent: boolean;
  ownerIds: number;
  ownerRejected: number;
  adminUsernames: number;
  adminResolved: number;
  lookup: AdminLookup;
  failures: TelegramSendFailure[];
  pushAttempted: boolean;
  pushSubscriptions: number;
  pushCodes: string[];
}

export interface OwnerNotifyResult {
  dm: number;
  push: number;
  /** Ligne sûre, sans token et sans identifiant complet. Vide seulement si le formatage lui-même a cassé. */
  diagnostic: string;
}

export type TelegramFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface NotifyOwnerOptions {
  /**
   * Le runner MetaApi logue lui-même, une fois par motif. Sans ça, la même panne écrirait deux lignes.
   * Un DM partiel (un chat rate, un autre part) est quand même logué ici : l'appelant croit que c'est délivré.
   */
  silent?: boolean;
  fetchImpl?: TelegramFetch;
  push?: (payload: PushPayload) => Promise<AdminPushReport>;
  now?: number;
  /** Réservé aux tests : évite de lire l'environnement du process. */
  env?: { token?: string; ownerIdsRaw?: string; adminUsernamesRaw?: string };
}

export function formatOwnerDiagnostic(d: OwnerDiagnostic): string {
  const parts = [
    `token=${d.tokenPresent ? 'oui' : 'non'}`,
    `owner_ids=${d.ownerIds}`,
  ];
  if (d.ownerRejected > 0) parts.push(`owner_illisibles=${d.ownerRejected}`);
  parts.push(`admin_resolus=${d.adminResolved}/${d.adminUsernames}`);
  if (d.adminUsernames > 0 && d.lookup !== 'ok') parts.push(`lookup=${d.lookup}`);
  if (d.failures.length) {
    const shown = [...d.failures]
      .sort((a, b) => a.chat.localeCompare(b.chat) || (a.http ?? 0) - (b.http ?? 0))
      .slice(0, 10);
    const extra = d.failures.length - shown.length;
    const body = shown
      .map((f) => `tg chat=${f.chat} http=${f.http ?? 'absent'} error_code=${f.errorCode ?? 'absent'} description="${f.description}"`)
      .join(' ; ');
    parts.push(extra > 0 ? `${body} ; +${extra}` : body);
  } else {
    parts.push('tg=aucun_envoi');
  }
  if (d.pushAttempted) {
    parts.push(`push_subs=${d.pushSubscriptions}`);
    parts.push(`push_codes=${summarizeCodes(d.pushCodes)}`);
  } else {
    parts.push('push=non_tente');
  }
  return redactSecrets(parts.join(' · ')).trim();
}

const diagnosticLoggedAt = new Map<string, number>();

export function claimOwnerDiagnostic(line: string, now: number): boolean {
  for (const [key, at] of diagnosticLoggedAt) {
    if (now - at >= OWNER_DIAGNOSTIC_MS) diagnosticLoggedAt.delete(key);
  }
  const prev = diagnosticLoggedAt.get(line);
  if (prev != null && now - prev < OWNER_DIAGNOSTIC_MS) return false;
  diagnosticLoggedAt.set(line, now);
  return true;
}

export function resetOwnerDiagnosticLog(): void {
  diagnosticLoggedAt.clear();
}

function networkWord(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'delai';
  return 'reseau';
}

async function readTelegramFailure(r: Response): Promise<Pick<TelegramSendFailure, 'http' | 'errorCode' | 'description'>> {
  const http = Number.isInteger(r.status) && r.status >= 100 && r.status <= 599 ? r.status : null;
  try {
    const body = await r.json() as { error_code?: unknown; description?: unknown };
    const errorCode = typeof body.error_code === 'number' && Number.isInteger(body.error_code) ? body.error_code : null;
    const description = typeof body.description === 'string' ? sanitizeTelegramDescription(body.description) : 'sans description';
    return { http, errorCode, description };
  } catch {
    return { http, errorCode: null, description: 'reponse_illisible' };
  }
}

function logDiagnostic(line: string, now: number, force: boolean): void {
  if (!line || !force) return;
  if (!claimOwnerDiagnostic(line, now)) return;
  console.error(`[algoria] ${line}`);
}

async function notifyOwnerInner(a: OwnerAlert, opts: NotifyOwnerOptions | undefined): Promise<OwnerNotifyResult> {
  const url = adminLink(a.path ?? '/');
  const body = (a.lines ?? []).filter(Boolean).join('\n');
  const token = (opts?.env ? opts.env.token ?? '' : process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const owners = parseOwnerTgIds(opts?.env ? opts.env.ownerIdsRaw : process.env.OWNER_TG_IDS);
  const admins = parseAdminUsernames(opts?.env ? opts.env.adminUsernamesRaw : process.env.ADMIN_TG_USERNAMES);
  const found = await lookupAdminIds(admins.queryable, admins.names.length);
  const ids = [...new Set([...owners.ids, ...found.ids])];
  const failures: TelegramSendFailure[] = [];
  let dm = 0;

  if (token && ids.length) {
    const text = `<b>${esc(a.title)}</b>${body ? `\n${esc(body)}` : ''}`;
    const fetchImpl = opts?.fetchImpl ?? fetch;
    const keyboard = [
      ...(a.buttonRows?.length
        ? a.buttonRows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data.slice(0, 64) })))
        : a.buttons?.length
          ? [a.buttons.map((b) => ({ text: b.text, callback_data: b.data.slice(0, 64) }))]
          : []),
      [{ text: 'Ouvrir l’admin', url }],
    ];
    await Promise.all(ids.map(async (chatId) => {
      try {
        const r = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(4000),
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: keyboard },
          }),
        });
        if (r.ok) { dm++; return; }
        const fail = await readTelegramFailure(r);
        failures.push({ chat: maskChatId(chatId), ...fail });
      } catch (e) {
        failures.push({ chat: maskChatId(chatId), http: null, errorCode: null, description: networkWord(e) });
      }
    }));
  }

  let push = 0;
  let pushAttempted = false;
  let pushSubscriptions = 0;
  let pushCodes: string[] = [];
  if (dm === 0) {
    pushAttempted = true;
    try {
      const report = await (opts?.push ?? pushToAdminsReport)({
        title: a.title,
        body: body.slice(0, 240),
        url,
        tag: a.tag,
      });
      push = report.sent;
      pushSubscriptions = report.subscriptions;
      pushCodes = report.errors;
    } catch {
      pushCodes = ['exception'];
    }
  }

  const diagnostic = formatOwnerDiagnostic({
    tokenPresent: token.length > 0,
    ownerIds: owners.ids.length,
    ownerRejected: owners.rejected,
    adminUsernames: admins.names.length,
    adminResolved: found.ids.length,
    lookup: found.lookup,
    failures,
    pushAttempted,
    pushSubscriptions,
    pushCodes,
  });
  const now = opts?.now ?? Date.now();
  const undelivered = dm === 0 && push === 0;
  // Le runner écrit lui-même la ligne quand rien n'est parti. Un refus Telegram reste visible ici
  // même si un autre chat ou le push a sauvé l'alerte : l'appelant ne voit alors qu'un succès.
  const runnerOwnsUndelivered = opts?.silent === true && undelivered;
  const prefix = undelivered ? 'alerte propriétaire non délivrée' : 'alerte propriétaire : envoi Telegram incomplet';
  logDiagnostic(`${prefix} · ${diagnostic}`, now, (undelivered || failures.length > 0) && !runnerOwnsUndelivered);
  return { dm, push, diagnostic };
}

/** Envoie l'alerte aux admins (DM Telegram, push seulement si aucun DM). Ne lance jamais. */
export async function notifyOwner(a: OwnerAlert, opts?: NotifyOwnerOptions): Promise<OwnerNotifyResult> {
  try {
    return await notifyOwnerInner(a, opts);
  } catch {
    const diagnostic = 'token=inconnu · owner_ids=0 · admin_resolus=0/0 · tg=aucun_envoi · push=non_tente · diagnostic=exception';
    const now = opts?.now ?? Date.now();
    if (opts?.silent !== true) logDiagnostic(`alerte propriétaire non délivrée · ${diagnostic}`, now, true);
    return { dm: 0, push: 0, diagnostic };
  }
}
