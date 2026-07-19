/**
 * calls.js — Canonical call-record schema for H3 Operations.
 *
 * One call doc per inbound phone call handled by the Receptionist Agent. Holds
 * the caller, the accumulated conversation turns, the call lifecycle status, and
 * timing. Lives at:
 *
 *   Path (multi-tenant):  accounts/{accountId}/calls/{callSid}
 *
 * The document ID IS the Twilio CallSid (see DECISION below) — the caller sets
 * that ID; this factory does NOT set it and does NOT write. It is a pure body
 * builder, matching functions/src/schema/customers.js.
 *
 * Cross-file coupling a reader must know:
 *   - ESM WRITE MIRROR: services/conversation-relay/calls-schema.js is a
 *     hand-synced ESM port of this file's write side (§2.2). If this changes,
 *     update that copy BY HAND and note it.
 *   - READER: functions/src/index.ts handleCallStatus reads `from` (string) and
 *     `turns` ([{callerText, aiText}]) to build the summary email, and WRITES
 *     back `status`, `durationSeconds`, and `endedAt` at call completion. This
 *     schema's field names/shapes are pinned to that reader — changing `from`,
 *     `turns`, `status`, or `durationSeconds` here silently breaks the summary
 *     email on cutover.
 *   - Also consumed by the CRM call-history view and the dashboard.
 *
 * DECISION (2026-07): document ID = Twilio CallSid. Twilio retries status
 * callbacks up to 3x; keying the doc on the immutable CallSid makes a retried
 * write idempotent (it lands on the same doc) instead of creating duplicates.
 *
 * DECISION (2026-07): caller number field is `from`, holding the FULL raw E.164
 * (with leading "+", exactly as Twilio delivers it) — NOT `callerE164` and NOT
 * the digits-no-"+" form. This matches the live reader (handleCallStatus reads
 * `callData.from`) and the current writer (handleInboundCall / server.js both
 * store `from`). Renaming to `callerE164` + normalizing is deferred to the
 * reader-update step and MUST land in the same commit as that reader change.
 *
 * DECISION (2026-07): metadata is `startedAt` / `endedAt` (call-lifecycle
 * semantics), NOT the `createdAt` / `updatedAt` pair customers.js carries. A
 * call has a real start and end; `startedAt` is stamped here at creation and
 * `endedAt` is written by handleCallStatus on completion (null until then).
 *
 * Conventions (§2.1): camelCase fields, snake_case enum values, UTC Timestamps,
 * durations as integer seconds.
 *
 * NOTE: written as CommonJS to match functions/. If functions/ moves to ESM,
 * convert the require/exports (the ESM mirror already uses import/export).
 */

'use strict';

const { FieldValue } = require('firebase-admin/firestore');

// ---------------------------------------------------------------------------
// Enums (snake_case values)
// ---------------------------------------------------------------------------

// Call lifecycle. The exact strings the handleCallStatus reader maps Twilio's
// CallStatus onto (completed / no_answer / busy / failed / cancelled) plus the
// `in_progress` seed this factory stamps at creation. (The legacy writer seeded
// `initiated`; the pinned seed is `in_progress` — see the schema Brief.)
const CALL_STATUS = Object.freeze({
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  NO_ANSWER: 'no_answer',
  BUSY: 'busy',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

// Call direction. Only inbound exists today (the Receptionist Agent answers);
// outbound is added when an outbound feature ships.
const CALL_DIRECTION = Object.freeze({
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

function callsCollectionPath(accountId) {
  assertNonEmptyString(accountId, 'accountId');
  return `accounts/${accountId}/calls`;
}

/**
 * Doc path for a call. The callSid IS the document ID (see module DECISION).
 */
function callDocPath(accountId, callSid) {
  assertNonEmptyString(callSid, 'callSid');
  return `${callsCollectionPath(accountId)}/${callSid}`;
}

// ---------------------------------------------------------------------------
// Document factory (pure — builds the body, does not write, does not set the ID)
// ---------------------------------------------------------------------------

/**
 * Build a new call document body from validated inputs.
 *
 * Does NOT set the document ID — the caller writes it at
 * accounts/{accountId}/calls/{callSid} (doc ID = callSid).
 *
 * Units / formats:
 *   - `from`            full E.164 WITH leading "+" (raw Twilio value), e.g. "+12145550123".
 *   - `durationSeconds` integer SECONDS (not ms). Seeded 0; handleCallStatus writes the final value.
 *   - `startedAt`       server Timestamp stamped here at creation.
 *   - `endedAt`         null here; handleCallStatus writes the end Timestamp on completion.
 *
 * @param {object} input
 * @param {string}  input.callSid          Twilio CallSid; required (also the doc ID).
 * @param {string}  input.accountId        tenant id (stored redundantly for collection-group queries); required.
 * @param {string}  input.from             caller number, full E.164 with "+"; required.
 * @param {boolean} input.isNewLead        true if this call created a new lead vs. a callback from an existing customer; required. Set by the service at write time.
 * @param {string}  [input.to]             the dialed H3 line (raw); default null.
 * @param {string}  [input.direction]      CALL_DIRECTION value; default 'inbound'.
 * @param {string}  [input.status]         CALL_STATUS value; default 'in_progress'.
 * @param {number}  [input.durationSeconds] integer seconds; default 0.
 * @param {Array<{callerText: string, aiText: string}>} [input.turns] conversation turns; default []. The reader consumes only callerText/aiText; extra keys (e.g. confidence, timestamp) are permitted and ignored.
 * @returns {object} document body (throws on invalid required fields / enums)
 */
function buildNewCall(input = {}) {
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // enums
  CALL_STATUS,
  CALL_DIRECTION,
  VALID_STATUSES,
  VALID_DIRECTIONS,
  // paths
  callsCollectionPath,
  callDocPath,
  // factory
  buildNewCall,
};
module.exports.default = module.exports;
