/**
 * calls-format.ts — display formatting shared by the Calls list, Leads list,
 * and call detail views. Pure functions only, no Firestore/React dependency.
 *
 * Extracted from dashboard.tsx slice 1 so the three views (Calls, Leads,
 * detail) render calls identically instead of drifting.
 */

import { CALL_STATUS, type CallStatus } from "@/lib/calls-schema";

export interface DateRange {
  /** yyyy-mm-dd from <input type="date">; "" = unbounded. */
  start: string;
  end: string;
}

// Format a full E.164 caller number for display; falls back to the raw value
// for anything that isn't a NANP +1 number.
export function formatCaller(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 || "—";
}

// Firestore Timestamp → local date + time string.
export function formatStartedAt(ts: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

// Integer seconds → compact "m s" (or "s" under a minute).
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Map call status → Badge variant. Terminal-negative outcomes read as
// destructive; everything else stays neutral (secondary).
export function statusVariant(status: CallStatus): "secondary" | "destructive" {
  const negative: CallStatus[] = [
    CALL_STATUS.NO_ANSWER,
    CALL_STATUS.BUSY,
    CALL_STATUS.FAILED,
    CALL_STATUS.CANCELLED,
  ];
  return negative.includes(status) ? "destructive" : "secondary";
}

// Filter any startedAt-bearing list to an inclusive local-day date range. Both
// ends optional — an empty range returns the input unfiltered. Items with no
// startedAt (still in progress) are excluded once a range is set, since they
// have no date to test against.
export function filterByDateRange<T extends { startedAt: { toDate: () => Date } | null }>(
  items: T[],
  range: DateRange,
): T[] {
  if (!range.start && !range.end) return items;
  const startMs = range.start ? new Date(`${range.start}T00:00:00`).getTime() : -Infinity;
  const endMs = range.end ? new Date(`${range.end}T23:59:59.999`).getTime() : Infinity;
  return items.filter((item) => {
    const d = item.startedAt?.toDate();
    if (!d) return false;
    const t = d.getTime();
    return t >= startMs && t <= endMs;
  });
}
