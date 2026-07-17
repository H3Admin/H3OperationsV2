/**
 * schema/checklistRequests.js — server-side schema for "email me the checklist"
 * lead-magnet requests.
 *
 * Write factory is server-only (§2.2) — called from the submitChecklistRequest
 * HTTPS function in index.ts, never from the client. The static marketing page
 * POSTs to that function; it never writes Firestore directly.
 *
 * DECISION (2026-07): stored at ROOT `checklistRequests/{normalizedEmail}`, not
 * under accounts/{accountId}/..., because this is captured PRE-account (public
 * marketing site, no tenant exists yet) — same posture as `smsOptins` /
 * `signupRequests` / `invites`. The doc ID is the normalized email, so a repeat
 * submit of the same address is idempotent (one doc per email) rather than an
 * unbounded pile of requests.
 *
 * normalizeEmail() also guards doc-ID safety: it rejects '/' and whitespace and
 * caps length, so the returned value is always a legal Firestore document ID.
 * Callers MUST use the normalizeEmail() output both as the doc ID and as the
 * stored `email` field so the two never diverge.
 */

'use strict';

const { FieldValue } = require('firebase-admin/firestore');

// Root collection name (see DECISION above).
const CHECKLIST_REQUESTS_COLLECTION = 'checklistRequests';

// Lifecycle of a checklist request. snake_case values per §2.1. Advanced to
// 'sent' by the fulfilment path (not this factory), which is why the refresh
// partial below never resets status.
const CHECKLIST_REQUEST_STATUS = Object.freeze({
  NEW: 'new',
  SENT: 'sent',
});
const VALID_CHECKLIST_REQUEST_STATUSES = Object.freeze(Object.values(CHECKLIST_REQUEST_STATUS));

const MAX_EMAIL_LEN = 254; // RFC 5321 max
const MAX_REF_LEN = 100;
const MAX_SOURCE_LEN = 60;

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

/**
 * Normalize + validate an email to BOTH the doc ID and the stored `email` field.
 * Lowercased, trimmed, shape-checked, length-capped. Throws on an unparseable
 * address (§8 S2). The regex rejects '/' and whitespace so the value is always a
 * legal Firestore doc ID.
 * @returns {string} normalized email
 */
function normalizeEmail(raw) {
  assertNonEmptyString(raw, 'email');
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LEN) {
    throw new Error(`email exceeds ${MAX_EMAIL_LEN} chars`);
  }
  if (!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email)) {
    throw new Error('email is not a valid address');
  }
  return email;
}

/**
 * Coerce an untrusted short tag (ref, source) to a stored value or null. Trim,
 * cap length. Never throws — these are optional provenance, not identity.
 * @returns {string|null}
 */
function sanitizeTag(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Build a NEW checklistRequest document (first submit). Caller derives the doc ID
 * from normalizeEmail() and passes that same normalized value as `email`.
 *
 * @param {object} input
 * @param {string} input.email         normalized (normalizeEmail output)
 * @param {string|null} [input.ref]    referral source, sanitized here
 * @param {string|null} [input.source] capture source tag, sanitized here
 * @returns {object} Firestore-ready document (throws on invalid required fields)
 */
function buildNewChecklistRequest({ email, ref, source } = {}) {
  return {
    email: normalizeEmail(email),
    ref: sanitizeTag(ref, MAX_REF_LEN),
    source: sanitizeTag(source, MAX_SOURCE_LEN),
    status: CHECKLIST_REQUEST_STATUS.NEW,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Build a re-affirmation partial for an EXISTING request (idempotent re-submit of
 * the same email). Intended for set(..., { merge: true }).
 *
 * Deliberately OMITS createdAt AND status: the original createdAt is the audit
 * anchor, and status is owned by the fulfilment path — a resubmit must not knock
 * an already-'sent' request back to 'new'. Refreshes provenance and moves
 * updatedAt. Email is omitted too: it IS the doc ID, so it cannot change on a
 * merge into the same document.
 *
 * @param {object} input
 * @param {string|null} [input.ref]
 * @param {string|null} [input.source]
 * @returns {object} merge partial
 */
function buildChecklistRequestRefresh({ ref, source } = {}) {
  return {
    ref: sanitizeTag(ref, MAX_REF_LEN),
    source: sanitizeTag(source, MAX_SOURCE_LEN),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

module.exports = {
  CHECKLIST_REQUESTS_COLLECTION,
  CHECKLIST_REQUEST_STATUS,
  VALID_CHECKLIST_REQUEST_STATUSES,
  buildNewChecklistRequest,
  buildChecklistRequestRefresh,
  normalizeEmail,
  sanitizeTag,
};
module.exports.default = module.exports;
