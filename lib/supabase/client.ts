import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/** Client navigateur (cockpit) — clé publishable, RLS protège les données. */
export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!,
);
