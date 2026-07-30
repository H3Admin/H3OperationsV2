/**
 * permissions.test.js — Unit tests for resolveOperatorPermissions.
 *
 * permissions.ts is TypeScript (unlike the plain-.js schema modules), so this
 * test runs against the compiled output in lib/. Build first, then test:
 *   cd functions && npm run build && node --test src/operator/permissions.test.js
 * (or just `npm run build && npm test`, which runs the whole suite).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveOperatorPermissions } = require('../../lib/operator/permissions.js');

test('resolveOperatorPermissions: roles includes "operator" -> isOperator true', () => {
  const result = resolveOperatorPermissions({ roles: ['operator'] });
  assert.equal(result.isOperator, true);
  assert.deepEqual(result.roles, ['operator']);
});

test('resolveOperatorPermissions: roles present but without "operator" -> isOperator false', () => {
  const result = resolveOperatorPermissions({ roles: ['member'] });
  assert.equal(result.isOperator, false);
  assert.deepEqual(result.roles, ['member']);
});

test('resolveOperatorPermissions: no claims / no roles -> isOperator false, roles []', () => {
  assert.deepEqual(resolveOperatorPermissions(undefined), { isOperator: false, roles: [] });
  assert.deepEqual(resolveOperatorPermissions(null), { isOperator: false, roles: [] });
  assert.deepEqual(resolveOperatorPermissions({}), { isOperator: false, roles: [] });
});
