/**
 * smsOptins.test.js — Unit tests for the SMS consent schema module.
 *
 * Runner: Node's built-in test runner. No dependencies.
 *   Run from functions/:  node --test
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const s = require('./smsOptins.js');

// ---------------------------------------------------------------------------
// sanitizeRef
// ---------------------------------------------------------------------------

test('sanitizeRef: trims, caps at 100, non-string/empty -> null', () => {
  assert.equal(s.sanitizeRef('  cadenza  '), 'cadenza');
  assert.equal(s.sanitizeRef(''), null);
  assert.equal(s.sanitizeRef('   '), null);
  assert.equal(s.sanitizeRef(null), null);
  assert.equal(s.sanitizeRef(undefined), null);
  assert.equal(s.sanitizeRef(12345), null);
  assert.equal(s.sanitizeRef('a'.repeat(150)).length, 100);
});

// ---------------------------------------------------------------------------
// buildNewSmsOptin
// ---------------------------------------------------------------------------

test('buildNewSmsOptin: happy path sets consent, active status, timestamps', () => {
  const doc = s.buildNewSmsOptin({
    phone: '+12145550123',
    consentCopyVersion: 'v1-2026-07',
    ref: 'cadenza',
  });
  assert.equal(doc.phone, '+12145550123');
  assert.equal(doc.consentGiven, true);
  assert.equal(doc.consentCopyVersion, 'v1-2026-07');
  assert.equal(doc.ref, 'cadenza');
  assert.equal(doc.status, s.SMS_OPTIN_STATUS.ACTIVE);
  assert.ok('createdAt' in doc && 'updatedAt' in doc);
});

test('buildNewSmsOptin: ref defaults to null when absent/blank', () => {
  const doc = s.buildNewSmsOptin({ phone: '+12145550123', consentCopyVersion: 'v1' });
  assert.equal(doc.ref, null);
});

test('buildNewSmsOptin: throws on missing phone or consentCopyVersion', () => {
  assert.throws(() => s.buildNewSmsOptin({ consentCopyVersion: 'v1' }), /phone/);
  assert.throws(() => s.buildNewSmsOptin({ phone: '+12145550123' }), /consentCopyVersion/);
});

test('buildNewSmsOptin: throws on over-long consentCopyVersion', () => {
  assert.throws(
    () => s.buildNewSmsOptin({ phone: '+12145550123', consentCopyVersion: 'v'.repeat(41) }),
    /consentCopyVersion exceeds/,
  );
});

// ---------------------------------------------------------------------------
// buildSmsOptinRefresh
// ---------------------------------------------------------------------------

test('buildSmsOptinRefresh: re-affirms without createdAt (preserves original)', () => {
  const out = s.buildSmsOptinRefresh({ consentCopyVersion: 'v1-2026-07', ref: 'x' });
  assert.equal(out.consentGiven, true);
  assert.equal(out.status, s.SMS_OPTIN_STATUS.ACTIVE);
  assert.ok('updatedAt' in out);
  assert.ok(!('createdAt' in out), 'refresh must not touch createdAt');
});

test('buildSmsOptinRefresh: still validates consentCopyVersion', () => {
  assert.throws(() => s.buildSmsOptinRefresh({}), /consentCopyVersion/);
});
