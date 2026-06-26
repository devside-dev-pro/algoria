'use client';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { Login } from '@/components/Login';
import { Cockpit } from '@/components/Cockpit';

export default function Page() {
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
