/**
 * customers.js — Canonical customer/lead schema for H3 Operations.
 *
 * One collection holds both leads and customers, distinguished by `status`.
 * Dedupe key: normalized phone (E.164). The document ID is the E.164 digits
 * WITHOUT the leading "+" (e.g. "12145551234") — a valid Firestore ID and a
 * clean URL path segment. The full E.164 lives in the `phone` field.
 *
 * Path (multi-tenant):  accounts/{accountId}/customers/{customerId}
 * Interactions:         accounts/{accountId}/customers/{customerId}/interactions/{id}
 *   (subcollection, never an embedded array — avoids the 1MB document cap)
 *
 * Conventions (project brief): camelCase fields, snake_case enum values,
 * UTC Timestamps, integer cents for money (none in this doc yet).
 *
 * NOTE: written as CommonJS. If functions/ is ESM, convert the require/exports.
 */

'use strict';

const { FieldValue } = require('firebase-admin/firestore');

// ---------------------------------------------------------------------------
// Enums (snake_case values)
// ---------------------------------------------------------------------------

const CUSTOMER_STATUS = Object.freeze({
  LEAD: 'lead',         // captured, not yet a paying relationship
  ACTIVE: 'active',     // current paying / engaged customer
  INACTIVE: 'inactive', // real relationship, currently dormant
  ARCHIVED: 'archived', // soft-deleted; hidden from active views
});

const CUSTOMER_SOURCE = Object.freeze({
  PHONE_CALL: 'phone_call',     // Receptionist Agent (handleCallStatus)
  WEB_FORM: 'web_form',         // future web intake
  REFERRAL: 'referral',
  MANUAL_ENTRY: 'manual_entry', // typed into the CRM by a human
});

// Fixed identifiers for non-human writers, used in `createdBy`.
const SYSTEM_ACTOR = Object.freeze({
  RECEPTIONIST: 'system:receptionist',
});

const INTERACTION_TYPE = Object.freeze({
  CALL: 'call',
  NOTE: 'note',
  SMS: 'sms',
  EMAIL: 'email',
});

const VALID_STATUSES = Object.freeze(Object.values(CUSTOMER_STATUS));
const VALID_SOURCES = Object.freeze(Object.values(CUSTOMER_SOURCE));
const VALID_INTERACTION_TYPES = Object.freeze(Object.values(INTERACTION_TYPE));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

/**
 * Coerce an address input into the canonical nested shape, or null.
 * Missing sub-fields become null so the stored shape is stable.
 */
function normalizeAddress(address) {
  if (!address || typeof address !== 'object') return null;
  const {
    line1 = null,
    line2 = null,
    city = null,
    state = null,
    postalCode = null,
  } = address;
  // Treat an address with no meaningful location fields as empty.
  if (!line1 && !city && !state && !postalCode) return null;
  return { line1, line2, city, state, postalCode };
}

// ---------------------------------------------------------------------------
// Phone normalization (NANP / US-first, dependency-free)
// ---------------------------------------------------------------------------

/**
 * Normalize a raw phone string to E.164 for the North American Numbering Plan.
 *
 * Returns the E.164 string (e.g. "+12145551234") or null if the input cannot
 * be confidently normalized. Callers MUST treat null as "reject" — never store
 * a raw value — because this function is on the dedupe/identity path.
 *
 * Scope: US/Canada (+1). If international is ever needed, swap the body for
 * libphonenumber-js rather than hand-extending this.
 */
function normalizePhoneE164(raw) {
  if (typeof raw !== 'string') return null;

  const hasPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');

  // Reduce to the 10 national (NANP) digits.
  if (hasPlus) {
    if (!(digits.length === 11 && digits.startsWith('1'))) return null; // +1 only
    digits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  } else if (digits.length !== 10) {
    return null;
  }

  // NANP validity: area code and exchange both start with [2-9].
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;

  return '+1' + digits;
}

/**
 * Derive the Firestore document ID from a raw phone number: the E.164 digits
 * with no leading "+". Returns null if the phone cannot be normalized.
 */
function customerIdFromPhone(raw) {
  const e164 = normalizePhoneE164(raw);
  return e164 ? e164.slice(1) : null; // drop the "+"
}

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

function customersCollectionPath(accountId) {
  assertNonEmptyString(accountId, 'accountId');
  return `accounts/${accountId}/customers`;
}

function customerDocPath(accountId, customerId) {
  assertNonEmptyString(customerId, 'customerId');
  return `${customersCollectionPath(accountId)}/${customerId}`;
}

function interactionsCollectionPath(accountId, customerId) {
  return `${customerDocPath(accountId, customerId)}/interactions`;
}

