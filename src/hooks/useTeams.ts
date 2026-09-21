"use client";

import { useQuery } from "@tanstack/react-query";
import type { ActionResult, Team } from "@/lib/trackf-types";
import { listTeamsAction } from "@/app/actions/employees.actions";
import type { Team as ServiceTeam } from "@/services/teams.service";

export function mapServiceTeam(row: ServiceTeam): Team {
  return { id: row.id, name: row.name, memberCount: row.memberCount };
}

export function useTeams(tenantId: string) {
  const list = useQuery({
    queryKey: ["teams", tenantId],
    queryFn: async (): Promise<Team[]> => {
      const res = (await listTeamsAction(tenantId)) as ActionResult<ServiceTeam[]>;
      if (!res.ok) throw new Error(res.error);
      return res.data.map(mapServiceTeam);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  return { list, teams: list.data ?? [] };
}
