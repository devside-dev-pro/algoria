'use client';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { Login } from '@/components/Login';
import { Cockpit } from '@/components/Cockpit';

// Cockpit opérateur (protégé) — déplacé de "/" vers "/app" pour libérer le domaine racine au funnel public.
// Source OBS : algoria.tech/app?broadcast=1
export default function AppPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--dim)' }}>…</main>;
  return session ? <Cockpit /> : <Login />;
}
