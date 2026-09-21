import "server-only";

import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export class NotSuperAdminError extends Error {
  readonly code = "NOT_SUPER_ADMIN" as const;

  constructor(message = "Platform admin access required.") {
    super(message);
    this.name = "NotSuperAdminError";
  }
}

export interface SuperAdminIdentity {
  userId: string;
  email: string | null;
}

/**
 * Pure helper: true when the Supabase user carries
 * app_metadata.is_super_admin === true. Never trust client headers —
 * this reads the server-verified auth user object only.
 */
export function isSuperAdminUser(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  if (!user) return false;
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  return meta["is_super_admin"] === true;
}

/**
 * Require platform super-admin for the current session.
 * Uses the RLS-enforced server client + getUser() (auth server verification),
 * then checks the app_metadata claim from the verified user.
 *
 * @throws NotSuperAdminError when signed out or not a platform admin.
 */
export async function requireSuperAdmin(): Promise<SuperAdminIdentity> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new NotSuperAdminError("Platform admin access required.");
  }

  if (!isSuperAdminUser(user)) {
    throw new NotSuperAdminError("Platform admin access required.");
  }

  return { userId: user.id, email: user.email ?? null };
}
