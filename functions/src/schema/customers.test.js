/**
 * customers.test.js — Unit tests for the customer schema module.
 *
 * Focus: the identity/dedupe path (normalizePhoneE164, customerIdFromPhone),
 * since the customer document ID is derived from these and a regression would
 * silently merge or duplicate customer records. Plus factory validation and
 * path builders.
 *
 * Runner: Node's built-in test runner. No dependencies.
 *   Run from functions/:  node --test
 *   Or single file:       node --test src/schema/customers.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const c = require('./customers.js');

// ---------------------------------------------------------------------------
// normalizePhoneE164
// ---------------------------------------------------------------------------

test('normalizePhoneE164: accepts common US formats -> +1XXXXXXXXXX', () => {
  const expected = '+12145550123';
  for (const raw of [
    '(214) 555-0123',
    '214-555-0123',
    '214.555.0123',
    '2145550123',
    '12145550123',
    '1 (214) 555-0123',
    '+12145550123',
    '+1 214 555 0123',
    '  214 555 0123  ',
  ]) {
    assert.equal(c.normalizePhoneE164(raw), expected, `input: ${JSON.stringify(raw)}`);
  }
});

test('normalizePhoneE164: rejects invalid input -> null', () => {
  for (const raw of [
    '555-0123',        // too short (7 digits)
    '123',             // nonsense
    '',                // empty
    '21455501234',     // 11 digits not starting with 1
    '+442071234567',   // non-NANP country code
    '+12145550123456', // too long
    '1145550123',      // area code starts with 1 (invalid NANP)
    '2140550123',      // exchange starts with 0 (invalid NANP)
    '0145550123',      // area code starts with 0
  ]) {
    assert.equal(c.normalizePhoneE164(raw), null, `input: ${JSON.stringify(raw)}`);
  }
});

test('normalizePhoneE164: rejects non-string input -> null', () => {
  for (const raw of [null, undefined, 2145550123, {}, [], NaN]) {
    assert.equal(c.normalizePhoneE164(raw), null, `input: ${String(raw)}`);
  }
});

// ---------------------------------------------------------------------------
// customerIdFromPhone (the doc-ID derivation — dedupe guarantee)
// ---------------------------------------------------------------------------

test('customerIdFromPhone: strips the leading + from E.164', () => {
  assert.equal(c.customerIdFromPhone('(214) 555-0123'), '12145550123');
  assert.equal(c.customerIdFromPhone('+12145550123'), '12145550123');
});

test('customerIdFromPhone: all valid formats of one number collapse to one ID (dedupe)', () => {
  const ids = new Set([
    c.customerIdFromPhone('(214) 555-0123'),
    c.customerIdFromPhone('214-555-0123'),
    c.customerIdFromPhone('2145550123'),
    c.customerIdFromPhone('+1 214 555 0123'),
  ]);
  assert.equal(ids.size, 1, 'all formats must produce the same doc ID');
  assert.ok(!ids.has(null));
});

test('customerIdFromPhone: invalid phone -> null (caller must reject)', () => {
  assert.equal(c.customerIdFromPhone('123'), null);
  assert.equal(c.customerIdFromPhone('+442071234567'), null);
});

// ---------------------------------------------------------------------------
// normalizeAddress
// ---------------------------------------------------------------------------

test('normalizeAddress: empty/meaningless input -> null', () => {
  assert.equal(c.normalizeAddress(null), null);
  assert.equal(c.normalizeAddress(undefined), null);
  assert.equal(c.normalizeAddress({}), null);
  assert.equal(c.normalizeAddress({ line2: 'Apt 4' }), null); // no locating fields
});

test('normalizeAddress: fills missing sub-fields with null, stable shape', () => {
  const out = c.normalizeAddress({ line1: '100 Main St', city: 'Keller' });
  assert.deepEqual(out, {
    line1: '100 Main St',
    line2: null,
    city: 'Keller',
    state: null,
    postalCode: null,
  });
});

// ---------------------------------------------------------------------------
// buildNewCustomer
// ---------------------------------------------------------------------------

test('buildNewCustomer: happy path normalizes phone and applies defaults', () => {
  const doc = c.buildNewCustomer({
    accountId: 'acct1',
    phone: '(214) 555-0123',
    createdBy: c.SYSTEM_ACTOR.RECEPTIONIST,
    source: c.CUSTOMER_SOURCE.PHONE_CALL,
  });
  assert.equal(doc.phone, '+12145550123');
  assert.equal(doc.accountId, 'acct1');
  assert.equal(doc.status, c.CUSTOMER_STATUS.LEAD);   // default
  assert.equal(doc.source, c.CUSTOMER_SOURCE.PHONE_CALL);
  assert.equal(doc.createdBy, 'system:receptionist');
  assert.equal(doc.address, null);
  assert.ok('createdAt' in doc && 'updatedAt' in doc);
});

test('buildNewCustomer: throws on unnormalizable phone', () => {
  assert.throws(
    () => c.buildNewCustomer({ accountId: 'a', phone: '123', createdBy: 'u' }),
    /could not normalize phone/,
  );
});

test('buildNewCustomer: throws on missing required fields', () => {
  assert.throws(() => c.buildNewCustomer({ phone: '2145550123', createdBy: 'u' }), /accountId/);
  assert.throws(() => c.buildNewCustomer({ accountId: 'a', phone: '2145550123' }), /createdBy/);
});

test('buildNewCustomer: throws on invalid status or source enum', () => {
  const base = { accountId: 'a', phone: '2145550123', createdBy: 'u' };
  assert.throws(() => c.buildNewCustomer({ ...base, status: 'pending' }), /invalid status/);
  assert.throws(() => c.buildNewCustomer({ ...base, source: 'carrier_pigeon' }), /invalid source/);
});

// ---------------------------------------------------------------------------
// buildCustomerUpdate
// ---------------------------------------------------------------------------

test('buildCustomerUpdate: always stamps updatedAt', () => {
  const out = c.buildCustomerUpdate({});
  assert.ok('updatedAt' in out);
  assert.equal(Object.keys(out).length, 1);
});

test('buildCustomerUpdate: passes whitelisted fields, ignores identity fields', () => {
  const out = c.buildCustomerUpdate({
    displayName: 'Maria',
    notes: 'called twice',
    phone: '+19999999999',   // must be ignored (identity, immutable)
    accountId: 'other',      // must be ignored
    createdBy: 'someone',     // must be ignored
  });
  assert.equal(out.displayName, 'Maria');
  assert.equal(out.notes, 'called twice');
  assert.ok(!('phone' in out));
  assert.ok(!('accountId' in out));
  assert.ok(!('createdBy' in out));
});

test('buildCustomerUpdate: validates status/source when present', () => {
  assert.throws(() => c.buildCustomerUpdate({ status: 'nope' }), /invalid status/);
  assert.throws(() => c.buildCustomerUpdate({ source: 'nope' }), /invalid source/);
  assert.doesNotThrow(() => c.buildCustomerUpdate({ status: c.CUSTOMER_STATUS.ACTIVE }));
});

// ---------------------------------------------------------------------------
// sanitizeDisplayName (untrusted LLM-extracted name cleaning — §8 S2)
// ---------------------------------------------------------------------------

test('sanitizeDisplayName: trims, collapses whitespace, strips wrapping quotes', () => {
  assert.equal(c.sanitizeDisplayName('  John   Smith  '), 'John Smith');
  assert.equal(c.sanitizeDisplayName('"Jane Doe"'), 'Jane Doe');
  assert.equal(c.sanitizeDisplayName("'Bob'"), 'Bob');
});

test('sanitizeDisplayName: rejects empty, non-string, and letterless junk -> null', () => {
  for (const raw of ['', '   ', null, undefined, 12345, {}, '---', '123 456', '!!!']) {
    assert.equal(c.sanitizeDisplayName(raw), null, `input: ${String(raw)}`);
  }
});

test('sanitizeDisplayName: rejects over-long input (a sentence, not a name) -> null', () => {
  assert.equal(c.sanitizeDisplayName('a'.repeat(81)), null);
  assert.equal(c.sanitizeDisplayName('a'.repeat(80)), 'a'.repeat(80)); // exactly at cap is ok
});

// ---------------------------------------------------------------------------
// displayNameSource provenance (buildNewCustomer + buildCustomerUpdate)
// ---------------------------------------------------------------------------

test('buildNewCustomer: defaults displayNameSource to manual_entry when a name is present', () => {
  const doc = c.buildNewCustomer({
    accountId: 'a', phone: '2145550123', createdBy: 'u', displayName: 'Maria Lopez',
  });
  assert.equal(doc.displayName, 'Maria Lopez');
  assert.equal(doc.displayNameSource, 'manual_entry');
});

test('buildNewCustomer: displayNameSource is null when no name is given', () => {
  const doc = c.buildNewCustomer({ accountId: 'a', phone: '2145550123', createdBy: 'u' });
  assert.equal(doc.displayName, null);
  assert.equal(doc.displayNameSource, null);
});

test('buildNewCustomer: honors explicit ai_extracted provenance', () => {
  const doc = c.buildNewCustomer({
    accountId: 'a', phone: '2145550123', createdBy: 'u',
    displayName: 'Sam', displayNameSource: c.DISPLAY_NAME_SOURCE.AI_EXTRACTED,
  });
  assert.equal(doc.displayNameSource, 'ai_extracted');
});

test('buildNewCustomer: a null name forces null provenance even if a source is passed', () => {
  const doc = c.buildNewCustomer({
    accountId: 'a', phone: '2145550123', createdBy: 'u',
    displayName: null, displayNameSource: c.DISPLAY_NAME_SOURCE.AI_EXTRACTED,
  });
  assert.equal(doc.displayNameSource, null);
});

test('buildNewCustomer: throws on invalid displayNameSource', () => {
  assert.throws(
    () => c.buildNewCustomer({
      accountId: 'a', phone: '2145550123', createdBy: 'u',
      displayName: 'X', displayNameSource: 'robot',
    }),
    /invalid displayNameSource/,
  );
});

test('buildCustomerUpdate: stamps manual_entry when a human sets the name, null when cleared', () => {
  const set = c.buildCustomerUpdate({ displayName: 'Maria' });
  assert.equal(set.displayName, 'Maria');
  assert.equal(set.displayNameSource, 'manual_entry');

  const cleared = c.buildCustomerUpdate({ displayName: null });
  assert.equal(cleared.displayName, null);
  assert.equal(cleared.displayNameSource, null);
});

test('buildCustomerUpdate: displayNameSource is server-derived, never client-settable', () => {
  // A client forging provenance without editing the name is ignored (not whitelisted).
  const out = c.buildCustomerUpdate({ displayNameSource: 'ai_extracted' });
  assert.ok(!('displayNameSource' in out));
});

// ---------------------------------------------------------------------------
// buildInteraction
// ---------------------------------------------------------------------------

test('buildInteraction: happy path', () => {
  const out = c.buildInteraction({
    type: c.INTERACTION_TYPE.CALL,
    createdBy: c.SYSTEM_ACTOR.RECEPTIONIST,
    summary: 'inbound call, 42s',
    data: { callSid: 'CA123', durationSec: 42 },
  });
  assert.equal(out.type, 'call');
  assert.equal(out.summary, 'inbound call, 42s');
  assert.deepEqual(out.data, { callSid: 'CA123', durationSec: 42 });
  assert.ok('createdAt' in out);
});

test('buildInteraction: throws on invalid type or missing createdBy', () => {
  assert.throws(
    () => c.buildInteraction({ type: 'smoke_signal', createdBy: 'u' }),
    /invalid type/,
  );
  assert.throws(
    () => c.buildInteraction({ type: c.INTERACTION_TYPE.NOTE }),
    /createdBy/,
  );
});

// ---------------------------------------------------------------------------
// path builders
// ---------------------------------------------------------------------------

test('path builders: produce canonical multi-tenant paths', () => {
  assert.equal(c.customersCollectionPath('A'), 'accounts/A/customers');
  assert.equal(c.customerDocPath('A', '12145550123'), 'accounts/A/customers/12145550123');
  assert.equal(
    c.interactionsCollectionPath('A', '12145550123'),
    'accounts/A/customers/12145550123/interactions',
  );
  assert.equal(
    c.interactionDocPath('A', '12145550123', 'int1'),
    'accounts/A/customers/12145550123/interactions/int1',
  );
});

test('path builders: reject empty ids', () => {
  assert.throws(() => c.customersCollectionPath(''), /accountId/);
  assert.throws(() => c.customerDocPath('A', ''), /customerId/);
});
