/**
 * calls.test.js — Unit tests for the call-record schema module.
 *
 * Focus: the buildNewCall factory contract that the handleCallStatus reader and
 * the CRM/dashboard depend on — required fields present, correct defaults, valid
 * enums, and the field names/shapes pinned to the reader (`from`, `turns`,
 * `status`, `durationSeconds`). Plus the callSid-keyed doc path (doc ID = callSid).
 *
 * Runner: Node's built-in test runner. No dependencies.
 *   Run from functions/:  node --test
 *   Or single file:       node --test src/schema/calls.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const c = require('./calls.js');

// Minimal valid input for buildNewCall.
function baseInput(overrides = {}) {
  return {
    callSid: 'CA1234567890abcdef',
    accountId: 'acct_1',
    from: '+12145550123',
    isNewLead: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildNewCall — happy path & defaults
// ---------------------------------------------------------------------------

test('buildNewCall: required fields present + correct defaults', () => {
  const doc = c.buildNewCall(baseInput());

  // Required fields carried through.
  assert.equal(doc.callSid, 'CA1234567890abcdef');
  assert.equal(doc.accountId, 'acct_1');
  assert.equal(doc.from, '+12145550123'); // raw E.164 WITH "+", not callerE164
  assert.equal(doc.isNewLead, true);

  // Defaults.
  assert.equal(doc.to, null);
  assert.equal(doc.direction, 'inbound');
  assert.equal(doc.status, 'in_progress');
  assert.equal(doc.durationSeconds, 0);
  assert.deepEqual(doc.turns, []);

  // Lifecycle timestamps: startedAt stamped, endedAt null until completion.
  assert.ok('startedAt' in doc);
  assert.equal(doc.endedAt, null);

  // No callerE164 / createdAt / updatedAt / summary / source (deliberately omitted).
  assert.ok(!('callerE164' in doc));
  assert.ok(!('createdAt' in doc));
  assert.ok(!('updatedAt' in doc));
  assert.ok(!('summary' in doc));
  assert.ok(!('source' in doc));
});

test('buildNewCall: passes through provided optional fields', () => {
  const turns = [
    { callerText: 'My sink is leaking', aiText: 'I can help with that.' },
    { callerText: 'Today if possible', aiText: 'Let me check availability.' },
  ];
  const doc = c.buildNewCall(
    baseInput({
      to: '+18005551212',
      direction: 'inbound',
      status: 'completed',
      durationSeconds: 87,
      isNewLead: false,
      turns,
    }),
  );
  assert.equal(doc.to, '+18005551212');
  assert.equal(doc.status, 'completed');
  assert.equal(doc.durationSeconds, 87);
  assert.equal(doc.isNewLead, false);
  assert.deepEqual(doc.turns, turns);
});

test('buildNewCall: turns element keeps reader shape {callerText, aiText}', () => {
  const doc = c.buildNewCall(baseInput({ turns: [{ callerText: 'hi', aiText: 'hello' }] }));
  assert.equal(doc.turns[0].callerText, 'hi');
  assert.equal(doc.turns[0].aiText, 'hello');
});

test('buildNewCall: permits extra keys on a turn (confidence/timestamp superset)', () => {
  const turns = [{ callerText: 'hi', aiText: 'hello', confidence: 0.9, timestamp: 123 }];
  const doc = c.buildNewCall(baseInput({ turns }));
  assert.deepEqual(doc.turns, turns);
});

// ---------------------------------------------------------------------------
// buildNewCall — required-field validation
// ---------------------------------------------------------------------------

test('buildNewCall: throws on missing required string fields', () => {
  assert.throws(() => c.buildNewCall(baseInput({ callSid: undefined })), /callSid/);
  assert.throws(() => c.buildNewCall(baseInput({ accountId: '' })), /accountId/);
  assert.throws(() => c.buildNewCall(baseInput({ from: '   ' })), /from/);
});

test('buildNewCall: throws when isNewLead is not a boolean', () => {
  assert.throws(() => c.buildNewCall(baseInput({ isNewLead: undefined })), /isNewLead/);
  assert.throws(() => c.buildNewCall(baseInput({ isNewLead: 'true' })), /isNewLead/);
  assert.throws(() => c.buildNewCall(baseInput({ isNewLead: 1 })), /isNewLead/);
});

// ---------------------------------------------------------------------------
// buildNewCall — enum validation
// ---------------------------------------------------------------------------

test('buildNewCall: accepts every valid status enum value', () => {
  for (const status of c.VALID_STATUSES) {
    const doc = c.buildNewCall(baseInput({ status }));
    assert.equal(doc.status, status);
  }
});

test('buildNewCall: throws on invalid status enum', () => {
  assert.throws(() => c.buildNewCall(baseInput({ status: 'initiated' })), /invalid status/);
  assert.throws(() => c.buildNewCall(baseInput({ status: 'ringing' })), /invalid status/);
});

test('buildNewCall: throws on invalid direction enum', () => {
  assert.throws(() => c.buildNewCall(baseInput({ direction: 'outbound' })), /invalid direction/);
});

test('buildNewCall: VALID_STATUSES matches the reader-pinned strings', () => {
  assert.deepEqual(
    [...c.VALID_STATUSES].sort(),
    ['busy', 'cancelled', 'completed', 'failed', 'in_progress', 'no_answer'].sort(),
  );
});

// ---------------------------------------------------------------------------
// buildNewCall — durationSeconds validation (integer seconds)
// ---------------------------------------------------------------------------

test('buildNewCall: throws on non-integer or negative durationSeconds', () => {
  assert.throws(() => c.buildNewCall(baseInput({ durationSeconds: 1.5 })), /durationSeconds/);
  assert.throws(() => c.buildNewCall(baseInput({ durationSeconds: -1 })), /durationSeconds/);
  assert.throws(() => c.buildNewCall(baseInput({ durationSeconds: '30' })), /durationSeconds/);
});

test('buildNewCall: throws when turns is not an array', () => {
  assert.throws(() => c.buildNewCall(baseInput({ turns: 'nope' })), /turns must be an array/);
});

// ---------------------------------------------------------------------------
// Path builders — doc ID = callSid
// ---------------------------------------------------------------------------

test('callsCollectionPath: tenant-scoped', () => {
  assert.equal(c.callsCollectionPath('acct_1'), 'accounts/acct_1/calls');
});

test('callDocPath: doc ID is the callSid', () => {
  assert.equal(
    c.callDocPath('acct_1', 'CA1234567890abcdef'),
    'accounts/acct_1/calls/CA1234567890abcdef',
  );
});

test('path builders: throw on empty ids', () => {
  assert.throws(() => c.callsCollectionPath(''), /accountId/);
  assert.throws(() => c.callDocPath('acct_1', ''), /callSid/);
});
