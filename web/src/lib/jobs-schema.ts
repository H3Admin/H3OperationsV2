/**
 * jobs-schema.ts — Front-end mirror of the READ-side of the canonical job
 * schema. The source of truth is functions/src/schema/jobs.js (server,
 * CommonJS). This is a deliberate minimal copy: only what the Scheduling UI
 * needs to READ and display. Write factories (buildNewJob, buildJobUpdate)
 * stay server-only and are NOT duplicated here.
 *
 * If a field, enum, or path changes in jobs.js, mirror it here by hand.
 */

// Firestore collection path for an account's jobs. Mirrors
// jobsCollectionPath() in the canonical module.
export function jobsCollectionPath(accountId: string): string {
  if (!accountId) throw new Error("accountId must be a non-empty string");
  return `accounts/${accountId}/jobs`;
}

// Status enum — values match JOB_STATUS in the canonical module.
export const JOB_STATUS = {
  SCHEDULED: "scheduled",
  EN_ROUTE: "en_route",
  IN_PROGRESS: "in_progress",
  COMPLETE: "complete",
  CANCELED: "canceled",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

// Human-readable labels for display.
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  en_route: "En route",
  in_progress: "In progress",
  complete: "Complete",
  canceled: "Canceled",
};

// Column order for the dispatch board (mirrors the workflow progression).
export const JOB_STATUS_ORDER: JobStatus[] = [
  JOB_STATUS.SCHEDULED,
  JOB_STATUS.EN_ROUTE,
  JOB_STATUS.IN_PROGRESS,
  JOB_STATUS.COMPLETE,
  JOB_STATUS.CANCELED,
];

// Source enum — values match JOB_SOURCE in the canonical module.
export const JOB_SOURCE = {
  MANUAL_ENTRY: "manual_entry",
  RECEPTIONIST: "receptionist",
} as const;

export type JobSource = (typeof JOB_SOURCE)[keyof typeof JOB_SOURCE];

export const JOB_SOURCE_LABELS: Record<string, string> = {
  manual_entry: "Manual entry",
  receptionist: "Receptionist",
};

// Shape of a job document as READ from Firestore. The .id is the
// auto-generated Firestore doc id (jobs have no natural dedupe key).
//
// NOTE: customerName / customerPhone are a DENORMALIZED display snapshot taken
// at booking time and MAY be stale. customerId is the source of truth for
// "who"; a detail view should read the live customer by customerId rather than
// trusting the snapshot. Do not re-join on every board render (see jobs.js).
export interface Job {
  id: string;
  accountId: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  service: string;
  status: JobStatus;
  source: JobSource;
  // scheduledAt / createdAt / updatedAt are Firestore Timestamps; typed loosely
  // for the UI (call .toDate() to render).
  scheduledAt: { toDate: () => Date } | null;
  durationMin: number | null; // minutes
  assignee: string | null;
  serviceAddress: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  } | null;
  notes: string | null;
  priceCents: number | null; // integer cents — format to dollars for display
  createdBy: string;
  createdAt: { toDate: () => Date } | null;
  updatedAt: { toDate: () => Date } | null;
}
