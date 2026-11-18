// /check_voices — lecture seule des vocaux déjà en base. Rien n'est modifié, rien ne part chez un prospect.
import { compareTranscript, parseSttThreshold, sttCheckEnabled, tokenSimilarity, type ScriptRef } from './voiceCheck';
import type { SttResult } from './voiceStt';

export const TELEGRAM_CHUNK = 4096;

export type StoredVoice = {
  id: number;
  kind: string;
  situation: string | null;
  file_id: string;
  lang?: string | null;
  created_at?: string | null;
};

export type AuditVerdict = 'ok' | 'mismatch' | 'uncertain';

export type AuditRow = {
  id: number;
  savedTitle: string;
  bestN: number | null;
  bestTitle: string | null;
  score: number | null;
  verdict: AuditVerdict;
};

const pct = (score: number) => Math.round(score * 100);

export function isCheckVoicesCommand(text: string): boolean {
  return /^\/check_voices(?:@\w+)?$/i.test(String(text ?? '').trim());
}

/** Ce qui manque pour lancer le contrôle. null = on peut y aller. */
export function checkVoicesBlock(enabled: boolean, hasKey: boolean): string | null {
  if (enabled && hasKey) return null;
  if (!enabled && !hasKey) return 'Contrôle des vocaux impossible : SUPPORT_VOICE_STT_CHECK n’est pas allumé, et ELEVENLABS_API_KEY est absente.';
  if (!enabled) return 'Contrôle des vocaux coupé : passe SUPPORT_VOICE_STT_CHECK à on.';
  return 'Contrôle des vocaux impossible : ELEVENLABS_API_KEY est absente.';
}

function rank(text: string, all: ScriptRef[]): Array<ScriptRef & { score: number }> {
  return all
    .map((s) => ({ ...s, score: tokenSimilarity(text, s.script) }))
    .sort((a, b) => b.score - a.score || a.n - b.n);
}

/** Une ligne : id, titre de la situation enregistrée, meilleur script, %, verdict. */
export function judgeAsset(
  asset: { id: number; situation: string | null },
  transcript: SttResult,
  all: ScriptRef[],
  threshold: number,
): AuditRow {
  const saved = all.find((s) => s.key === asset.situation);
  const savedTitle = saved?.title ?? (asset.situation ? `situation ${asset.situation}` : 'situation inconnue');
  if (!transcript.ok) return { id: asset.id, savedTitle, bestN: null, bestTitle: null, score: null, verdict: 'uncertain' };
  const ranked = rank(transcript.text, all);
  const best = ranked[0];
  if (!best) return { id: asset.id, savedTitle, bestN: null, bestTitle: null, score: null, verdict: 'uncertain' };
  const expected = saved ?? { n: 0, key: '', title: savedTitle, script: '' };
  const verdict = saved
    ? compareTranscript(transcript.text, expected, all, threshold)
    : { ok: false as const, score: best.score, best };
  if (verdict.ok) {
    return { id: asset.id, savedTitle, bestN: saved!.n, bestTitle: saved!.title, score: verdict.score, verdict: 'ok' };
  }
  if (best.score >= threshold || (saved && best.n !== saved.n && best.score > tokenSimilarity(transcript.text, saved.script))) {
    return { id: asset.id, savedTitle, bestN: best.n, bestTitle: best.title, score: best.score, verdict: 'mismatch' };
  }
  return { id: asset.id, savedTitle, bestN: best.score > 0 ? best.n : null, bestTitle: best.score > 0 ? best.title : null, score: best.score > 0 ? best.score : null, verdict: 'uncertain' };
}

export function formatAuditRow(row: AuditRow): string {
  const best = row.bestN != null ? `${row.bestN} — ${row.bestTitle}` : '—';
  const score = row.score == null ? '—' : `${pct(row.score)} %`;
  const mark = row.verdict === 'ok'
    ? '✅ OK'
    : row.verdict === 'mismatch'
      ? `⚠️ ne correspond pas (ressemble à ${row.bestN})`
      : '❓ incertain';
  return `${row.id} · ${row.savedTitle} · ${best} · ${score} · ${mark}`;
}

export function unrecordedScripts(situations: Array<string | null>, all: ScriptRef[]): ScriptRef[] {
  const have = new Set(situations.filter((s): s is string => !!s));
  return all.filter((s) => !have.has(s.key));
}

export function formatMissing(missing: ScriptRef[]): string[] {
  if (!missing.length) return ['Tous les scripts 1–18 ont un vocal actif.'];
  return ['Sans enregistrement :', ...missing.map((s) => `${s.n} — ${s.title}`)];
}

/** Découpe sur les sauts de ligne pour rester sous la limite Telegram. */
export function chunkLines(lines: string[], limit = TELEGRAM_CHUNK): string[] {
  const out: string[] = [];
  let buf = '';
  for (const raw of lines) {
    const line = raw.length > limit ? raw.slice(0, limit) : raw;
    const next = buf ? `${buf}\n${line}` : line;
    if (buf && next.length > limit) {
      out.push(buf);
      buf = line;
    } else buf = next;
  }
  if (buf) out.push(buf);
  return out.length ? out : [''];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Lecture seule : select des vocaux actifs faq_voice et script_voice. Aucun update, insert ou delete. */
export async function loadActiveVoices(db: Db): Promise<StoredVoice[]> {
  const { data, error } = await db.from('support_assets')
    .select('id,kind,situation,file_id,lang,created_at')
    .eq('active', true)
    .in('kind', ['faq_voice', 'script_voice'])
    .order('id', { ascending: true })
    .limit(200);
  if (error) throw new Error(String(error.message ?? error));
  return ((data ?? []) as StoredVoice[]).filter((r) => !!r && (r.kind === 'faq_voice' || r.kind === 'script_voice'));
}

export async function runCheckVoices(opts: {
  chatId: number;
  loadAssets: () => Promise<StoredVoice[]>;
  transcribe: (fileId: string) => Promise<SttResult>;
  send: (chatId: number, text: string) => Promise<void>;
  enabled?: boolean;
  hasKey?: boolean;
  scripts: ScriptRef[];
  threshold?: number;
}): Promise<void> {
  const enabled = opts.enabled ?? sttCheckEnabled();
  const hasKey = opts.hasKey ?? Boolean(process.env.ELEVENLABS_API_KEY);
  const blocked = checkVoicesBlock(enabled, hasKey);
  if (blocked) {
    await opts.send(opts.chatId, blocked);
    return;
  }
  const threshold = opts.threshold ?? parseSttThreshold();
  const assets = [...await opts.loadAssets()].sort((a, b) => a.id - b.id);
  const rows: AuditRow[] = [];
  for (const asset of assets) {
    const transcript = await opts.transcribe(asset.file_id).catch(() => ({ ok: false as const, reason: 'timeout' }));
    rows.push(judgeAsset(asset, transcript, opts.scripts, threshold));
  }
  const lines = [
    'Contrôle des vocaux (lecture seule)',
    ...(rows.length ? rows.map(formatAuditRow) : ['Aucun vocal actif.']),
    ...formatMissing(unrecordedScripts(assets.map((a) => a.situation), opts.scripts)),
  ];
  for (const part of chunkLines(lines)) await opts.send(opts.chatId, part);
}
