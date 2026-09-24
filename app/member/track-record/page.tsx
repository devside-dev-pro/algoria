'use client';
// TRACK RECORD (in-app) — le VRAI historique du compte qu'Algoria copie, depuis le lancement (juillet 2026).
// Remplace la simulation du 24/09/2026 ; tout le rendu vit dans components/TrackRecord.tsx, partagé avec la
// page publique /track-record pour qu'il n'y ait jamais deux versions des mêmes chiffres.
import { useRouter } from 'next/navigation';
import { TrackRecord } from '@/components/TrackRecord';

export default function TrackRecordPage() {
  const router = useRouter();
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      <button onClick={() => router.push('/member/history')} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12.5, padding: '2px 0' }}>
        ‹ History
      </button>
      <TrackRecord />
      <button onClick={() => router.push('/member/history')} style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(43,227,245,.35)', background: 'rgba(43,227,245,.06)', color: 'var(--cyan)', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
        ← Back to Algoria&rsquo;s live trades
      </button>
    </main>
  );
}
