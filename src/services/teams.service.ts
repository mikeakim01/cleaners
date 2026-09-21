import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";

export const CreateTeamInputSchema = z.object({
  name: z.string().trim().min(2, "Team name must be at least 2 characters.").max(80),
  branchId: z.uuid("Invalid branch.").optional(),
  leadEmployeeId: z.uuid("Invalid team lead.").optional(),
});

export type CreateTeamInput = z.infer<typeof CreateTeamInputSchema>;

export interface Team {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  name: string;
  lead_employee_id: string | null;
  memberCount: number;
}

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

export async function createTeam(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<Team> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:update", db);
  const parsed = CreateTeamInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);

  try {
    if (input.leadEmployeeId) {
      const { data: lead, error: leadError } = await client
        .from("employees")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", input.leadEmployeeId)
        .eq("active", true)
        .is("deleted_at", null)
        .maybeSingle();
      if (leadError) throw leadError;
      if (!lead) throw new AppError("The selected team lead could not be found in this business.");
    }

    const { data, error } = await client
      .from("teams")
      .insert({
        tenant_id: tenantId,
        branch_id: input.branchId ?? null,
        name: input.name,
        lead_employee_id: input.leadEmployeeId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    const row = data as Record<string, unknown>;
    const team: Team = {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      branch_id: (row.branch_id as string | null) ?? null,
      name: String(row.name ?? ""),
      lead_employee_id: (row.lead_employee_id as string | null) ?? null,
      memberCount: 0,
    };

    await writeAudit(
      { tenantId, userId, action: "team.created", entity: "team", entityId: team.id, metadata: { name: input.name } },
      { throwOnError: false },
      client,
    );
    return team;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not create this team"));
  }
}

async function assertTeamInTenant(client: SupabaseClient, tenantId: string, teamId: string): Promise<void> {
  const { data, error } = await client
    .from("teams")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", teamId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("We could not find that team in this business.");
}

async function assertEmployeeInTenant(client: SupabaseClient, tenantId: string, employeeId: string): Promise<void> {
  const { data, error } = await client
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", employeeId)
    .eq("active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("The selected team member could not be found in this business.");
}

export async function addTeamMember(
  tenantId: string,
  userId: string,
  teamId: string,
  employeeId: string,
  db?: SupabaseClient,
): Promise<void> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:update", db);
  const parsed = z
    .object({ teamId: z.uuid("Invalid team."), employeeId: z.uuid("Invalid employee.") })
    .safeParse({ teamId, employeeId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const client = dbOrAdmin(db);

  try {
    await assertTeamInTenant(client, tenantId, teamId);
    await assertEmployeeInTenant(client, tenantId, employeeId);

    const { error } = await client.from("team_members").upsert(
      { tenant_id: tenantId, team_id: teamId, employee_id: employeeId },
      { onConflict: "team_id,employee_id" },
    );
    if (error) throw error;

    await writeAudit(
      { tenantId, userId, action: "team.member_added", entity: "team", entityId: teamId, metadata: { employeeId } },
      { throwOnError: false },
      client,
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not add this member"));
  }
}

export async function removeTeamMember(
  tenantId: string,
  userId: string,
  teamId: string,
  employeeId: string,
  db?: SupabaseClient,
): Promise<void> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:update", db);
  const parsed = z
    .object({ teamId: z.uuid("Invalid team."), employeeId: z.uuid("Invalid employee.") })
    .safeParse({ teamId, employeeId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const client = dbOrAdmin(db);

  try {
    await assertTeamInTenant(client, tenantId, teamId);
    const { error } = await client
      .from("team_members")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("team_id", teamId)
      .eq("employee_id", employeeId);
    if (error) throw error;

    await writeAudit(
      { tenantId, userId, action: "team.member_removed", entity: "team", entityId: teamId, metadata: { employeeId } },
      { throwOnError: false },
      client,
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not remove this member"));
  }
}

export async function listTeams(tenantId: string, userId: string, db?: SupabaseClient): Promise<Team[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:read", db);
  const client = dbOrAdmin(db);

  try {
    const { data: teams, error } = await client
      .from("teams")
      .select("id, tenant_id, branch_id, name, lead_employee_id")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (error) throw error;
    const rows = (teams ?? []) as Record<string, unknown>[];

    const { data: members } = await client
      .from("team_members")
      .select("team_id")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    const counts = new Map<string, number>();
    for (const m of (members ?? []) as Array<{ team_id: string }>) {
      counts.set(m.team_id, (counts.get(m.team_id) ?? 0) + 1);
    }

    return rows.map((r) => ({
      id: String(r.id),
      tenant_id: String(r.tenant_id),
      branch_id: (r.branch_id as string | null) ?? null,
      name: String(r.name ?? ""),
      lead_employee_id: (r.lead_employee_id as string | null) ?? null,
      memberCount: counts.get(String(r.id)) ?? 0,
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load teams"));
  }
}

export async function listTeamMembers(
  tenantId: string,
  userId: string,
  teamId: string,
  db?: SupabaseClient,
): Promise<Array<{ employee_id: string }>> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:read", db);
  const parsed = z.uuid("Invalid team.").safeParse(teamId);
  if (!parsed.success) throw new AppError("Invalid team.");
  const client = dbOrAdmin(db);

  try {
    await assertTeamInTenant(client, tenantId, teamId);
    const { data, error } = await client
      .from("team_members")
      .select("employee_id")
      .eq("tenant_id", tenantId)
      .eq("team_id", teamId)
      .is("deleted_at", null);
    if (error) throw error;
    return ((data ?? []) as Array<{ employee_id: string }>).map((r) => ({ employee_id: r.employee_id }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load team members"));
  }
}
