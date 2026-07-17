/**
 * schema/signupRequests.js — server-side schema for marketing signup requests.
 *
 * Write factory is server-only (§2.2) — called from the submitSignupRequest
 * HTTPS function in index.ts, never from the client. The static marketing page
 * POSTs to that function; it never writes Firestore directly.
 *
 * DECISION (2026-07): stored at ROOT `signupRequests/{phoneDigits}`, not under
 * accounts/{accountId}/..., because a signup request is captured PRE-account
 * (public marketing site, no tenant exists yet). Same posture as `smsOptins` and
 * the top-level `invites` collection. The doc ID is the phone in the SAME shape
 * as the `customers` collection — customerIdFromPhone() output (E.164 digits, no
 * leading '+') — so a request and the future customer/optin keyed by the same
 * number line up, and a repeat submit is idempotent (one doc per number) rather
 * than an unbounded pile of leads.
 *
 * Phone normalization is NOT duplicated here: the function reuses
 * customersSchema.customerIdFromPhone / normalizePhoneE164 and passes a clean
 * E.164 string in as `phone`. Email IS validated/normalized here because this is
 * the module that owns the signupRequests shape.
 */

'use strict';

const { FieldValue } = require('firebase-admin/firestore');

// Root collection name (see DECISION above).
const SIGNUP_REQUESTS_COLLECTION = 'signupRequests';

// Lifecycle of a signup request. snake_case values per §2.1. Advanced by the
// sales/onboarding path (not this factory), which is why the refresh partial
// below deliberately never resets status.
const SIGNUP_REQUEST_STATUS = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  ONBOARDED: 'onboarded',
  DECLINED: 'declined',
});
const VALID_SIGNUP_REQUEST_STATUSES = Object.freeze(Object.values(SIGNUP_REQUEST_STATUS));

const MAX_BUSINESS_NAME_LEN = 120;
const MAX_CONTACT_NAME_LEN = 80;
const MAX_EMAIL_LEN = 254; // RFC 5321 max
const MAX_REF_LEN = 100;
const MAX_SOURCE_LEN = 60;

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

/**
 * Trim + length-cap a required free-text field. Throws if empty/oversized so a
 * bad payload becomes a 400 at the boundary (§8 S2) rather than a stored mess.
 */
function requireBounded(value, name, max) {
  assertNonEmptyString(value, name);
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new Error(`${name} exceeds ${max} chars`);
  }
  return trimmed;
}

/**
 * Normalize + validate an email to a stored value. Lowercased, trimmed, shape-
 * checked, length-capped. Throws on an unparseable address (§8 S2). The regex
 * intentionally rejects '/' and whitespace so the value is also safe if ever
 * used as a Firestore doc ID (as checklistRequests does).
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
 * Build a NEW signupRequest document (first submit). Caller derives the doc ID
 * from the phone via customersSchema.customerIdFromPhone and passes the
 * normalized E.164 string (with '+') as `phone`.
 *
 * @param {object} input
 * @param {string} input.businessName
 * @param {string} input.contactName
 * @param {string} input.phone         normalized E.164 (e.g. "+12145550123")
 * @param {string} input.email         validated + lowercased here
 * @param {string|null} [input.ref]    referral source, sanitized here
 * @param {string|null} [input.source] capture source tag, sanitized here
 * @returns {object} Firestore-ready document (throws on invalid required fields)
 */
function buildNewSignupRequest({ businessName, contactName, phone, email, ref, source } = {}) {
  assertNonEmptyString(phone, 'phone'); // caller passes normalized E.164
  return {
    businessName: requireBounded(businessName, 'businessName', MAX_BUSINESS_NAME_LEN),
    contactName: requireBounded(contactName, 'contactName', MAX_CONTACT_NAME_LEN),
    phone,
    email: normalizeEmail(email),
    ref: sanitizeTag(ref, MAX_REF_LEN),
    source: sanitizeTag(source, MAX_SOURCE_LEN),
    status: SIGNUP_REQUEST_STATUS.NEW,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Build a re-affirmation partial for an EXISTING request (idempotent re-submit of
 * the same phone number). Intended for set(..., { merge: true }).
 *
 * Deliberately OMITS createdAt AND status: the original createdAt is the audit
 * anchor, and status is owned by the sales/onboarding path — a resubmit must not
 * knock a 'contacted' lead back to 'new'. Refreshes the mutable contact fields
 * (the caller may have corrected a name/email) and moves updatedAt.
 *
 * @param {object} input
 * @param {string} input.businessName
 * @param {string} input.contactName
 * @param {string} input.email
 * @param {string|null} [input.ref]
 * @param {string|null} [input.source]
 * @returns {object} merge partial
 */
function buildSignupRequestRefresh({ businessName, contactName, email, ref, source } = {}) {
  return {
    businessName: requireBounded(businessName, 'businessName', MAX_BUSINESS_NAME_LEN),
    contactName: requireBounded(contactName, 'contactName', MAX_CONTACT_NAME_LEN),
    email: normalizeEmail(email),
    ref: sanitizeTag(ref, MAX_REF_LEN),
    source: sanitizeTag(source, MAX_SOURCE_LEN),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

module.exports = {
  SIGNUP_REQUESTS_COLLECTION,
  SIGNUP_REQUEST_STATUS,
  VALID_SIGNUP_REQUEST_STATUSES,
  buildNewSignupRequest,
  buildSignupRequestRefresh,
  normalizeEmail,
  sanitizeTag,
};
module.exports.default = module.exports;
