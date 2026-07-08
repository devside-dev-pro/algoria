// Cœur SERVEUR de l'espace membre (app.algoria.tech) — n'importer QUE depuis des routes/API server-side.
// 3 responsabilités : client Supabase service-role, session signée (cookie), chiffrement des identifiants MT5.
//
// Env Vercel (server-only) :
//   MEMBER_SESSION_SECRET — secret HMAC des cookies de session (chaîne aléatoire longue)
//   MEMBER_CREDS_KEY      — clé AES-256 hex (64 caractères) pour les mots de passe MT5
//   ADMIN_TG_USERNAMES    — @ Telegram (sans @, séparés par des virgules) autorisés sur /member/admin
//   TELEGRAM_BOT_TOKEN    — déjà présent (webhook) ; sert aussi à vérifier le Login Widget
import { createHmac, createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ===== Supabase service-role (lazy : jamais instancié au build) =====
let _db: SupabaseClient | null = null;
export function sdb(): SupabaseClient {
  if (!_db) _db = createClient(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
  return _db;
}

// ===== Session membre : token compact signé HMAC-SHA256 (pas de dépendance JWT) =====
export interface MemberSession { tgId: number; username: string | null; name: string; iat: number }
const b64u = (b: Buffer) => b.toString('base64url');
const sec = () => {
  const s = process.env.MEMBER_SESSION_SECRET;
  if (!s) throw new Error('MEMBER_SESSION_SECRET manquant');
  return s;
};

export function signSession(s: MemberSession): string {
  const body = b64u(Buffer.from(JSON.stringify(s)));
  const sig = b64u(createHmac('sha256', sec()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null, maxAgeMs = 30 * 86_400_000): MemberSession | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const good = createHmac('sha256', sec()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== good.length || !timingSafeEqual(given, good)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as MemberSession;
    if (!s.tgId || Date.now() - s.iat > maxAgeMs) return null;
    return s;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = 'alg_member';

// ===== Vérification du Telegram Login Widget (https://core.telegram.org/widgets/login) =====
// data-onauth renvoie id/first_name/username/photo_url/auth_date + hash ; hash = HMAC-SHA256 du
// data_check_string avec pour clé SHA256(bot_token). On borne auth_date à 24 h (anti-rejeu).
export function verifyTelegramLogin(params: Record<string, string>): { ok: boolean; reason?: string } {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: 'bot token absent' };
  const { hash, ...rest } = params;
  if (!hash) return { ok: false, reason: 'hash absent' };
  const check = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('\n');
  const key = createHash('sha256').update(token).digest();
  const expected = createHmac('sha256', key).update(check).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'signature invalide' };
  if (Math.abs(Date.now() / 1000 - Number(rest.auth_date)) > 86_400) return { ok: false, reason: 'session expirée — reconnecte-toi' };
  return { ok: true };
}

// ===== ACCÈS VIP/ÉQUIPE (member_whitelist) : app COMPLÈTE débloquée sans connexion copieur =====
// Usage : CM (screens vue utilisateur), partenaires, invités de confiance. Ne touche PAS au statut —
// la personne reste 'onboarding' côté copieur, elle voit juste tout (le mode teaser saute pour elle).
export async function isVip(username: string | null | undefined): Promise<boolean> {
  const uname = (username ?? '').trim().toLowerCase();
  if (!uname) return false;
  const { data } = await sdb().from('member_whitelist').select('username').eq('username', uname).limit(1);
  return !!data?.length;
}

export function isAdmin(username: string | null | undefined): boolean {
  if (!username) return false;
  const admins = (process.env.ADMIN_TG_USERNAMES ?? '').split(/[\s,@]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(username.toLowerCase());
}

// ===== Chiffrement des identifiants MT5 : AES-256-GCM, format iv.tag.data (base64url) =====
const credsKey = () => {
  const hex = process.env.MEMBER_CREDS_KEY;
  if (!hex || hex.length !== 64) throw new Error('MEMBER_CREDS_KEY manquante ou invalide (attendu : 64 caractères hex)');
  return Buffer.from(hex, 'hex');
};

/** Code de parrainage court (8 hex) — généré à la création du membre. */
export const newReferralCode = () => randomBytes(4).toString('hex');

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', credsKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(data)}`;
}

export function decryptSecret(enc: string): string {
  const [iv, tag, data] = enc.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', credsKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
