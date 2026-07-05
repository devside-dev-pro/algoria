// TTS PREMIUM (optionnel) — proxy ElevenLabs : la clé reste côté serveur, le cockpit reçoit un MP3.
// Sans ELEVENLABS_API_KEY → 501 : le moteur vocal du cockpit bascule sur la voix du navigateur (repli gratuit).
// Env Vercel : ELEVENLABS_API_KEY · ELEVENLABS_VOICE_ID (optionnel — défaut : voix féminine multilingue).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL'; // "Sarah" — douce, naturelle, parle français (multilingual v2)

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

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const text = String(body.text ?? '').slice(0, 600).trim();
  if (!text) return NextResponse.json({ error: 'empty text' }, { status: 400 });

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.8 }, // stabilité modérée → intonation vivante pour le live
      }),
    });
    if (!res.ok) {
      console.error('[algoria] elevenlabs échec:', res.status, (await res.text()).slice(0, 200));
      return NextResponse.json({ error: 'tts failed' }, { status: 502 });
    }
    return new NextResponse(await res.arrayBuffer(), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.error('[algoria] voice/tts échec:', e);
    return NextResponse.json({ error: 'tts failed' }, { status: 500 });
  }
}
