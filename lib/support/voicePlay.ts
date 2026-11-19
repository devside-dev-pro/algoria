// /play_voice — réécoute d'un vocal déjà en base, dans le privé du propriétaire.
// Lecture seule : select sur support_assets, puis sendVoice. Aucun update (uses compris),
// aucun envoi à un prospect, aucun tag. Le chat de destination est celui du message, jamais une colonne.

/** Privé avec le bot, et l'expéditeur EST ce chat (pas un groupe, pas une conversation Business). */
export function isOwnerPrivateChat(msg: { chat?: { type?: string; id?: unknown }; from?: { id?: unknown }; business_connection_id?: unknown }): boolean {
  if (msg?.chat?.type !== 'private' || msg.business_connection_id) return false;
  return Number(msg.chat?.id) > 0 && Number(msg.chat?.id) === Number(msg.from?.id);
}

export const PLAY_VOICE_MAX = 10;

const VOICE_KINDS = new Set(['faq_voice', 'script_voice']);
const USAGE = 'Usage : /play_voice <id> [id…] — 10 maximum. Exemple : /play_voice 23 25';
const TOO_MANY = '10 vocaux maximum. Rien n’a été envoyé.';
const OFF = 'Mode enregistrement coupé (SUPPORT_VOICE_RECORDER est off).';

export type PlayVoiceParse = { tokens: string[] };

/** null = ce n'est pas /play_voice. tokens vide = la commande sans argument. */
export function parsePlayVoiceCommand(text: string): PlayVoiceParse | null {
  const m = /^\/play_voice(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
  if (!m) return null;
  const rest = (m[1] ?? '').trim();
  if (!rest) return { tokens: [] };
  return { tokens: rest.split(/\s+/).filter(Boolean) };
}

export function parseVoiceId(token: string): number | null {
  if (!/^[1-9]\d{0,14}$/.test(token)) return null;
  const n = Number(token);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Plus de 10 jetons : on ne joue rien. Sinon, ids valides et jetons refusés, dans l'ordre reçu. */
export function classifyPlayTokens(tokens: string[]): { ids: number[]; invalid: string[]; tooMany: boolean } {
  if (tokens.length > PLAY_VOICE_MAX) return { ids: [], invalid: [], tooMany: true };
  const ids: number[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    const id = parseVoiceId(token);
    if (id == null) invalid.push(token);
    else ids.push(id);
  }
  return { ids, invalid, tooMany: false };
}

export function playVoiceCaption(row: { id: number; situation: string | null; kind: string }): string {
  const situation = row.situation && row.situation.trim() ? row.situation.trim() : '—';
  return `id ${row.id} · ${situation} (${row.kind})`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type Send = (method: string, payload: Record<string, unknown>) => Promise<{ ok?: boolean } | void | null | undefined>;

type VoiceRow = { id: number; kind: string; situation: string | null; file_id: string };

/** SELECT id, kind, situation, file_id. Pas de uses, pas de chat_id, pas d'écriture. */
export async function loadVoiceById(db: Db, id: number): Promise<VoiceRow | null> {
  const { data, error } = await db.from('support_assets')
    .select('id,kind,situation,file_id')
    .eq('id', id)
    .limit(1);
  if (error) throw new Error(String(error.message ?? error));
  const row = (Array.isArray(data) ? data[0] : null) as { id?: unknown; kind?: unknown; situation?: unknown; file_id?: unknown } | null;
  if (!row) return null;
  const sid = Number(row.id);
  if (sid !== id) return null;
  const kind = String(row.kind ?? '');
  if (!VOICE_KINDS.has(kind)) return null;
  const fileId = String(row.file_id ?? '');
  if (!fileId) return null;
  const situation = row.situation == null ? null : String(row.situation);
  return { id: sid, kind, situation, file_id: fileId };
}

async function sendText(send: Send, chatId: number, text: string): Promise<void> {
  try {
    await send('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
  } catch (e) {
    console.error('[voice-recorder] play_voice', (e as Error)?.message ?? e);
  }
}

async function playOne(db: Db, send: Send, chatId: number, id: number): Promise<void> {
  let row: VoiceRow | null;
  try {
    row = await loadVoiceById(db, id);
  } catch (e) {
    console.error('[voice-recorder] play_voice', id, (e as Error)?.message ?? e);
    await sendText(send, chatId, `Lecture impossible pour l’id ${id}.`);
    return;
  }
  if (!row) {
    await sendText(send, chatId, `Vocal id ${id} inconnu.`);
    return;
  }
  try {
    const res = await send('sendVoice', { chat_id: chatId, voice: row.file_id, caption: playVoiceCaption(row) });
    if (res && res.ok === false) throw new Error('sendVoice');
  } catch (e) {
    console.error('[voice-recorder] play_voice', id, (e as Error)?.message ?? e);
    await sendText(send, chatId, `Vocal id ${id} illisible`);
  }
}

/**
 * false = pas la commande, pas le privé du propriétaire, ou pas le propriétaire (rien n'est envoyé).
 * true = traité. Le chat_id est Number(msg.chat.id), après la garde privé = expéditeur.
 */
export async function dispatchPlayVoice(opts: {
  db: Db;
  msg: { text?: unknown; chat?: { type?: string; id?: unknown }; from?: { id?: unknown }; business_connection_id?: unknown };
  isOwner: (fromId: unknown) => Promise<boolean>;
  enabled: boolean;
  send: Send;
}): Promise<boolean> {
  const text = typeof opts.msg?.text === 'string' ? opts.msg.text : '';
  const parsed = parsePlayVoiceCommand(text);
  if (!parsed) return false;
  if (!isOwnerPrivateChat(opts.msg)) return false;
  if (!(await opts.isOwner(opts.msg.from?.id))) return false;
  const chatId = Number(opts.msg.chat?.id);
  if (!opts.enabled) {
    await sendText(opts.send, chatId, OFF);
    return true;
  }
  if (parsed.tokens.length === 0) {
    await sendText(opts.send, chatId, USAGE);
    return true;
  }
  if (parsed.tokens.length > PLAY_VOICE_MAX) {
    await sendText(opts.send, chatId, TOO_MANY);
    return true;
  }
  for (const token of parsed.tokens) {
    const id = parseVoiceId(token);
    if (id == null) {
      await sendText(opts.send, chatId, `Id invalide : ${token.slice(0, 40)}.`);
      continue;
    }
    await playOne(opts.db, opts.send, chatId, id);
  }
  return true;
}
