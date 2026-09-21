import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[supabase/server] Missing ${name} environment variable.`);
  }
  return value;
}

/**
 * Server-side Supabase client (anon key, RLS enforced for the signed-in user).
 * Use in Server Components, Server Actions, and Route Handlers. `cookies()`
 * is async in this Next.js version, so this factory is async as well.
 *
 * `createServerSupabaseClient` is an alias kept for call-site readability.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where setting cookies is not
            // allowed; the Supabase Proxy refreshes the session instead.
          }
        },
      },
    },
  );
}

/** Alias of createClient for call-site readability. */
export const createServerSupabaseClient = createClient;
