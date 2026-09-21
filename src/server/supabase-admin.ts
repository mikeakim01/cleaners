import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedAdmin: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Bypasses RLS — server use only.
 *
 * Every query through this client MUST be explicitly scoped with the tenant id
 * from `resolveTenant()` (see ./tenant-context.ts). Never expose this client,
 * nor data fetched with it, to untrusted callers without tenant scoping.
 *
 * @throws When NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      '[supabase-admin] Missing NEXT_PUBLIC_SUPABASE_URL environment variable.',
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      '[supabase-admin] Missing SUPABASE_SERVICE_ROLE_KEY environment variable. ' +
        'This key must only ever exist on the server.',
    );
  }

  cachedAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}
