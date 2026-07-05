// PONT TIKTOK LIVE — quand le mode AUTOPILOT est armé, le runner se branche sur le chat du live TikTok
// (tiktok-live-connector, non officiel : juste le @pseudo, aucun mot de passe) et pousse chaque commentaire
// dans live_comments → le cockpit les lit en temps réel et Algoria répond à voix haute sur le stream.
// Résilient : reconnexion auto (le live peut couper/reprendre), throttle anti-spam, jamais bloquant pour le trading.
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

let conn: TikTokLiveConnection | null = null;
let wantOn = false;
let retryTimer: NodeJS.Timeout | null = null;
let recentAt: number[] = []; // throttle global : max ~8 commentaires/2s (raid de spam → on échantillonne)

export function tiktokActive(): boolean {
  return wantOn;
}

export async function startTikTok(username: string, onComment: (user: string, text: string) => void): Promise<void> {
  wantOn = true;
  if (conn) return;
  const connect = async () => {
    if (!wantOn || conn) return;
    const c = new TikTokLiveConnection(username.replace(/^@/, ''), {});
    conn = c;
    c.on(WebcastEvent.CHAT, (d: { user?: { uniqueId?: string; nickname?: string }; comment?: string }) => {
      const text = (d?.comment ?? '').trim();
      const user = (d?.user?.uniqueId ?? d?.user?.nickname ?? 'viewer').trim();
      if (!text || text.length < 2 || text.length > 220) return;
      const now = Date.now();
      recentAt = recentAt.filter((t) => now - t < 2000);
      if (recentAt.length >= 8) return; // raid/spam → on laisse passer un échantillon
      recentAt.push(now);
      onComment(user, text);
    });
    c.on(ControlEvent.DISCONNECTED, () => {
      conn = null;
      if (wantOn) scheduleRetry(username, onComment, 15_000); // le live a coupé → on retente (il peut reprendre)
    });
    try {
      const state = await c.connect();
      console.log(`[algoria] tiktok : branché sur le live de @${username} (roomId ${state?.roomId ?? '?'})`);
    } catch (e) {
      conn = null;
      console.error(`[algoria] tiktok : connexion échouée (live pas démarré ?) — retry dans 30 s :`, (e as Error)?.message ?? e);
      scheduleRetry(username, onComment, 30_000);
    }
  };
  await connect();
}

function scheduleRetry(username: string, onComment: (user: string, text: string) => void, ms: number) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void startTikTok(username, onComment).catch(() => {});
  }, ms);
}

export function stopTikTok(): void {
  wantOn = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  try {
    conn?.disconnect();
  } catch {
    /* déjà coupé */
  }
  conn = null;
  console.log('[algoria] tiktok : pont coupé');
}
