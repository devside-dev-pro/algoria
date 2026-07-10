// Helper PUSH côté CLIENT — logique partagée entre Profile (PushCard) et la popup d'install évoluée (ui.tsx),
// pour ne pas dupliquer permission + abonnement. iOS : `PushManager` n'existe QUE dans la PWA installée
// (Apple), donc hors standalone `pushState()` renvoie 'unsupported' → c'est l'install qu'on propose d'abord.

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

const b64ToU8 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export type PushState = 'unsupported' | 'off' | 'on' | 'denied';

/** État courant sans rien demander (pour décider quoi afficher). */
export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

/** Demande la permission + abonne + enregistre côté serveur. Renvoie true si abonné. */
export async function enablePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID) });
    const j = sub.toJSON();
    await fetch('/api/member/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint, keys: j.keys }) });
    return true;
  } catch {
    return false;
  }
}

/** Désabonne (côté serveur + navigateur). */
export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/member/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
}
