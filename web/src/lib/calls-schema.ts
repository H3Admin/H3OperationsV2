/**
 * calls-schema.ts — Front-end mirror of the READ-side of the canonical call
 * schema. Source of truth: functions/src/schema/calls.js (server, CommonJS).
 * This is a deliberate minimal copy: only what the dashboard needs to READ and
 * display. The write factory (buildNewCall) stays server-only and is NOT
 * duplicated here (§2.2).
 *
 * If a field, path, or enum changes in calls.js, mirror it here by hand.
 */

// Firestore collection path for an account's calls. Mirrors callsCollectionPath()
// in the canonical module. Collection name is case-sensitive: `calls` (§2.1).
export function callsCollectionPath(accountId: string): string {
  if (!accountId) throw new Error("accountId must be a non-empty string");
  return `accounts/${accountId}/calls`;
}

// Call lifecycle status — values match CALL_STATUS in the canonical module.
export const CALL_STATUS = {
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  NO_ANSWER: "no_answer",
  BUSY: "busy",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type CallStatus = (typeof CALL_STATUS)[keyof typeof CALL_STATUS];

// Human-readable status labels for display.
export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  in_progress: "In progress",
  completed: "Completed",
  no_answer: "No answer",
  busy: "Busy",
  failed: "Failed",
  cancelled: "Cancelled",
};

// Call direction — values match CALL_DIRECTION in the canonical module.
export const CALL_DIRECTION = {
  INBOUND: "inbound",
} as const;

export type CallDirection = (typeof CALL_DIRECTION)[keyof typeof CALL_DIRECTION];

export const CALL_DIRECTION_LABELS: Record<CallDirection, string> = {
  inbound: "Inbound",
};

// One conversation turn as READ from the call doc. This UI (and the summary-email
// reader) consume only callerText/aiText; `seq` exists server-side to keep
// arrayUnion elements distinct and is not needed for display.
export interface CallTurn {
  callerText: string;
  aiText: string;
  seq?: number;
}

// Shape of a call document as READ from Firestore. The .id is the Firestore doc
// id — the Twilio CallSid (== the `callSid` field).
export interface Call {
  id: string;
  callSid: string;
  accountId: string;
  from: string; // caller number, full E.164 with leading "+" (e.g. "+12145550123")
  to: string | null; // dialed H3 line
  direction: CallDirection;
  status: CallStatus;
  isNewLead: boolean;
  durationSeconds: number; // integer seconds
  turns: CallTurn[];
  // startedAt / endedAt are Firestore Timestamps; typed loosely for the UI
  // (mirrors the customers-schema.ts convention). startedAt is the sort key.
  startedAt: { toDate: () => Date } | null;
  endedAt: { toDate: () => Date } | null;
}
