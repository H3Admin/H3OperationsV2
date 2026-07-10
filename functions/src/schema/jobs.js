/**
 * jobs.js — Canonical job/dispatch schema for H3 Operations.
 *
 * A job is a scheduled unit of work on the dispatch board. Jobs live per-tenant
 * and are keyed by an auto-generated Firestore ID (unlike customers, a job has
 * no natural dedupe key — one customer can have many jobs).
 *
 * Path (multi-tenant): accounts/{accountId}/jobs/{jobId}
 *
 * Customer linkage (DECISION: hybrid, see below):
 *   - customerId  — nullable link to accounts/{accountId}/customers/{customerId}.
 *                   Source of truth for "who". A job may exist with no linked
 *                   customer (dispatcher just typed a name), so this is nullable.
 *   - customerName / customerPhone — a DENORMALIZED display snapshot so the
 *                   14-day board renders O(1) with no per-card customer fetch
 *                   (Firestore has no joins). Consistent with customers.js
 *                   already storing accountId redundantly "for CG queries".
 *   serviceAddress is JOB-owned data (where the crew is dispatched), which can
 *   differ from the customer's address — so it is NOT part of the snapshot.
 *
 * DECISION (2026-07): The customerName/customerPhone snapshot is display-only and
 * MAY go stale if the customer is later renamed. customerId is the source of
 * truth; detail views read the live customer. For a dispatch board, name-at-
 * booking is usually what you want anyway. Do not "fix" the snapshot by joining
 * on every render — that reintroduces the N-reads problem this avoids.
 *
 * Conventions (project brief): camelCase fields, snake_case enum values,
 * UTC Firestore Timestamps, integer cents for money (priceCents).
 *
 * Coupling note: reuses normalizeAddress + normalizePhoneE164 from ./customers
 * so address shape and phone rules are defined in ONE place, never re-derived.
 * (If these ever need to diverge, extract a shared schema/address.js + phone.js
 * rather than forking a second copy here.)
 *
 * Written as CommonJS, matching customers.js (the zero-dep `node --test` suite
 * and the .d.ts interop pattern depend on this).
 */

'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { normalizeAddress, normalizePhoneE164 } = require('./customers');

// ---------------------------------------------------------------------------
// Enums (snake_case values)
// ---------------------------------------------------------------------------

// NOTE: the old Supabase page used "en route" / "in progress" (spaces). Those
// violate the snake_case enum rule and are corrected here at the boundary.
const JOB_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  EN_ROUTE: 'en_route',
  IN_PROGRESS: 'in_progress',
  COMPLETE: 'complete',
  CANCELED: 'canceled',
});

// Reuse the customer source vocabulary would be wrong here; a job's origin is
// its own concern. Kept minimal until the UI needs more.
const JOB_SOURCE = Object.freeze({
  MANUAL_ENTRY: 'manual_entry', // typed into the dispatch board by a human
  RECEPTIONIST: 'receptionist', // created off a captured call (future handoff)
});

const VALID_JOB_STATUSES = Object.freeze(Object.values(JOB_STATUS));
const VALID_JOB_SOURCES = Object.freeze(Object.values(JOB_SOURCE));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

/**
 * Coerce a scheduled time input into a Firestore Timestamp.
 * Accepts a JS Date, epoch milliseconds, or an ISO-8601 string.
 * Throws if it cannot be parsed — scheduledAt is required and must be real.
 */
function toTimestamp(value, name) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Timestamp.fromDate(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Timestamp.fromMillis(value);
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  throw new Error(`${name} must be a Date, epoch millis, or ISO-8601 string`);
}

/**
 * Optional phone for the display snapshot. If provided it MUST normalize to
 * E.164 (same discipline as customers — no raw values stored); absent -> null.
 * This is display-only; the customerId link is the identity path, not this.
 */
function normalizeSnapshotPhone(raw) {
  if (raw == null || raw === '') return null;
  const e164 = normalizePhoneE164(raw);
  if (!e164) {
    throw new Error(`could not normalize customerPhone "${raw}"`);
  }
  return e164;
}

function normalizePriceCents(value, name) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (cents)`);
  }
  return value;
}

function normalizeDurationMin(value, name) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (minutes)`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

function jobsCollectionPath(accountId) {
  assertNonEmptyString(accountId, 'accountId');
  return `accounts/${accountId}/jobs`;
}

function jobDocPath(accountId, jobId) {
  assertNonEmptyString(jobId, 'jobId');
  return `${jobsCollectionPath(accountId)}/${jobId}`;
}

// ---------------------------------------------------------------------------
// Document factories (pure — they build bodies, they do not write)
// ---------------------------------------------------------------------------

