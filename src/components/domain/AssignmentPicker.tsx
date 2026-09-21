"use client";

import { Avatar, LoadingState, Select } from "@/components/ui";
import { t } from "@/i18n";
import { formatPhone255 } from "@/lib/format";
import type { Employee, Team } from "@/lib/trackf-types";

export interface AssignmentPickerProps {
  employees: Employee[];
  teams: Team[];
  selectedTeamId: string;
  selectedEmployeeIds: string[];
  onTeamChange: (teamId: string) => void;
  onEmployeesChange: (ids: string[]) => void;
  loading?: boolean;
}

export function AssignmentPicker({
  employees,
  teams,
  selectedTeamId,
  selectedEmployeeIds,
  onTeamChange,
  onEmployeesChange,
  loading = false,
}: AssignmentPickerProps) {
  if (loading) return <LoadingState label={t("common.loading")} />;

  const toggle = (id: string) => {
    onEmployeesChange(
      selectedEmployeeIds.includes(id)
        ? selectedEmployeeIds.filter((e) => e !== id)
        : [...selectedEmployeeIds, id],
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Select
        label={t("teams.selectTeam")}
        value={selectedTeamId}
        onChange={(e) => onTeamChange(e.target.value)}
        options={teams.map((tm) => ({
          value: tm.id,
          label: `${tm.name} (${tm.memberCount})`,
        }))}
        placeholder={t("teams.selectTeam")}
      />
      <fieldset>
        <legend className="text-sm font-medium text-ink">
          {t("jobs.assignEmployees")}
        </legend>
        <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
          {employees.map((e) => (
            <li key={e.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-input px-2 py-2 hover:bg-canvas">
                <input
                  type="checkbox"
                  checked={selectedEmployeeIds.includes(e.id)}
                  onChange={() => toggle(e.id)}
                  className="size-4 accent-[#0F766E]"
                />
                <Avatar name={e.name} src={e.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {e.name}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {[e.teamName, e.phone ? formatPhone255(e.phone) : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}
