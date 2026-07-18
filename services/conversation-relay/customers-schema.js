/**
 * customers-schema.js — SYNCED COPY of functions/src/schema/customers.js.
 *
 * ⚠️ §2.2 CAVEAT: the canonical customer/lead schema authority lives at
 * functions/src/schema/customers.js. That module is CommonJS and imports
 * FieldValue from firebase-admin/firestore; this Cloud Run service is ESM and
 * talks to Firestore via @google-cloud/firestore directly. Because a separate
 * Cloud Run deploy unit cannot import across the functions/ boundary, this file
 * is a hand-synced ESM port of the WRITE side (buildNewCustomer + the phone /
 * sanitizer / enum helpers it needs). The ONLY intended differences from the
 * canonical file are: (a) ESM import/export, (b) FieldValue sourced from
 * @google-cloud/firestore (same sentinel class Admin wraps). If the canonical
 * module changes, update this copy BY HAND and note it. This duplication is
 * tracked tech debt — the clean fix is a shared package (flagged at handoff).
 */

import { FieldValue } from '@google-cloud/firestore';

// ---------------------------------------------------------------------------
// Enums (snake_case values)
// ---------------------------------------------------------------------------

export const CUSTOMER_STATUS = Object.freeze({
  LEAD: 'lead',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
});

export const CUSTOMER_SOURCE = Object.freeze({
  PHONE_CALL: 'phone_call',
  WEB_FORM: 'web_form',
  REFERRAL: 'referral',
  MANUAL_ENTRY: 'manual_entry',
});

export const SYSTEM_ACTOR = Object.freeze({
  RECEPTIONIST: 'system:receptionist',
});

export const DISPLAY_NAME_SOURCE = Object.freeze({
  AI_EXTRACTED: 'ai_extracted',
  MANUAL_ENTRY: 'manual_entry',
});

const VALID_STATUSES = Object.freeze(Object.values(CUSTOMER_STATUS));
const VALID_SOURCES = Object.freeze(Object.values(CUSTOMER_SOURCE));
const VALID_DISPLAY_NAME_SOURCES = Object.freeze(Object.values(DISPLAY_NAME_SOURCE));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

const MAX_DISPLAY_NAME_LEN = 80;

/**
 * Sanitize an UNTRUSTED display-name string before storage (§8 S2: no LLM output
 * in the data-integrity path). Returns a clean name, or null if unusable.
 */
export function sanitizeDisplayName(raw) {
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

function normalizeAddress(address) {
  if (!address || typeof address !== 'object') return null;
  const { line1 = null, line2 = null, city = null, state = null, postalCode = null } = address;
  if (!line1 && !city && !state && !postalCode) return null;
  return { line1, line2, city, state, postalCode };
}

// ---------------------------------------------------------------------------
// Phone normalization (NANP / US-first, dependency-free)
// ---------------------------------------------------------------------------

export function normalizePhoneE164(raw) {
  if (typeof raw !== 'string') return null;

  const hasPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');

  if (hasPlus) {
    if (!(digits.length === 11 && digits.startsWith('1'))) return null;
    digits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  } else if (digits.length !== 10) {
    return null;
  }

  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;

  return '+1' + digits;
}

/**
 * Derive the Firestore document ID from a raw phone number: the E.164 digits
 * with no leading "+". Returns null if the phone cannot be normalized.
 */
export function customerIdFromPhone(raw) {
  const e164 = normalizePhoneE164(raw);
  return e164 ? e164.slice(1) : null;
}

// ---------------------------------------------------------------------------
// Document factory (pure — builds the body, does not write)
// ---------------------------------------------------------------------------

/**
 * Build a new customer document body from validated inputs.
 * Mirror of functions/src/schema/customers.js buildNewCustomer.
 */
export function buildNewCustomer(input = {}) {
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

  let resolvedNameSource =
    displayNameSource === undefined
      ? (displayName ? DISPLAY_NAME_SOURCE.MANUAL_ENTRY : null)
      : displayNameSource;
  if (
    resolvedNameSource !== null &&
    !VALID_DISPLAY_NAME_SOURCES.includes(resolvedNameSource)
  ) {
    throw new Error(`buildNewCustomer: invalid displayNameSource "${resolvedNameSource}"`);
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
