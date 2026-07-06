// STT PREMIUM — proxy ElevenLabs Scribe : la reco du navigateur massacre la parole ("Algoria" → "I'll go
// yeah") ; Scribe transcrit correctement. Le cockpit enregistre la question au micro (webm/opus) et l'envoie
// ici ; la clé reste côté serveur. Sans ELEVENLABS_API_KEY → 501 : le cockpit retombe sur la reco navigateur.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

async function isOperator(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  return !error && !!data.user;
}

export async function POST(req: NextRequest) {
  if (!(await isOperator(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: 'not configured' }, { status: 501 });

  const audio = await req.arrayBuffer();
  if (!audio.byteLength || audio.byteLength > 8_000_000) return NextResponse.json({ error: 'bad audio' }, { status: 400 });

  try {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: req.headers.get('content-type') ?? 'audio/webm' }), 'question.webm');
    form.append('model_id', 'scribe_v1');
    form.append('language_code', 'en'); // le live est en anglais — fixe la langue, évite les dérives
    form.append('tag_audio_events', 'false');
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
    if (!res.ok) {
      console.error('[algoria] scribe échec:', res.status, (await res.text()).slice(0, 200));
      return NextResponse.json({ error: 'stt failed' }, { status: 502 });
    }
    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ text: String(data.text ?? '').trim() });
  } catch (e) {
    console.error('[algoria] voice/stt échec:', e);
    return NextResponse.json({ error: 'stt failed' }, { status: 500 });
  }
}
