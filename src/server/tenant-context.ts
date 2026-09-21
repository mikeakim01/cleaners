import 'server-only';

import { z } from 'zod';

import { getSupabaseAdmin } from './supabase-admin';

export class TenantAccessDeniedError extends Error {
  readonly code = 'TENANT_ACCESS_DENIED';

  constructor(message = 'Access to this tenant is denied.') {
    super(message);
    this.name = 'TenantAccessDeniedError';
  }
}

const ResolveTenantInputSchema = z.object({
  /** Authenticated Supabase user id (from the session, never from the client). */
  userId: z.uuid('userId must be a valid UUID'),
  /**
   * Tenant the caller claims to act on: a tenant UUID *or* a tenant slug
   * (dashboard routes carry the slug). Slugs are resolved server-side via
   * the service role and then verified against the membership table —
   * a mismatch is rejected, never trusted.
   */
  requestedTenantId: z.string().trim().min(1).max(80).optional(),
});

export type ResolveTenantInput = z.infer<typeof ResolveTenantInputSchema>;

export interface TenantMembership {
  tenant_id: string;
  role: string;
}

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: string;
}

/** Injectable membership lookup so tenant resolution is unit-testable. */
export interface MembershipProvider {
  listMemberships: (userId: string) => Promise<TenantMembership[]>;
  /**
   * Resolve a tenant slug to its id (slugs are globally unique).
   * Only consulted when the caller passes a non-UUID tenant reference.
   */
  resolveTenantIdBySlug?: (slug: string) => Promise<string | null>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const defaultMembershipProvider: MembershipProvider = {
  async listMemberships(userId: string): Promise<TenantMembership[]> {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      throw new TenantAccessDeniedError(
        'Unable to verify tenant membership.',
      );
    }
    return (data ?? []) as TenantMembership[];
  },

  async resolveTenantIdBySlug(slug: string): Promise<string | null> {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('tenants')
      .select('id')
      .eq('slug', slug.toLowerCase())
      .is('deleted_at', null)
      .maybeSingle();
    if (error) {
      throw new TenantAccessDeniedError(
        'Unable to verify tenant membership.',
      );
    }
    return (data as { id: string } | null)?.id ?? null;
  },
};

/**
 * Pure tenant selection: picks the membership to act on and rejects
 * client-supplied tenant ids that the user does not belong to.
 *
 * @throws TenantAccessDeniedError when the user has no memberships, or when
 *         `requestedTenantId` is not among them.
 */
export function assertTenantAccess(
  memberships: readonly TenantMembership[],
  requestedTenantId?: string,
): TenantMembership {
  if (memberships.length === 0) {
    throw new TenantAccessDeniedError(
      'No tenant membership found for this user.',
    );
  }

  if (requestedTenantId === undefined) {
    // Single-tenant users get their only tenant; multi-tenant users must
    // choose explicitly so requests can never leak across tenants.
    if (memberships.length > 1) {
      throw new TenantAccessDeniedError(
        'Multiple tenant memberships found; requestedTenantId is required.',
      );
    }
    const only = memberships[0];
    if (!only) {
      throw new TenantAccessDeniedError(
        'No tenant membership found for this user.',
      );
    }
    return only;
  }

  const match = memberships.find(
    (m) => m.tenant_id.toLowerCase() === requestedTenantId.toLowerCase(),
  );
  if (!match) {
    throw new TenantAccessDeniedError(
      'The requested tenant is not in the user membership list.',
    );
  }
  return match;
}

/**
 * Resolves the tenant context for an authenticated user via a service-role
 * membership check. The client-supplied tenant id is treated as an untrusted
 * claim and verified — never trusted.
 *
 * The service role bypasses RLS, so callers MUST scope every subsequent query
 * with `ctx.tenantId` (e.g. `.eq('tenant_id', ctx.tenantId)`).
 */
export async function resolveTenant(
  input: ResolveTenantInput,
  provider: MembershipProvider = defaultMembershipProvider,
): Promise<TenantContext> {
  const parsed = ResolveTenantInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new TenantAccessDeniedError(
      `Invalid tenant resolution input: ${parsed.error.issues[0]?.message ?? 'validation failed'}`,
    );
  }

  const memberships = await provider.listMemberships(parsed.data.userId);
  const requested = parsed.data.requestedTenantId;

  // Slug path: dashboard routes carry the tenant slug. Resolve it
  // server-side, then verify membership exactly like a UUID claim.
  if (requested !== undefined && !UUID_RE.test(requested)) {
    const resolvedId = await provider.resolveTenantIdBySlug?.(
      requested.toLowerCase(),
    );
    if (!resolvedId) {
      throw new TenantAccessDeniedError(
        'We could not find that business. Check the link or ask your manager for access.',
      );
    }
    const membership = assertTenantAccess(memberships, resolvedId);
    return {
      tenantId: membership.tenant_id,
      userId: parsed.data.userId,
      role: membership.role,
    };
  }

  const membership = assertTenantAccess(memberships, requested);

  return {
    tenantId: membership.tenant_id,
    userId: parsed.data.userId,
    role: membership.role,
  };
}

/** Resolves the tenant, then runs `fn` with the verified context. */
export async function withTenantContext<T>(
  input: ResolveTenantInput,
  fn: (ctx: TenantContext) => Promise<T>,
  provider?: MembershipProvider,
): Promise<T> {
  const ctx = await resolveTenant(input, provider);
  return fn(ctx);
}
