import { describe, expect, it } from "vitest";

import {
  assertJobAssignee,
  assertJobTransitionAllowed,
  canTransitionJob,
  JOB_STATUSES,
  JOB_TRANSITIONS,
  type JobStatus,
} from "../src/services/jobs.service";

describe("JOB_TRANSITIONS", () => {
  it("covers all 7 job statuses", () => {
    expect(JOB_STATUSES).toHaveLength(7);
    for (const status of JOB_STATUSES) {
      expect(JOB_TRANSITIONS[status as JobStatus]).toBeDefined();
    }
  });

  it("walks the full chain SCHEDULED -> ... -> COMPLETED", () => {
    const path: Array<[JobStatus, JobStatus]> = [
      ["SCHEDULED", "ASSIGNED"],
      ["ASSIGNED", "EN_ROUTE"],
      ["EN_ROUTE", "ARRIVED"],
      ["ARRIVED", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
    ];
    for (const [from, to] of path) {
      expect(canTransitionJob(from, to), `${from} -> ${to}`).toBe(true);
      expect(() => assertJobTransitionAllowed(from, to), `${from} -> ${to}`).not.toThrow();
    }
  });

  it("rejects skipping EN_ROUTE (SCHEDULED -> EN_ROUTE)", () => {
    expect(canTransitionJob("SCHEDULED", "EN_ROUTE")).toBe(false);
    expect(() => assertJobTransitionAllowed("SCHEDULED", "EN_ROUTE")).toThrow(
      "Cannot move job from SCHEDULED to EN_ROUTE.",
    );
  });

  it("rejects skipping ARRIVED (ASSIGNED -> IN_PROGRESS)", () => {
    expect(canTransitionJob("ASSIGNED", "IN_PROGRESS")).toBe(false);
  });

  it("allows CANCELLED from SCHEDULED / ASSIGNED only", () => {
    expect(canTransitionJob("SCHEDULED", "CANCELLED")).toBe(true);
    expect(canTransitionJob("ASSIGNED", "CANCELLED")).toBe(true);
    expect(canTransitionJob("EN_ROUTE", "CANCELLED")).toBe(false);
    expect(canTransitionJob("IN_PROGRESS", "CANCELLED")).toBe(false);
  });

  it("locks terminal COMPLETED / CANCELLED", () => {
    for (const terminal of ["COMPLETED", "CANCELLED"] as const) {
      expect(JOB_TRANSITIONS[terminal]).toEqual([]);
      expect(() => assertJobTransitionAllowed(terminal, "ASSIGNED")).toThrow(
        `Cannot move job from ${terminal} to ASSIGNED.`,
      );
    }
  });
});

describe("field-staff job ownership (pure)", () => {
  const assigned = ["emp-1", "emp-2"];

  it("lets managers move any job without assignment", () => {
    expect(() => assertJobAssignee("MANAGER", null, assigned)).not.toThrow();
    expect(() => assertJobAssignee("OWNER", null, [])).not.toThrow();
  });

  it("lets an assigned cleaner update their job", () => {
    expect(() => assertJobAssignee("CLEANER", "emp-1", assigned)).not.toThrow();
    expect(() => assertJobAssignee("DRIVER", "emp-2", assigned)).not.toThrow();
  });

  it("blocks an unassigned cleaner with a human message", () => {
    expect(() => assertJobAssignee("CLEANER", "emp-9", assigned)).toThrow("You are not assigned to this job.");
  });

  it("blocks field staff with no linked employee record", () => {
    expect(() => assertJobAssignee("CLEANER", null, assigned)).toThrow("You are not assigned to this job.");
    expect(() => assertJobAssignee("DRIVER", "emp-1", [])).toThrow("You are not assigned to this job.");
  });
});
