// Transcription d’un vocal Telegram pour le mode guidé.
// Même fournisseur que le cockpit (app/api/voice/stt/route.ts) : ElevenLabs Scribe, modèle scribe_v1,
// clé ELEVENLABS_API_KEY. Le fichier est téléchargé via getFile du bot (lib/member/businessInbox.ts).
// N’envoie rien à un prospect. Une erreur ou un délai renvoie ok:false, jamais une exception.

const SCRIBE_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
export const SCRIBE_MODEL = 'scribe_v1';
const MAX_BYTES = 8_000_000;

export type SttResult = { ok: true; text: string } | { ok: false; reason: string };

export async function transcribeTelegramVoice(fileId: string): Promise<SttResult> {
  const key = process.env.ELEVENLABS_API_KEY;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!key || !token || !fileId) return { ok: false, reason: 'config' };
  try {
    const { tg } = await import('../member/businessInbox');
    const f = await tg('getFile', { file_id: fileId });
    const path = String(f.result?.file_path ?? '');
    if (!f.ok || !path) return { ok: false, reason: 'getFile' };
    if (Number(f.result?.file_size ?? 0) > MAX_BYTES) return { ok: false, reason: 'size' };
    const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!audioRes.ok) return { ok: false, reason: 'download' };
    const audio = await audioRes.arrayBuffer();
    if (!audio.byteLength || audio.byteLength > MAX_BYTES) return { ok: false, reason: 'size' };
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/ogg' }), 'voice.ogg');
    form.append('model_id', SCRIBE_MODEL);
    form.append('language_code', 'en');
    form.append('tag_audio_events', 'false');
    const res = await fetch(SCRIBE_URL, {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, reason: 'scribe' };
    const data = (await res.json()) as { text?: string };
    const text = String(data.text ?? '').trim();
    if (!text) return { ok: false, reason: 'empty' };
    return { ok: true, text };
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    return { ok: false, reason: /timeout|abort/i.test(name) ? 'timeout' : 'network' };
  }
}
