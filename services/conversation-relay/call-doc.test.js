/**
 * call-doc.test.js — unit tests for the pure call-doc write-path helpers.
 *
 * Runner: Node's built-in test runner (ESM). No dependencies.
 *   Run from services/conversation-relay/:  node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shapeTurnForDoc, isNewLeadFromOutcome, chainWrite } from './call-doc.js';

// ---------------------------------------------------------------------------
// shapeTurnForDoc — reader contract { callerText, aiText } + monotonic seq
// ---------------------------------------------------------------------------

test('shapeTurnForDoc: keeps callerText + aiText and stamps seq', () => {
  assert.deepEqual(
    shapeTurnForDoc({ callerText: 'my sink leaks', aiText: 'I can help' }, 0),
    { callerText: 'my sink leaks', aiText: 'I can help', seq: 0 },
  );
});

test('shapeTurnForDoc: strips extra keys but keeps callerText/aiText/seq', () => {
  const shaped = shapeTurnForDoc(
    { callerText: 'hi', aiText: 'hello', confidence: 0.92, timestamp: 1720000000 },
    3,
  );
  assert.deepEqual(shaped, { callerText: 'hi', aiText: 'hello', seq: 3 });
  assert.deepEqual(Object.keys(shaped).sort(), ['aiText', 'callerText', 'seq']);
});

test('shapeTurnForDoc: two identical turns produce DISTINCT elements (seq differs)', () => {
  // arrayUnion drops deep-equal repeats; distinct seq keeps both. This is the
  // regression guard for silent transcript loss in confirmation flows.
  const a = shapeTurnForDoc({ callerText: 'Yes.', aiText: 'Great.' }, 4);
  const b = shapeTurnForDoc({ callerText: 'Yes.', aiText: 'Great.' }, 5);
  assert.notDeepEqual(a, b);
  assert.equal(a.seq, 4);
  assert.equal(b.seq, 5);
  // Same reader-visible text, so the transcript reads identically...
  assert.equal(a.callerText, b.callerText);
  assert.equal(a.aiText, b.aiText);
});

test('shapeTurnForDoc: non-integer/missing seq -> 0', () => {
  assert.equal(shapeTurnForDoc({ callerText: 'a', aiText: 'b' }).seq, 0);
  assert.equal(shapeTurnForDoc({ callerText: 'a', aiText: 'b' }, 2.5).seq, 0);
  assert.equal(shapeTurnForDoc({ callerText: 'a', aiText: 'b' }, '1').seq, 0);
});

test('shapeTurnForDoc: coerces missing/non-string fields to empty strings', () => {
  assert.deepEqual(shapeTurnForDoc({}, 0), { callerText: '', aiText: '', seq: 0 });
  assert.deepEqual(shapeTurnForDoc({ callerText: 5, aiText: null }, 1), {
    callerText: '',
    aiText: '',
    seq: 1,
  });
});

test('shapeTurnForDoc: tolerates null/undefined input', () => {
  assert.deepEqual(shapeTurnForDoc(null, 0), { callerText: '', aiText: '', seq: 0 });
  assert.deepEqual(shapeTurnForDoc(undefined, 0), { callerText: '', aiText: '', seq: 0 });
});

// ---------------------------------------------------------------------------
// isNewLeadFromOutcome — created-vs-existing resolution
// ---------------------------------------------------------------------------

test('isNewLeadFromOutcome: only "created" is a new lead', () => {
  assert.equal(isNewLeadFromOutcome('created'), true);
});

test('isNewLeadFromOutcome: existing customer / unparseable / unknown -> false', () => {
  assert.equal(isNewLeadFromOutcome('exists'), false);
  assert.equal(isNewLeadFromOutcome('skipped_unparseable'), false);
  assert.equal(isNewLeadFromOutcome('error'), false);
  assert.equal(isNewLeadFromOutcome(undefined), false);
  assert.equal(isNewLeadFromOutcome(''), false);
});

// ---------------------------------------------------------------------------
// chainWrite — fire-and-forget turn-write chain: catches, logs, never throws
// ---------------------------------------------------------------------------

test('chainWrite: a failed write routes to onError and does NOT reject', async () => {
  const seen = [];
  const boom = new Error('firestore unavailable');
  // The chain tail returned must resolve (not reject), proving a write failure
  // can never throw into the live call.
  const tail = chainWrite(
    Promise.resolve(),
    () => Promise.reject(boom),
    (err) => seen.push(err),
  );
  await assert.doesNotReject(tail);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], boom); // never silent — the error reaches the sink
});

test('chainWrite: a successful write does NOT call onError', async () => {
  let calls = 0;
  await chainWrite(
    Promise.resolve(),
    () => Promise.resolve('ok'),
    () => { calls += 1; },
  );
  assert.equal(calls, 0);
});

test('chainWrite: one failed write does not poison the next (chain keeps going)', async () => {
  const order = [];
  let chain = Promise.resolve();
  chain = chainWrite(chain, () => Promise.reject(new Error('turn1 failed')), () => order.push('err1'));
  chain = chainWrite(chain, () => { order.push('turn2'); return Promise.resolve(); }, () => order.push('err2'));
  await chain;
  // turn2 still ran after turn1's failure, in order, and turn2 did not error.
  assert.deepEqual(order, ['err1', 'turn2']);
});
