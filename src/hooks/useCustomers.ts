"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionResult, Customer } from "@/lib/trackf-types";
import { toPaged } from "@/lib/trackf-types";
import {
  createCustomerAction,
  listCustomersAction,
} from "@/app/actions/customers.actions";
import type { Customer as ServiceCustomer } from "@/services/customers.service";

export function mapServiceCustomer(row: ServiceCustomer): Customer {
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone_e164,
    ward: row.ward ?? undefined,
    bookingsCount: 0,
    totalSpentMinor: 0,
    currency: "TZS",
  };
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  ward?: string;
}

export function useCustomers(tenantId: string) {
  const list = useQuery({
    queryKey: ["customers", tenantId],
    queryFn: async (): Promise<Customer[]> => {
      const res = (await listCustomersAction(
        tenantId,
        {},
      )) as ActionResult<ServiceCustomer[]>;
      if (!res.ok) throw new Error(res.error);
      return toPaged<ServiceCustomer>(res.data).rows.map(mapServiceCustomer);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: CreateCustomerInput): Promise<Customer> => {
      const res = (await createCustomerAction(
        tenantId,
        input,
      )) as ActionResult<ServiceCustomer>;
      if (!res.ok) throw new Error(res.error);
      return mapServiceCustomer(res.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["customers", tenantId] }),
  });

  return { list, create };
}
