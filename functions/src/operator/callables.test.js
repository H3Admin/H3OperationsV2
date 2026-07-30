/**
 * callables.test.js — Auth-guard tests for the Operator Dashboard callables
 * (operatorListAccounts, operatorGetAccount).
 *
 * onCall handlers aren't practically invokable under node --test without
 * pulling in firebase-functions-test (not currently a dependency here) to
 * fake the Functions runtime — so per the fallback in the task, this tests
 * the auth guard the callables actually run first: assertOperator. Both
 * callables call `assertOperator(context)` as their first line (see
 * callables.ts), so proving assertOperator rejects a non-operator context and
 * allows an operator context covers the auth path those callables share with
 * createCustomer/updateCustomer/createJob/updateJob.
 *
 * Build first, then test: cd functions && npm run build && node --test
 * src/operator/callables.test.js (or just npm run build && npm test).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { assertOperator } = require('../../lib/operator/permissions.js');

test('assertOperator: no context.auth -> throws unauthenticated', () => {
  assert.throws(
    () => assertOperator({ auth: undefined }),
    (err) => {
      assert.equal(err.code, 'unauthenticated');
      return true;
    },
  );
});

test('assertOperator: signed in but roles missing "operator" -> throws permission-denied', () => {
  assert.throws(
    () =>
      assertOperator({
        auth: { uid: 'user1', token: { roles: ['member'] } },
      }),
    (err) => {
      assert.equal(err.code, 'permission-denied');
      return true;
    },
  );
});

test('assertOperator: signed in with no roles claim at all -> throws permission-denied', () => {
  assert.throws(
    () => assertOperator({ auth: { uid: 'user1', token: {} } }),
    (err) => {
      assert.equal(err.code, 'permission-denied');
      return true;
    },
  );
});

test('assertOperator: signed in with roles including "operator" -> returns uid + roles', () => {
  const result = assertOperator({
    auth: { uid: 'operatorUid1', token: { roles: ['operator'] } },
  });
  assert.deepEqual(result, { uid: 'operatorUid1', roles: ['operator'] });
});
