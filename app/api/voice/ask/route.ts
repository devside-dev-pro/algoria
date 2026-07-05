// « HEY ALGORIA » — le cerveau de la voix. Le cockpit envoie la question dictée + un instantané du
// contexte live (prix, équity, positions, lectures du desk) ; Claude répond EN FRANÇAIS PARLÉ, court,
// prêt à être lu à voix haute sur le stream. Auth : jeton Supabase de l'opérateur (le cockpit est privé).
// Env Vercel : ANTHROPIC_API_KEY (sans elle → 501, la voix l'annonce poliment) · ALGORIA_VOICE_MODEL (optionnel).
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const MODEL = process.env.ALGORIA_VOICE_MODEL ?? 'claude-opus-4-8';

const SYSTEM = `You are ALGORIA, the AI that trades gold, the Nasdaq and Bitcoin live on a TikTok stream. You speak with a female voice, in NATURAL SPOKEN ENGLISH — your answer will be read out loud exactly as written.
HARD RULES: 1 to 3 short sentences maximum. No markdown, no lists, no emoji, no symbols ($ → say "dollars"). Round numbers to what sounds natural out loud. Tone: confident, sharp, a hint of playfulness — never robotic, never sugary.
The transcribed question may begin with a garbled version of your name ("Algeria", "algorithm", "I'll go yeah"…) — ignore that fragment. Answer ONLY from the LIVE CONTEXT provided (your prices, positions, P&L, market reads). If the information isn't there, say so plainly and offer what you do know. You talk about YOUR trades and YOUR strategy; you NEVER give personalized investment advice to a viewer — if asked, remind them lightly that you trade your own account and everyone is responsible for theirs.`;

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
          content: `LIVE CONTEXT (JSON): ${JSON.stringify(body.context ?? {}).slice(0, 4000)}\n\nQUESTION asked out loud on the live stream: "${question}"`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join(' ')
      .trim();
    return NextResponse.json({ text: text || "Nothing to add right now." });
  } catch (e) {
    console.error('[algoria] voice/ask échec:', e);
    return NextResponse.json({ error: 'ask failed' }, { status: 500 });
  }
}
