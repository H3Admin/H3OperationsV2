/**
 * calls-schema.js — SYNCED COPY of functions/src/schema/calls.js.
 *
 * ⚠️ §2.2 CAVEAT: the canonical call-record schema authority lives at
 * functions/src/schema/calls.js. That module is CommonJS and imports FieldValue
 * from firebase-admin/firestore; this Cloud Run service is ESM and talks to
 * Firestore via @google-cloud/firestore directly. Because a separate Cloud Run
 * deploy unit cannot import across the functions/ boundary, this file is a
 * hand-synced ESM port of the WRITE side (buildNewCall + the enums it needs).
 * The ONLY intended differences from the canonical file are: (a) ESM
 * import/export, (b) FieldValue sourced from @google-cloud/firestore (same
 * sentinel class Admin wraps). If the canonical module changes, update this copy
 * BY HAND and note it. This mirrors the existing customers-schema.js port in
 * this same service; the clean fix is a shared package (flagged at handoff).
 *
 * See the canonical file for the full DECISION records (callSid-as-doc-ID
 * dedupes Twilio status-callback retries; `from` holds raw E.164 with "+" to
 * match the handleCallStatus reader; startedAt/endedAt call-lifecycle semantics
 * instead of createdAt/updatedAt).
 */

import { FieldValue } from '@google-cloud/firestore';

// ---------------------------------------------------------------------------
// Enums (snake_case values)
// ---------------------------------------------------------------------------

export const CALL_STATUS = Object.freeze({
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  NO_ANSWER: 'no_answer',
  BUSY: 'busy',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export const CALL_DIRECTION = Object.freeze({
  INBOUND: 'inbound',
});

const VALID_STATUSES = Object.freeze(Object.values(CALL_STATUS));
const VALID_DIRECTIONS = Object.freeze(Object.values(CALL_DIRECTION));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

export function callsCollectionPath(accountId) {
  assertNonEmptyString(accountId, 'accountId');
  return `accounts/${accountId}/calls`;
}

/**
 * Doc path for a call. The callSid IS the document ID (see canonical DECISION).
 */
export function callDocPath(accountId, callSid) {
  assertNonEmptyString(callSid, 'callSid');
  return `${callsCollectionPath(accountId)}/${callSid}`;
}

// ---------------------------------------------------------------------------
// Document factory (pure — builds the body, does not write, does not set the ID)
// ---------------------------------------------------------------------------

/**
 * Build a new call document body from validated inputs.
 * Mirror of functions/src/schema/calls.js buildNewCall.
 *
 * Units / formats:
 *   - `from`            full E.164 WITH leading "+" (raw Twilio value).
 *   - `durationSeconds` integer SECONDS; seeded 0.
 *   - `startedAt`       server Timestamp stamped here at creation.
 *   - `endedAt`         null here; handleCallStatus writes it on completion.
 */
export function buildNewCall(input = {}) {
  const {
    callSid,
    accountId,
    from,
    isNewLead,
    to = null,
    direction = CALL_DIRECTION.INBOUND,
    status = CALL_STATUS.IN_PROGRESS,
    durationSeconds = 0,
    turns = [],
  } = input;

  assertNonEmptyString(callSid, 'callSid');
  assertNonEmptyString(accountId, 'accountId');
  assertNonEmptyString(from, 'from');

  if (typeof isNewLead !== 'boolean') {
    throw new Error('buildNewCall: isNewLead must be a boolean');
  }
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`buildNewCall: invalid status "${status}"`);
  }
  if (!VALID_DIRECTIONS.includes(direction)) {
    throw new Error(`buildNewCall: invalid direction "${direction}"`);
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0) {
    throw new Error(
      `buildNewCall: durationSeconds must be a non-negative integer, got "${durationSeconds}"`,
    );
  }
  if (!Array.isArray(turns)) {
    throw new Error('buildNewCall: turns must be an array');
  }

  return {
    callSid,
    accountId,
    from,
    to,
    direction,
    status,
    isNewLead,
    durationSeconds,
    turns,
    startedAt: FieldValue.serverTimestamp(),
    endedAt: null,
  };
}
