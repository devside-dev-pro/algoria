// « HEY ALGORIA » — le cerveau de la voix. Le cockpit envoie la question dictée + un instantané du
// contexte live (prix, équity, positions, lectures du desk) ; Claude répond EN FRANÇAIS PARLÉ, court,
// prêt à être lu à voix haute sur le stream. Auth : jeton Supabase de l'opérateur (le cockpit est privé).
// Env Vercel : ANTHROPIC_API_KEY (sans elle → 501, la voix l'annonce poliment) · ALGORIA_VOICE_MODEL (optionnel).
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const MODEL = process.env.ALGORIA_VOICE_MODEL ?? 'claude-opus-4-8';

const SYSTEM = `Tu es ALGORIA, l'intelligence artificielle de trading qui trade l'or, le Nasdaq et le Bitcoin en direct sur un live TikTok. Tu parles avec une voix féminine, en FRANÇAIS PARLÉ NATUREL — ta réponse sera lue à voix haute telle quelle.
RÈGLES ABSOLUES : 1 à 3 phrases courtes maximum. Pas de markdown, pas de listes, pas d'emoji, pas de symboles ($ → dis « dollars »). Arrondis les nombres à ce qui se dit bien à l'oral. Ton : confiante, précise, un soupçon d'espièglerie — jamais robotique, jamais mielleuse.
Tu réponds en te basant UNIQUEMENT sur le CONTEXTE LIVE fourni (tes prix, tes positions, ton P&L, tes lectures de marché). Si l'information n'y est pas, dis-le simplement et propose ce que tu sais. Tu parles de TES trades et de TA stratégie ; tu ne donnes JAMAIS de conseil d'investissement personnalisé au spectateur — si on t'en demande, rappelle avec légèreté que tu trades ton propre compte et que chacun est responsable du sien.`;

async function isOperator(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  return !error && !!data.user; // le cockpit n'a que des comptes opérateur (pas d'inscription publique)
}

export async function POST(req: NextRequest) {
  if (!(await isOperator(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'not configured' }, { status: 501 });

  let body: { question?: string; context?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const question = String(body.question ?? '').slice(0, 500).trim();
  if (!question) return NextResponse.json({ error: 'empty question' }, { status: 400 });

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300, // réponse orale courte — pas de réflexion étendue : la latence prime sur le stream
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `CONTEXTE LIVE (JSON) : ${JSON.stringify(body.context ?? {}).slice(0, 4000)}\n\nQUESTION posée à l'oral sur le live : « ${question} »`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join(' ')
      .trim();
    return NextResponse.json({ text: text || 'Je n’ai rien à ajouter pour le moment.' });
  } catch (e) {
    console.error('[algoria] voice/ask échec:', e);
    return NextResponse.json({ error: 'ask failed' }, { status: 500 });
  }
}
