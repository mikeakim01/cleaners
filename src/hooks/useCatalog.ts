"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionResult, ServiceItem } from "@/lib/trackf-types";
import { toPaged } from "@/lib/trackf-types";
import {
  createServiceAction,
  listServicesAction,
} from "@/app/actions/catalog.actions";
import type { CatalogService } from "@/services/catalog.service";

export function mapCatalogService(row: CatalogService): ServiceItem {
  return {
    id: row.id,
    name: row.name,
    pricingModel: row.pricing_model,
    baseMinor: row.base_price_minor,
    unitMinor: row.unit_price_minor,
    unitLabel: undefined,
    currency: "TZS",
    active: row.active,
  };
}

export interface CreateServiceInput {
  name: string;
  pricingModel: string;
  baseMinor: number;
  unitMinor?: number;
  unitLabel?: string;
}

const VALID_PRICING_MODELS = new Set([
  "FIXED",
  "PER_HOUR",
  "PER_ROOM",
  "PER_SQM",
  "PER_ITEM",
  "PER_UNIT",
  "CUSTOM_QUOTE",
]);

export function useCatalog(tenantId: string) {
  const list = useQuery({
    queryKey: ["catalog", tenantId],
    queryFn: async (): Promise<ServiceItem[]> => {
      const res = (await listServicesAction(
        tenantId,
        { activeOnly: false },
      )) as ActionResult<CatalogService[]>;
      if (!res.ok) throw new Error(res.error);
      return toPaged<CatalogService>(res.data).rows.map(mapCatalogService);
    },
    enabled: tenantId.length > 0,
    staleTime: 30_000,
  });

  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: CreateServiceInput): Promise<ServiceItem> => {
      const pricingModel = VALID_PRICING_MODELS.has(input.pricingModel)
        ? input.pricingModel
        : "FIXED";
      const res = (await createServiceAction(tenantId, {
        name: input.name,
        pricingModel,
        baseMinor: input.baseMinor,
        unitMinor: input.unitMinor ?? 0,
      })) as ActionResult<CatalogService>;
      if (!res.ok) throw new Error(res.error);
      return mapCatalogService(res.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["catalog", tenantId] }),
  });

  return { list, create };
}