/**
 * Build a new job document body from validated inputs.
 * Does NOT set the doc ID — caller uses an auto-generated Firestore ID
 * (collection.add(...) or doc() then set()).
 *
 * @param {object} input
 * @param {string}  input.accountId     tenant id (stored redundantly for CG queries); required
 * @param {string}  input.createdBy     uid or a system actor value; required
 * @param {string}  input.customerName  display name for the board; required
 * @param {(Date|number|string)} input.scheduledAt  when the job is scheduled; required
 * @param {string}  input.service       what work is being done; required
 * @param {string}  [input.customerId]  link to a customers/{id} doc, or null
 * @param {string}  [input.customerPhone] display snapshot; normalized to E.164 or null
 * @param {string}  [input.customerEmail] display snapshot; free-form or null
 * @param {string}  [input.status]      JOB_STATUS value (default scheduled)
 * @param {string}  [input.source]      JOB_SOURCE value (default manual_entry)
 * @param {number}  [input.durationMin] positive integer minutes, or null
 * @param {string}  [input.assignee]    who's assigned, or null
 * @param {object}  [input.serviceAddress] { line1, line2, city, state, postalCode }
 * @param {string}  [input.notes]
 * @param {number}  [input.priceCents]  non-negative integer cents, or null
 * @returns {object} document body (throws on invalid required fields)
 */
function buildNewJob(input = {}) {
  const {
    accountId,
    createdBy,
    customerName,
    scheduledAt,
    service,
    customerId = null,
    customerPhone = null,
    customerEmail = null,
    status = JOB_STATUS.SCHEDULED,
    source = JOB_SOURCE.MANUAL_ENTRY,
    durationMin = null,
    assignee = null,
    serviceAddress = null,
    notes = null,
    priceCents = null,
  } = input;

  assertNonEmptyString(accountId, 'accountId');
  assertNonEmptyString(createdBy, 'createdBy');
  assertNonEmptyString(customerName, 'customerName');
  assertNonEmptyString(service, 'service');

  if (!VALID_JOB_STATUSES.includes(status)) {
    throw new Error(`buildNewJob: invalid status "${status}"`);
  }
  if (!VALID_JOB_SOURCES.includes(source)) {
    throw new Error(`buildNewJob: invalid source "${source}"`);
  }

  return {
    accountId,
    customerId: typeof customerId === 'string' && customerId ? customerId : null,
    customerName,
    customerPhone: normalizeSnapshotPhone(customerPhone),
    customerEmail: customerEmail || null,
    service,
    status,
    source,
    scheduledAt: toTimestamp(scheduledAt, 'scheduledAt'),
    durationMin: normalizeDurationMin(durationMin, 'durationMin'),
    assignee: assignee || null,
    serviceAddress: normalizeAddress(serviceAddress),
    notes: notes || null,
    priceCents: normalizePriceCents(priceCents, 'priceCents'),
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Build a partial update body. Only whitelisted mutable fields pass through;
 * accountId, createdAt, and createdBy are never touched here. Always stamps
 * updatedAt. Intended for use with { merge: true }.
 */
function buildJobUpdate(patch = {}) {
  const out = { updatedAt: FieldValue.serverTimestamp() };

  if ('customerName' in patch) {
    assertNonEmptyString(patch.customerName, 'customerName');
    out.customerName = patch.customerName;
  }
  if ('service' in patch) {
    assertNonEmptyString(patch.service, 'service');
    out.service = patch.service;
  }
  if ('customerId' in patch) {
    out.customerId =
      typeof patch.customerId === 'string' && patch.customerId ? patch.customerId : null;
  }
  if ('customerPhone' in patch) out.customerPhone = normalizeSnapshotPhone(patch.customerPhone);
  if ('customerEmail' in patch) out.customerEmail = patch.customerEmail || null;
  if ('assignee' in patch) out.assignee = patch.assignee || null;
  if ('serviceAddress' in patch) out.serviceAddress = normalizeAddress(patch.serviceAddress);
  if ('notes' in patch) out.notes = patch.notes || null;
  if ('durationMin' in patch) out.durationMin = normalizeDurationMin(patch.durationMin, 'durationMin');
  if ('priceCents' in patch) out.priceCents = normalizePriceCents(patch.priceCents, 'priceCents');
  if ('scheduledAt' in patch) out.scheduledAt = toTimestamp(patch.scheduledAt, 'scheduledAt');

  if ('status' in patch) {
    if (!VALID_JOB_STATUSES.includes(patch.status)) {
      throw new Error(`buildJobUpdate: invalid status "${patch.status}"`);
    }
    out.status = patch.status;
  }
  if ('source' in patch) {
    if (!VALID_JOB_SOURCES.includes(patch.source)) {
      throw new Error(`buildJobUpdate: invalid source "${patch.source}"`);
    }
    out.source = patch.source;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // enums
  JOB_STATUS,
  JOB_SOURCE,
  VALID_JOB_STATUSES,
  VALID_JOB_SOURCES,
  // paths
  jobsCollectionPath,
  jobDocPath,
  // factories
  buildNewJob,
  buildJobUpdate,
  // helpers (exported for unit tests)
  toTimestamp,
  normalizeSnapshotPhone,
  normalizePriceCents,
  normalizeDurationMin,
};
module.exports.default = module.exports;
