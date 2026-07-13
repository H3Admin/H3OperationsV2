/**
 * schema/smsOptins.js — server-side schema for SMS consent records.
 *
 * Write factory is server-only (§2.2) — called from the submitSmsOptin HTTPS
 * function in index.ts, never from the client. The client form (static page on
 * the marketing site) POSTs to that function; it never writes Firestore directly.
 *
 * DECISION (2026-07): stored at ROOT `smsOptins/{phoneDigits}`, not under
 * accounts/{accountId}/..., because consent is captured pre-account (public
 * marketing site, no tenant exists yet). Root-level has precedent here: `invites`
 * is also a top-level collection. The doc ID is the phone in the SAME shape as
 * the `customers` collection — customerIdFromPhone() output (E.164 digits, no
 * leading '+') — so a consent record and a future customer keyed by the same
 * number line up. Phone normalization is NOT duplicated here: the function reuses
 * customersSchema.customerIdFromPhone / normalizePhoneE164 and passes a clean
 * E.164 string in.
 *
 * Caveat (multi-tenant): a root collection cannot express WHICH tenant a consent
 * belongs to. For H3's own toll-free verification that's correct (the consents
 * are H3 LLC's). Revisit if the product ever runs per-tenant SMS programs.
 */

'use strict';

const { FieldValue } = require('firebase-admin/firestore');

// Root collection name (see DECISION above).
const SMS_OPTINS_COLLECTION = 'smsOptins';

// Lifecycle of a consent record. snake_case values per §2.1. Flip to opted_out
// on a STOP keyword (handled by the future inbound-SMS path, not this factory).
const SMS_OPTIN_STATUS = Object.freeze({
  ACTIVE: 'active',
  OPTED_OUT: 'opted_out',
});
const VALID_SMS_OPTIN_STATUSES = Object.freeze(Object.values(SMS_OPTIN_STATUS));

const MAX_CONSENT_VERSION_LEN = 40;
const MAX_REF_LEN = 100;

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertConsentCopyVersion(v) {
  assertNonEmptyString(v, 'consentCopyVersion');
  if (v.length > MAX_CONSENT_VERSION_LEN) {
    throw new Error(`consentCopyVersion exceeds ${MAX_CONSENT_VERSION_LEN} chars`);
  }
}

/**
 * Coerce an untrusted referral tag to a stored value or null. Trim, cap length.
 * @param {*} ref
 * @returns {string|null}
 */
function sanitizeRef(ref) {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_REF_LEN);
}

/**
 * Build a NEW smsOptin document (first consent). Caller derives the doc ID from
 * the phone via customersSchema.customerIdFromPhone and passes the normalized
 * E.164 string (with '+') as `phone`.
 *
 * consentCopyVersion is stored on every record so an old consent stays auditable
 * against the exact wording shown at submit time (§9.2), even after the copy
 * changes.
 *
 * @param {object} input
 * @param {string} input.phone              normalized E.164 (e.g. "+12145550123")
 * @param {string} input.consentCopyVersion version tag of the consent language
 * @param {string|null} [input.ref]         referral source, sanitized here
 * @returns {object} Firestore-ready document (throws on invalid required fields)
 */
function buildNewSmsOptin({ phone, consentCopyVersion, ref } = {}) {
  assertNonEmptyString(phone, 'phone');
  assertConsentCopyVersion(consentCopyVersion);
  return {
    phone,
    consentGiven: true,
    consentCopyVersion,
    ref: sanitizeRef(ref),
    status: SMS_OPTIN_STATUS.ACTIVE,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Build a re-affirmation partial for an EXISTING consent record (idempotent
 * re-submit of the same number). Intended for set(..., { merge: true }).
 *
 * Deliberately OMITS createdAt: the original consent timestamp is the audit
 * anchor and must be preserved across re-submits. Only updatedAt moves.
 *
 * @param {object} input
 * @param {string} input.consentCopyVersion
 * @param {string|null} [input.ref]
 * @returns {object} merge partial
 */
function buildSmsOptinRefresh({ consentCopyVersion, ref } = {}) {
  assertConsentCopyVersion(consentCopyVersion);
  return {
    consentGiven: true,
    consentCopyVersion,
    ref: sanitizeRef(ref),
    status: SMS_OPTIN_STATUS.ACTIVE,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

module.exports = {
  SMS_OPTINS_COLLECTION,
  SMS_OPTIN_STATUS,
  VALID_SMS_OPTIN_STATUSES,
  buildNewSmsOptin,
  buildSmsOptinRefresh,
  sanitizeRef,
};
module.exports.default = module.exports;
