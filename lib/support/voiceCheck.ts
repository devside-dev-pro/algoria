// Vérification du vocal guidé : le texte transcrit est comparé aux 18 scripts.
// PUR. Le drapeau SUPPORT_VOICE_STT_CHECK se lit avec envOn (même règle que les autres interrupteurs) :
// absent, vide, off, 0, false = coupé. Coupé ou sans clé : le parcours enregistre comme avant.
import { VOICE_SCRIPTS, type VoiceScript } from './voiceScripts';

/** Même lecture que lib/member/supportWindow.ts. */
export function envOn(raw: string | null | undefined): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

export function sttCheckEnabled(raw: string | null | undefined = process.env.SUPPORT_VOICE_STT_CHECK): boolean {
  return envOn(raw);
}

export const DEFAULT_STT_THRESHOLD = 0.6;

/** 0 < seuil ≤ 1. Autre valeur, ou absent : 0,6. */
export function parseSttThreshold(raw: string | null | undefined = process.env.SUPPORT_VOICE_STT_THRESHOLD): number {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0 || n > 1) return DEFAULT_STT_THRESHOLD;
  return n;
}

export type ScriptRef = { n: number; key: string; title: string; script: string };

export const scriptRef = (s: Pick<VoiceScript, 'n' | 'key' | 'title' | 'script'>): ScriptRef => ({
  n: s.n, key: s.key, title: s.title, script: s.script,
});

export const allScriptRefs = (): ScriptRef[] => VOICE_SCRIPTS.map(scriptRef);

/** Mots normalisés : minuscules, apostrophes retirées, reste de la ponctuation ignoré. */
export function normalizeTokens(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Recouvrement de Dice sur les ensembles de tokens : 2|A∩B| / (|A|+|B|). 1 = mêmes mots. */
export function tokenSimilarity(a: string, b: string): number {
  const A = new Set(normalizeTokens(a));
  const B = new Set(normalizeTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export type SimilarityHit = { n: number; key: string; title: string; score: number };

export type CheckVerdict =
  | { ok: true; score: number }
  | { ok: false; score: number; best: SimilarityHit | null };

/**
 * Correspond si le script attendu atteint le seuil ET qu’aucun autre script ne score plus haut.
 * Sinon : écart. `best` est l’autre script le mieux placé, s’il dépasse l’attendu.
 */
export function compareTranscript(transcript: string, expected: ScriptRef, all: ScriptRef[], threshold: number): CheckVerdict {
  const score = tokenSimilarity(transcript, expected.script);
  let bestOther: SimilarityHit | null = null;
  for (const s of all) {
    if (s.n === expected.n) continue;
    const other = tokenSimilarity(transcript, s.script);
    if (!bestOther || other > bestOther.score || (other === bestOther.score && s.n < bestOther.n)) {
      bestOther = { n: s.n, key: s.key, title: s.title, score: other };
    }
  }
  const beaten = !!bestOther && bestOther.score > score;
  if (score >= threshold && !beaten) return { ok: true, score };
  return { ok: false, score, best: beaten ? bestOther : null };
}

const pct = (score: number) => Math.round(score * 100);

export function mismatchAlert(expected: ScriptRef, score: number, best: SimilarityHit | null): string {
  let text = `⚠️ Le vocal enregistré ne correspond pas au script ${expected.n} — ${expected.title} (similarité ${pct(score)} %).`;
  if (best && best.n !== expected.n) {
    text += ` Il ressemble plutôt au script ${best.n} — ${best.title}.`;
  }
  return `${text}\nRien n’est enregistré tant que tu n’as pas choisi.`;
}

export function mismatchKeyboard() {
  return {
    inline_keyboard: [[
      { text: 'Redo', callback_data: 'vr:redo' },
      { text: 'Keep anyway', callback_data: 'vr:keep' },
    ]],
  };
}

export const STT_FAIL_NOTICE = 'La vérification du script n’a pas pu tourner. Le vocal est quand même enregistré.';
export const STT_SKIP_LOG = 'vérification sautée (SUPPORT_VOICE_STT_CHECK coupé ou ELEVENLABS_API_KEY absente)';

export type TranscriptResult = { ok: true; text: string } | { ok: false; reason: string };

export type RecordingAssessment =
  | { action: 'save'; skipped?: boolean; failed?: boolean; notice?: string; score?: number }
  | { action: 'hold'; notice: string; score: number; bestN: number | null };

/** Décide sans réseau. `transcribe` n’est appelé que si le drapeau est allumé et la clé est là. */
export async function assessRecording(input: {
  enabled: boolean;
  hasKey: boolean;
  fileId: string;
  expected: ScriptRef;
  all: ScriptRef[];
  threshold: number;
  transcribe: (fileId: string) => Promise<TranscriptResult>;
  log?: (message: string) => void;
}): Promise<RecordingAssessment> {
  if (!input.enabled || !input.hasKey) {
    input.log?.(STT_SKIP_LOG);
    return { action: 'save', skipped: true };
  }
  let transcript: TranscriptResult;
  try {
    transcript = await input.transcribe(input.fileId);
  } catch {
    transcript = { ok: false, reason: 'throw' };
  }
  if (!transcript.ok) return { action: 'save', failed: true, notice: STT_FAIL_NOTICE };
  const verdict = compareTranscript(transcript.text, input.expected, input.all, input.threshold);
  if (verdict.ok) return { action: 'save', score: verdict.score };
  return {
    action: 'hold',
    score: verdict.score,
    bestN: verdict.best?.n ?? null,
    notice: mismatchAlert(input.expected, verdict.score, verdict.best),
  };
}
