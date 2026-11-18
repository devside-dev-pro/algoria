// Session Telegram du mode guidé. Uniquement le compte propriétaire (adminTgIds, le même contrôle que
// le tag des vocaux et que notifyOwner). Jamais un prospect : le chat est le privé du propriétaire avec le bot.
// Drapeau SUPPORT_VOICE_RECORDER, lu à chaque message, coupé par défaut.
// Le webhook n'est pas touché : ces fonctions sont appelées depuis app/api/telegram/route.ts, le seul webhook.
import { adminTgIds } from '../member/notifyOwner';
import { FAQ_WAIT_TOPIC, tagFaqVoice, type FaqTopic } from '../member/faqVoice';
import {
  applyRecorderAction, currentScript, isRetryableOwnerVoice, parseRecorderCallback, parseRecorderCommand,
  parseRecorderState, recorderEnabled, recorderKeyboard, savePlan, serializeRecorderState,
  type RecorderAction, type RecorderState, type RecorderStep,
} from './voiceRecorder';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const KEY = 'voice_recorder';

const enabled = () => recorderEnabled(process.env.SUPPORT_VOICE_RECORDER);

async function isOwner(fromId: unknown): Promise<boolean> {
  const id = Number(fromId);
  if (!Number.isFinite(id) || id <= 0) return false;
  return (await adminTgIds()).includes(id);
}

/** Privé avec le bot, et l'expéditeur EST ce chat (pas un groupe, pas une conversation Business). */
function ownPrivate(msg: { chat?: { type?: string; id?: unknown }; from?: { id?: unknown }; business_connection_id?: unknown }): boolean {
  if (msg?.chat?.type !== 'private' || msg.business_connection_id) return false;
  return Number(msg.chat?.id) > 0 && Number(msg.chat?.id) === Number(msg.from?.id);
}

async function loadState(db: Db): Promise<RecorderState> {
  const { data } = await db.from('support_settings').select('value').eq('key', KEY).limit(1);
  return parseRecorderState(data?.[0]?.value);
}

async function storeState(db: Db, state: RecorderState): Promise<void> {
  await db.from('support_settings').upsert({ key: KEY, value: serializeRecorderState(state), updated_by: 'voice-recorder' }, { onConflict: 'key' });
}

async function tgSend(method: string, payload: Record<string, unknown>): Promise<void> {
  const { tg } = await import('../member/businessInbox');
  await tg(method, payload);
}

async function say(chatId: number, step: RecorderStep): Promise<void> {
  const text = [step.note, step.prompt?.text].filter(Boolean).join('\n');
  if (!text) return;
  await tgSend('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(step.prompt ? { reply_markup: recorderKeyboard() } : {}),
  });
}

async function run(db: Db, chatId: number, state: RecorderState, action: RecorderAction): Promise<RecorderStep> {
  const step = applyRecorderAction(state, action);
  await storeState(db, step.state);
  await say(chatId, step);
  return step;
}

/** /record_voices et /record_voices resume. false = ce n'est pas pour nous (le webhook continue). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleVoiceRecorderCommand(db: Db, msg: any): Promise<boolean> {
  if (!parseRecorderCommand(typeof msg?.text === 'string' ? msg.text : '')) return false;
  if (!ownPrivate(msg)) return false;
  if (!(await isOwner(msg.from?.id))) return false;
  const chatId = Number(msg.chat.id);
  if (!enabled()) {
    await tgSend('sendMessage', { chat_id: chatId, text: 'Mode enregistrement coupé (SUPPORT_VOICE_RECORDER est off).' });
    return true;
  }
  const cmd = parseRecorderCommand(msg.text) as 'start' | 'resume';
  await run(db, chatId, await loadState(db), cmd);
  return true;
}

/** Boutons Redo / Skip / Stop sous le prompt. false = pas un bouton de ce mode. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleVoiceRecorderCallback(db: Db, cq: any): Promise<boolean> {
  const action = parseRecorderCallback(cq?.data);
  if (!action) return false;
  const { tg } = await import('../member/businessInbox');
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190) });
  if (!(await isOwner(cq?.from?.id))) { await answer('Réservé au propriétaire.'); return true; }
  const chatId = Number(cq.message?.chat?.id ?? cq.from?.id);
  if (!enabled()) { await answer('Mode enregistrement coupé.'); return true; }
  if (cq.message?.chat?.type && cq.message.chat.type !== 'private') { await answer('Privé seulement.'); return true; }
  const step = await run(db, chatId, await loadState(db), action);
  await answer(step.note.slice(0, 180) || step.prompt?.progress || 'OK');
  return true;
}

/**
 * Vocal envoyé au bot pendant la session. false = session inactive ou pas le propriétaire :
 * le tag manuel (handleSupportVideo) prend le relais. N'écrit jamais chez un prospect.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleVoiceRecorderVoice(db: Db, msg: any): Promise<boolean> {
  if (!msg?.voice || msg.video_note || msg.reply_to_message) return false;
  if (!ownPrivate(msg)) return false;
  if (!enabled()) return false;
  if (!(await isOwner(msg.from?.id))) return false;
  const state = await loadState(db);
  if (!isRetryableOwnerVoice(state)) return false;
  const script = currentScript(state);
  if (!script) return false;
  const chatId = Number(msg.chat.id);
  const saved = await saveOwnerVoice(db, script, msg.voice, { chatId, messageId: Number(msg.message_id) });
  if (saved.error || !saved.id) {
    await tgSend('sendMessage', { chat_id: chatId, reply_to_message_id: msg.message_id, text: `Pas enregistré (${String(saved.error ?? 'erreur').slice(0, 120)}). Renvoie le vocal.` });
    return true;
  }
  await run(db, chatId, state, 'saved');
  return true;
}

type VoiceFile = { file_id: string; file_unique_id: string };

/** Insère le vocal inactif, puis l'active comme le tag manuel (l'ancien du même thème est désactivé, jamais supprimé). */
export async function saveOwnerVoice(
  db: Db,
  script: NonNullable<ReturnType<typeof currentScript>>,
  voice: VoiceFile,
  where: { chatId: number; messageId: number },
): Promise<{ id: number; error?: string }> {
  const plan = savePlan(script);
  const row = {
    kind: plan.kind, file_id: voice.file_id, file_unique_id: voice.file_unique_id,
    chat_id: where.chatId, message_id: where.messageId, active: false, situation: plan.situation, lang: 'en',
  };
  const ins = await db.from('support_assets').insert(row).select('id');
  let id = Number(ins.data?.[0]?.id ?? 0);
  const dup = ins.error && /duplicate|unique/i.test(String(ins.error.message ?? ins.error));
  if (!id && dup) {
    const prev = await db.from('support_assets').select('id').eq('file_unique_id', voice.file_unique_id).limit(1);
    id = Number(prev.data?.[0]?.id ?? 0);
  }
  if (!id) return { id: 0, error: String(ins.error?.message ?? ins.error ?? 'insert') };
  if (plan.activateLikeFaq) {
    const topic = plan.situation === FAQ_WAIT_TOPIC ? FAQ_WAIT_TOPIC : plan.situation as FaqTopic;
    const r = await tagFaqVoice(db, id, topic);
    if (r.error) return { id, error: r.error };
    return { id };
  }
  await db.from('support_assets').update({ active: false }).eq('kind', plan.kind).eq('situation', plan.situation).eq('active', true).neq('id', id);
  const up = await db.from('support_assets').update({ kind: plan.kind, situation: plan.situation, lang: 'en', active: true }).eq('id', id);
  if (up.error) return { id, error: String(up.error.message ?? up.error) };
  return { id };
}
