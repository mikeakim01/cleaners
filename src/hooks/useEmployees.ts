"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionResult, Employee } from "@/lib/trackf-types";
import { toPaged } from "@/lib/trackf-types";
import {
  createEmployeeAction,
  listEmployeesAction,
} from "@/app/actions/employees.actions";
import type { Employee as ServiceEmployee } from "@/services/employees.service";

export function mapServiceEmployee(row: ServiceEmployee): Employee {
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone_e164 ?? undefined,
    role: row.role,
    teamId: undefined,
    teamName: undefined,
    avatarUrl: undefined,
    active: row.active,
  };
}

const VALID_ROLES = new Set(["CLEANER", "DRIVER", "SUPERVISOR", "MANAGER"]);

export interface CreateEmployeeInput {
  name: string;
  phone?: string;
  role?: string;
  teamId?: string;
}

export function useEmployees(tenantId: string) {
  const list = useQuery({
    queryKey: ["employees", tenantId],
    queryFn: async (): Promise<Employee[]> => {
      const res = (await listEmployeesAction(
        tenantId,
        {},
      )) as ActionResult<ServiceEmployee[]>;
      if (!res.ok) throw new Error(res.error);
      return toPaged<ServiceEmployee>(res.data).rows.map(mapServiceEmployee);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: CreateEmployeeInput): Promise<Employee> => {
      const role = input.role && VALID_ROLES.has(input.role) ? input.role : "CLEANER";
      const payload: Record<string, unknown> = { fullName: input.name, role };
      if (input.phone) payload.phone = input.phone;
      const res = (await createEmployeeAction(
        tenantId,
        payload,
      )) as ActionResult<ServiceEmployee>;
      if (!res.ok) throw new Error(res.error);
      return mapServiceEmployee(res.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["employees", tenantId] }),
  });

  return { list, create };
}
