'use client';
// L'ancien back-office vivait ICI, dans la coque de l'app membre (nav mobile autour) — ce n'était pas un
// vrai outil. Le CRM a déménagé sur /admin (interface dédiée, desktop-first) ; on redirige les habitudes.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminMoved() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin'); }, [router]);
  return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>redirecting to the admin…</main>;
}
