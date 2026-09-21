"use client";

import { useState } from "react";
import { Button, Drawer, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { AssignmentPicker } from "@/components/domain/AssignmentPicker";
import { JobCard } from "@/components/domain/JobCard";
import { useEmployees } from "@/hooks/useEmployees";
import { useJobs } from "@/hooks/useJobs";
import { useTeams } from "@/hooks/useTeams";
import { t } from "@/i18n";
import type { Job, Paged } from "@/lib/trackf-types";

const NEXT_BY_STATUS: Record<string, string> = {
  scheduled: "en_route",
  assigned: "en_route",
  en_route: "in_progress",
  in_progress: "completed",
};

export function JobsClient({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: Paged<Job>;
}) {
  const { list, assignTeamToJob, assignEmployeesToJob, advance } = useJobs(tenantId);
  const employees = useEmployees(tenantId);
  const { teams } = useTeams(tenantId);

  const [active, setActive] = useState<Job | null>(null);
  const [teamId, setTeamId] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  const rows = list.data?.rows ?? initial.rows;

  const onCardAction = (job: Job) => {
    setFeedback(null);
    const next = NEXT_BY_STATUS[job.status];
    if (next) {
      advance.mutate(
        { jobId: job.id, to: next },
        {
          onSuccess: () => setFeedback(t("jobs.advanceSuccess")),
          onError: (e) => setFeedback((e as Error).message),
        },
      );
    } else {
      setActive(job);
      setTeamId(job.teamId ?? "");
      setEmployeeIds([]);
    }
  };

  const confirmAssign = async () => {
    if (!active) return;
    setFeedback(null);
    try {
      if (teamId) {
        await assignTeamToJob.mutateAsync({ jobId: active.id, teamId });
      }
      if (employeeIds.length > 0) {
        await assignEmployeesToJob.mutateAsync({ jobId: active.id, employeeIds });
      }
      setFeedback(t("jobs.assignSuccess"));
      setActive(null);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("jobs.title")}</h1>
        <p className="text-sm text-muted">{t("jobs.subtitle")}</p>
      </div>

      {feedback ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
      ) : null}

      {list.isPending && rows.length === 0 ? (
        <LoadingState label={t("common.loading")} />
      ) : list.isError && rows.length === 0 ? (
        <ErrorState
          message={(list.error as Error).message}
          onRetry={() => list.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t("jobs.emptyTitle")} description={t("jobs.emptyBody")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onAction={onCardAction}
              actionPending={advance.isPending}
            />
          ))}
        </div>
      )}

      <Drawer
        open={active !== null}
        onClose={() => setActive(null)}
        title={t("jobs.assignCrew")}
      >
        <AssignmentPicker
          employees={employees.list.data ?? []}
          teams={teams}
          selectedTeamId={teamId}
          selectedEmployeeIds={employeeIds}
          onTeamChange={setTeamId}
          onEmployeesChange={setEmployeeIds}
          loading={employees.list.isPending}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setActive(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={confirmAssign}
            loading={assignEmployeesToJob.isPending || assignTeamToJob.isPending}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
