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

// Provenance of `displayName`: was it guessed by the receptionist AI from a call
// transcript, or entered/confirmed by a human? We record this because an
// AI-extracted name is lower-trust than a human-confirmed one, and we want to
// know which before ever surfacing these names customer-facing. null = no name,
// so no provenance.
const DISPLAY_NAME_SOURCE = Object.freeze({
  AI_EXTRACTED: 'ai_extracted',
  MANUAL_ENTRY: 'manual_entry',
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
const VALID_DISPLAY_NAME_SOURCES = Object.freeze(Object.values(DISPLAY_NAME_SOURCE));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

// Longest string we will accept as a person's display name. Anything longer is
// almost certainly a sentence the model returned, not a name.
const MAX_DISPLAY_NAME_LEN = 80;

/**
 * Sanitize an UNTRUSTED display-name string before it is stored — specifically
 * the receptionist AI's extracted caller name. Per §8 S2 (server boundary: no
 * LLM output in the data-integrity path), model output must never reach
 * Firestore unvalidated. This is the one authority for that cleaning; callers
 * pass raw model text through here rather than inlining their own rules.
 *
 * Returns a clean name, or null if the input is not a usable name:
 *   - non-string                         -> null
 *   - collapse internal whitespace, trim, strip wrapping quotes the model adds
 *   - empty after trimming               -> null
 *   - contains no letter (digits/punct)  -> null  (rejects junk like "N/A", "---")
 *   - longer than MAX_DISPLAY_NAME_LEN   -> null  (a sentence, not a name)
 *
 * @param {*} raw
 * @returns {string|null}
 */
function sanitizeDisplayName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
  if (!name) return null;
  if (!/\p{L}/u.test(name)) return null;
  if (name.length > MAX_DISPLAY_NAME_LEN) return null;
  return name;
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
    displayNameSource = undefined,
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

  // Provenance of the name. An explicit source (e.g. the receptionist handoff
  // passing 'ai_extracted') wins; otherwise a name arriving through this factory
  // came from a human path (the CRM create form), so default to 'manual_entry'.
  // A null/absent name never carries a source.
  let resolvedNameSource =
    displayNameSource === undefined
      ? (displayName ? DISPLAY_NAME_SOURCE.MANUAL_ENTRY : null)
      : displayNameSource;
  if (
    resolvedNameSource !== null &&
    !VALID_DISPLAY_NAME_SOURCES.includes(resolvedNameSource)
  ) {
    throw new Error(
      `buildNewCustomer: invalid displayNameSource "${resolvedNameSource}"`,
    );
  }
  if (!displayName) resolvedNameSource = null;

  return {
    accountId,
    phone: phoneE164,
    displayName,
    displayNameSource: resolvedNameSource,
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

  if ('displayName' in patch) {
    out.displayName = patch.displayName;
    // A human editing the name through the CRM (re)confirms it -> manual
    // provenance; clearing it clears provenance. Derived here on the server so
    // displayNameSource can never be set from client input (§8 S2). This is why
    // displayNameSource itself is NOT a client-whitelisted key below.
    out.displayNameSource = patch.displayName
      ? DISPLAY_NAME_SOURCE.MANUAL_ENTRY
      : null;
  }
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
  DISPLAY_NAME_SOURCE,
  VALID_STATUSES,
  VALID_SOURCES,
  VALID_INTERACTION_TYPES,
  VALID_DISPLAY_NAME_SOURCES,
  // phone
  normalizePhoneE164,
  customerIdFromPhone,
  // sanitizers
  sanitizeDisplayName,
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
