// Mode guidé : Mathieu enregistre les 19 vocaux support, un par un, sans tag manuel.
// PUR (pas de Telegram, pas de base). Le drapeau SUPPORT_VOICE_RECORDER est lu à l'appel : absent = coupé.
// L'envoi réel est dans lib/support/voiceRecorderHandlers.ts, réservé au compte propriétaire (adminTgIds).
import { VOICE_SCRIPTS, scriptPrompt, type VoiceScript } from './voiceScripts';

export const RECORDER_TOTAL = VOICE_SCRIPTS.length;

export type RecorderStatus = 'idle' | 'active' | 'stopped' | 'done';
export type RecorderState = { status: RecorderStatus; index: number };
export type RecorderAction = 'start' | 'resume' | 'saved' | 'skip' | 'stop' | 'redo';

export type RecorderPrompt = { progress: string; text: string };
export type RecorderStep = { state: RecorderState; prompt: RecorderPrompt | null; note: string };

export const initialRecorderState = (): RecorderState => ({ status: 'idle', index: 0 });

/** Absent, vide, off, 0, false, ou toute autre valeur : coupé. */
export function recorderEnabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

export function parseRecorderCommand(text: string): 'start' | 'resume' | null {
  const t = String(text ?? '').trim();
  if (/^\/resume_voices(?:@\w+)?$/i.test(t)) return 'resume';
  const m = /^\/record_voices(?:@\w+)?(?:\s+(\S+))?$/i.exec(t);
  if (!m) return null;
  if (!m[1]) return 'start';
  if (/^resume$/i.test(m[1])) return 'resume';
  return null;
}

export function recorderKeyboard() {
  return {
    inline_keyboard: [[
      { text: 'Redo', callback_data: 'vr:redo' },
      { text: 'Skip', callback_data: 'vr:skip' },
      { text: 'Stop', callback_data: 'vr:stop' },
    ]],
  };
}

export function parseRecorderCallback(data: unknown): 'redo' | 'skip' | 'stop' | null {
  const m = /^vr:(redo|skip|stop)$/i.exec(String(data ?? ''));
  return m ? m[1].toLowerCase() as 'redo' | 'skip' | 'stop' : null;
}

export type SavePlan = {
  kind: VoiceScript['kind'];
  situation: string;
  /** true = tagFaqVoice (désactive l'ancien vocal actif du même thème, puis active celui-ci). */
  activateLikeFaq: boolean;
  /** false pour le n°19 : le vocal d'attente part seul, sans la ligne fixe des autres FAQ. */
  sendsFixedLine: boolean;
};

export function savePlan(s: VoiceScript): SavePlan {
  return {
    kind: s.kind,
    situation: s.situation,
    activateLikeFaq: s.kind === 'faq_voice',
    sendsFixedLine: s.fixedLine,
  };
}

export function parseRecorderState(raw: unknown): RecorderState {
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) as { status?: unknown; index?: unknown } : null;
    const status: RecorderStatus = j?.status === 'active' || j?.status === 'stopped' || j?.status === 'done' ? j.status : 'idle';
    const index = Number.isInteger(j?.index) ? Number(j?.index) : 0;
    if (index < 0 || index > RECORDER_TOTAL) return initialRecorderState();
    return { status, index };
  } catch {
    return initialRecorderState();
  }
}

export const serializeRecorderState = (s: RecorderState): string => JSON.stringify({ status: s.status, index: s.index });

const at = (index: number): VoiceScript | null => VOICE_SCRIPTS[index] ?? null;

function promptOf(state: RecorderState): RecorderPrompt | null {
  if (state.status !== 'active') return null;
  const s = at(state.index);
  if (!s) return null;
  const n = state.index + 1;
  return { progress: `${n}/${RECORDER_TOTAL}`, text: scriptPrompt(s, n, RECORDER_TOTAL) };
}

/** Avance la session. N'enregistre rien : l'appelant sauve le vocal PUIS envoie 'saved'. */
export function applyRecorderAction(state: RecorderState, action: RecorderAction): RecorderStep {
  if (action === 'stop') {
    if (state.status !== 'active') return { state, prompt: null, note: '' };
    const n = state.index + 1;
    return { state: { status: 'stopped', index: state.index }, prompt: null, note: `Arrêté à ${n}/${RECORDER_TOTAL}. /record_voices resume pour reprendre.` };
  }
  if (action === 'redo') {
    if (state.status !== 'active') return { state, prompt: promptOf(state), note: '' };
    return { state, prompt: promptOf(state), note: 'Renvoie le vocal : il remplace celui de cette étape.' };
  }
  if (action === 'start') {
    if (state.status === 'active') return { state, prompt: promptOf(state), note: '' };
    if (state.status === 'stopped') return applyRecorderAction(state, 'resume');
    const next: RecorderState = { status: 'active', index: 0 };
    return { state: next, prompt: promptOf(next), note: '' };
  }
  if (action === 'resume') {
    if (state.status === 'stopped' || state.status === 'active') {
      const next: RecorderState = { status: 'active', index: state.index };
      return { state: next, prompt: promptOf(next), note: '' };
    }
    if (state.status === 'done') return { state, prompt: null, note: 'Déjà terminé. /record_voices pour recommencer.' };
    return { state, prompt: null, note: 'Rien en cours. /record_voices pour commencer.' };
  }
  // saved | skip
  if (state.status !== 'active') return { state, prompt: null, note: '' };
  const nextIndex = state.index + 1;
  if (nextIndex >= RECORDER_TOTAL) {
    const done: RecorderState = { status: 'done', index: RECORDER_TOTAL };
    const note = action === 'saved' ? `Enregistré. ${RECORDER_TOTAL}/${RECORDER_TOTAL} terminé.` : `Passé. ${RECORDER_TOTAL}/${RECORDER_TOTAL} terminé.`;
    return { state: done, prompt: null, note };
  }
  const next: RecorderState = { status: 'active', index: nextIndex };
  const note = action === 'saved' ? 'Enregistré, vocal actif.' : 'Passé, sans enregistrer.';
  return { state: next, prompt: promptOf(next), note };
}

/** Un vocal du propriétaire ne va dans la session que si elle est en cours. Sinon le tag manuel habituel reste. */
export function isRetryableOwnerVoice(state: RecorderState): boolean {
  return state.status === 'active' && state.index >= 0 && state.index < RECORDER_TOTAL;
}

export function currentScript(state: RecorderState): VoiceScript | null {
  if (!isRetryableOwnerVoice(state)) return null;
  return at(state.index);
}