function interactionDocPath(accountId, customerId, interactionId) {
  assertNonEmptyString(interactionId, 'interactionId');
  return `${interactionsCollectionPath(accountId, customerId)}/${interactionId}`;
}

// ---------------------------------------------------------------------------
// Document factories (pure — they build bodies, they do not write)
// ---------------------------------------------------------------------------

/**
 * Build a new customer document body from validated inputs.
 * Does NOT set the doc ID — caller derives it via customerIdFromPhone().
 *
 * @param {object} input
 * @param {string} input.accountId    tenant id (stored redundantly for CG queries)
 * @param {string} input.phone        raw phone; normalized here; required
 * @param {string} input.createdBy    uid or a SYSTEM_ACTOR value; required
 * @param {string} [input.source]     CUSTOMER_SOURCE value (default manual_entry)
 * @param {string} [input.status]     CUSTOMER_STATUS value (default lead)
 * @param {string} [input.displayName]
 * @param {string} [input.email]
 * @param {object} [input.address]    { line1, line2, city, state, postalCode }
 * @param {string} [input.notes]
 * @returns {object} document body (throws on invalid required fields)
 */
function buildNewCustomer(input = {}) {
  const {
    accountId,
    phone,
    createdBy,
    source = CUSTOMER_SOURCE.MANUAL_ENTRY,
    status = CUSTOMER_STATUS.LEAD,
    displayName = null,
    email = null,
    address = null,
    notes = null,
  } = input;

  assertNonEmptyString(accountId, 'accountId');
  assertNonEmptyString(createdBy, 'createdBy');

  const phoneE164 = normalizePhoneE164(phone);
  if (!phoneE164) {
    throw new Error(`buildNewCustomer: could not normalize phone "${phone}"`);
  }
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`buildNewCustomer: invalid status "${status}"`);
  }
  if (!VALID_SOURCES.includes(source)) {
    throw new Error(`buildNewCustomer: invalid source "${source}"`);
  }

  return {
    accountId,
    phone: phoneE164,
    displayName,
    email,
    address: normalizeAddress(address),
    status,
    source,
    notes,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Build a partial update body. Only whitelisted mutable fields pass through;
 * accountId, phone (identity), createdAt, and createdBy are never touched here.
 * Always stamps updatedAt. Intended for use with { merge: true }.
 */
function buildCustomerUpdate(patch = {}) {
  const out = { updatedAt: FieldValue.serverTimestamp() };

  if ('displayName' in patch) out.displayName = patch.displayName;
  if ('email' in patch) out.email = patch.email;
  if ('address' in patch) out.address = normalizeAddress(patch.address);
  if ('notes' in patch) out.notes = patch.notes;

  if ('status' in patch) {
    if (!VALID_STATUSES.includes(patch.status)) {
      throw new Error(`buildCustomerUpdate: invalid status "${patch.status}"`);
    }
    out.status = patch.status;
  }
  if ('source' in patch) {
    if (!VALID_SOURCES.includes(patch.source)) {
      throw new Error(`buildCustomerUpdate: invalid source "${patch.source}"`);
    }
    out.source = patch.source;
  }
  return out;
}

/**
 * Build an interaction subcollection document body.
 * @param {object} input
 * @param {string} input.type       INTERACTION_TYPE value; required
 * @param {string} input.createdBy  uid or SYSTEM_ACTOR; required
 * @param {string} [input.summary]  short human-readable line
 * @param {object} [input.data]     type-specific payload (e.g. { callSid, durationSec })
 */
function buildInteraction(input = {}) {
  const { type, createdBy, summary = null, data = null } = input;

  assertNonEmptyString(createdBy, 'createdBy');
  if (!VALID_INTERACTION_TYPES.includes(type)) {
    throw new Error(`buildInteraction: invalid type "${type}"`);
  }

  return {
    type,
    summary,
    data: data && typeof data === 'object' ? data : null,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // enums
  CUSTOMER_STATUS,
  CUSTOMER_SOURCE,
  SYSTEM_ACTOR,
  INTERACTION_TYPE,
  VALID_STATUSES,
  VALID_SOURCES,
  VALID_INTERACTION_TYPES,
  // phone
  normalizePhoneE164,
  customerIdFromPhone,
  // paths
  customersCollectionPath,
  customerDocPath,
  interactionsCollectionPath,
  interactionDocPath,
  // factories
  buildNewCustomer,
  buildCustomerUpdate,
  buildInteraction,
  // helpers (exported for unit tests)
  normalizeAddress,
};
module.exports.default = module.exports;
