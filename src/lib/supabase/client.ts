import { createBrowserClient } from '@supabase/ssr';

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[supabase/client] Missing ${name} environment variable.`);
  }
  return value;
}

/** Browser-side Supabase client (anon key, RLS enforced). Safe for Client Components. */
export function createClient() {
  return createBrowserClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}
