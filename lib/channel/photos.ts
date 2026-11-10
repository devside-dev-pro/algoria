// 📸 LA PHOTO DES COULISSES DU MATIN (10/11/2026, refonte du CM).
//
// SOURCE : un dossier Google Drive tenu par Mathieu (« Photos Mathieu - CM canal »), lu par le compte de service déjà
// utilisé pour la feuille des dépôts (PR #572). Variables :
//   CM_PHOTOS_DRIVE_FOLDER_ID           l'ID du dossier, attendu : 16deJ5VP0UbjSAecnNqzObFnPbhh5eweP
//   GOOGLE_SERVICE_ACCOUNT_EMAIL        déjà posée pour #572 : c'est l'adresse avec laquelle partager le dossier (Lecteur)
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  déjà posée pour #572
// Tant que CM_PHOTOS_DRIVE_FOLDER_ID n'est pas posée : la banque cm_photos (photos envoyées au bot), comme avant.
// Dossier configuré mais vide ou illisible : PAS de repli sur cm_photos (Mathieu a choisi le Drive), le post part en
// texte seul et les admins sont alertés.
//
// RÈGLES :
//   · jamais la même photo sur 30 jours ; si le dossier est petit, au moins (nombre de photos − 1) posts entre deux
//     passages de la même photo ; avec une seule photo déjà passée : texte seul, jamais de répétition ;
//   · une photo est « utilisée » à la PUBLICATION, plus au plan : un post refusé ou expiré ne la gaspille plus
//     (la trace = report.photo_key des posts publiés, aucune écriture dans Drive : le compte de service en Lecteur suffit) ;
//   · moins de 5 photos fraîches (pas passées depuis 30 jours) : alerte aux admins, une fois par jour.
import { createSign } from 'crypto';

export type PhotoCandidate = { key: string; name?: string };
export type PhotoUse = { key: string; at: number };
export const FRESH_DAYS = 30;
export const LOW_STOCK = 5;

/** Le choix, sans base ni réseau : la photo à prendre (ou null = texte seul) et le stock frais restant après elle. */
export function pickFresh(all: PhotoCandidate[], uses: PhotoUse[], now: number, rand: () => number = Math.random, exclude?: string | null): { pick: PhotoCandidate | null; freshLeft: number } {
  const pool = all.filter((p) => p.key !== exclude);
  const last = new Map<string, number>();
  for (const u of uses) if ((last.get(u.key) ?? 0) < u.at) last.set(u.key, u.at);
  const cutoff = now - FRESH_DAYS * 86_400_000;
  const strict = pool.filter((p) => (last.get(p.key) ?? 0) < cutoff);
  const freshAll = all.filter((p) => (last.get(p.key) ?? 0) < cutoff).length;
  if (strict.length) {
    // d'abord celles qui ne sont jamais passées, puis les plus anciennes ; un peu de hasard parmi les 3 premières
    strict.sort((a, b) => (last.get(a.key) ?? 0) - (last.get(b.key) ?? 0));
    const pick = strict[Math.floor(rand() * Math.min(3, strict.length))];
    return { pick, freshLeft: freshAll - 1 };
  }
  // petit dossier : on écarte les (n − 1) dernières passées, il reste la plus ancienne
  if (all.length < 2) return { pick: null, freshLeft: 0 };
  const recent = [...last.entries()].sort((a, b) => b[1] - a[1]).slice(0, all.length - 1).map(([k]) => k);
  const ok = pool.filter((p) => !recent.includes(p.key));
  if (!ok.length) return { pick: null, freshLeft: 0 };
  ok.sort((a, b) => (last.get(a.key) ?? 0) - (last.get(b.key) ?? 0));
  return { pick: ok[0], freshLeft: 0 };
}

// ── GOOGLE DRIVE (lecture seule) ──────────────────────────────────────────────────────────────────────

export type DriveEnv = { folderId: string; email: string; privateKey: string };
export function readDriveEnv(): DriveEnv | null {
  const folderId = String(process.env.CM_PHOTOS_DRIVE_FOLDER_ID ?? '').trim();
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim();
  const privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').trim().replace(/\\n/g, '\n');
  return folderId && email && privateKey ? { folderId, email, privateKey } : null;
}
/** Le dossier est-il la source (variable posée) ? Même si les clés manquent : on ne retombe pas en silence sur la banque. */
export const driveWanted = () => !!String(process.env.CM_PHOTOS_DRIVE_FOLDER_ID ?? '').trim();

const b64url = (b: Buffer | string) => (Buffer.isBuffer(b) ? b : Buffer.from(b)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
async function driveToken(env: DriveEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: env.email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))}`;
  const sign = createSign('RSA-SHA256');
  sign.update(unsigned);
  sign.end();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(8000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sign.sign(env.privateKey))}` }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('google token missing');
  return j.access_token;
}

/** Les images du dossier (JPEG/PNG/WebP de moins de 10 Mo, la limite d'une photo Telegram). Clé : « drive:<id> ». */
export async function listDrivePhotos(env: DriveEnv): Promise<PhotoCandidate[]> {
  const token = await driveToken(env);
  const out: PhotoCandidate[] = [];
  let page = '';
  for (let i = 0; i < 10; i++) {
    const q = encodeURIComponent(`'${env.folderId}' in parents and trashed = false and mimeType contains 'image/'`);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? `&pageToken=${page}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`drive list ${r.status}`);
    const j = (await r.json()) as { nextPageToken?: string; files?: Array<{ id: string; name?: string; mimeType?: string; size?: string }> };
    for (const f of j.files ?? []) {
      if (!/^image\/(jpeg|png|webp)$/i.test(String(f.mimeType)) || Number(f.size ?? 0) > 10 * 1024 * 1024) continue;
      out.push({ key: `drive:${f.id}`, name: f.name });
    }
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return out;
}

/** Télécharge une photo du dossier et l'envoie (multipart) à un chat Telegram. Renvoie le file_id Telegram, réutilisable
 *  ensuite partout par ce bot (canal, miroirs) sans retélécharger. */
export async function sendDrivePhoto(env: DriveEnv, driveId: string, chatId: number | string, caption: string, replyTo?: number): Promise<string | null> {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!tgToken) return null;
  const token = await driveToken(env);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`drive download ${r.status}`);
  const blob = new Blob([await r.arrayBuffer()], { type: r.headers.get('content-type') ?? 'image/jpeg' });
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('caption', caption.slice(0, 1000));
  if (replyTo) form.set('reply_to_message_id', String(replyTo));
  form.set('photo', blob, 'photo.jpg');
  const t = await fetch(`https://api.telegram.org/bot${tgToken}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  const d = (await t.json().catch(() => null)) as { ok?: boolean; result?: { photo?: Array<{ file_id: string }> } } | null;
  const sizes = d?.ok ? d.result?.photo ?? [] : [];
  return sizes.length ? sizes[sizes.length - 1].file_id : null;
}
