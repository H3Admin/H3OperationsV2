/**
 * call-export-rows.ts — shared row-building for Calls/Leads export, one row
 * shape feeding both csv-export.ts and xlsx-export.ts so the two formats
 * never drift apart. Callers pass an already date-range-filtered Call[]
 * (see filterByDateRange in calls-format.ts); this module does not filter,
 * fetch, or re-derive the dataset.
 */

import { CALL_STATUS_LABELS, type Call } from "@/lib/calls-schema";
import { formatCaller, formatDuration, formatStartedAt } from "@/lib/calls-format";

export const CALL_EXPORT_COLUMNS = ["Caller", "Started", "Duration", "Status", "New lead"] as const;

export function buildCallExportRows(calls: Call[]): string[][] {
  return calls.map((c) => [
    formatCaller(c.from),
    formatStartedAt(c.startedAt),
    formatDuration(c.durationSeconds),
    CALL_STATUS_LABELS[c.status] ?? c.status,
    c.isNewLead ? "Yes" : "No",
  ]);
}
