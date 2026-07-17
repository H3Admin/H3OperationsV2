/**
 * signupRequests.test.js — Unit tests for the signup-request schema module.
 *
 * Runner: Node's built-in test runner. No dependencies.
 *   Run from functions/:  node --test
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const s = require('./signupRequests.js');

// ---------------------------------------------------------------------------
// normalizeEmail
// ---------------------------------------------------------------------------

test('normalizeEmail: lowercases + trims a valid address', () => {
  assert.equal(s.normalizeEmail('  Owner@Example.COM '), 'owner@example.com');
});

test('normalizeEmail: throws on empty, malformed, or slash-bearing input', () => {
  assert.throws(() => s.normalizeEmail(''), /email/);
  assert.throws(() => s.normalizeEmail('not-an-email'), /valid address/);
  assert.throws(() => s.normalizeEmail('a@b'), /valid address/);
  assert.throws(() => s.normalizeEmail('a/b@example.com'), /valid address/); // doc-ID safety
});

// ---------------------------------------------------------------------------
// sanitizeTag
// ---------------------------------------------------------------------------

test('sanitizeTag: trims, caps, non-string/empty -> null', () => {
  assert.equal(s.sanitizeTag('  cadenza  ', 100), 'cadenza');
  assert.equal(s.sanitizeTag('', 100), null);
  assert.equal(s.sanitizeTag(null, 100), null);
  assert.equal(s.sanitizeTag(12345, 100), null);
  assert.equal(s.sanitizeTag('a'.repeat(150), 60).length, 60);
});

// ---------------------------------------------------------------------------
// buildNewSignupRequest
// ---------------------------------------------------------------------------

const GOOD = {
  businessName: 'Acme Plumbing',
  contactName: 'Jane Doe',
  phone: '+12145550123',
  email: 'Jane@Acme.com',
  ref: 'cadenza',
  source: 'website-v1-signup',
};

test('buildNewSignupRequest: happy path sets fields, new status, timestamps', () => {
  const doc = s.buildNewSignupRequest(GOOD);
  assert.equal(doc.businessName, 'Acme Plumbing');
  assert.equal(doc.contactName, 'Jane Doe');
  assert.equal(doc.phone, '+12145550123');
  assert.equal(doc.email, 'jane@acme.com'); // normalized
  assert.equal(doc.ref, 'cadenza');
  assert.equal(doc.source, 'website-v1-signup');
  assert.equal(doc.status, s.SIGNUP_REQUEST_STATUS.NEW);
  assert.ok('createdAt' in doc && 'updatedAt' in doc);
});

test('buildNewSignupRequest: ref/source default to null when absent/blank', () => {
  const doc = s.buildNewSignupRequest({ ...GOOD, ref: undefined, source: '  ' });
  assert.equal(doc.ref, null);
  assert.equal(doc.source, null);
});

test('buildNewSignupRequest: throws on missing required fields', () => {
  assert.throws(() => s.buildNewSignupRequest({ ...GOOD, phone: undefined }), /phone/);
  assert.throws(() => s.buildNewSignupRequest({ ...GOOD, businessName: '' }), /businessName/);
  assert.throws(() => s.buildNewSignupRequest({ ...GOOD, contactName: '   ' }), /contactName/);
  assert.throws(() => s.buildNewSignupRequest({ ...GOOD, email: 'bad' }), /valid address/);
});

test('buildNewSignupRequest: throws on over-long bounded field', () => {
  assert.throws(
    () => s.buildNewSignupRequest({ ...GOOD, businessName: 'x'.repeat(121) }),
    /businessName exceeds/,
  );
});

// ---------------------------------------------------------------------------
// buildSignupRequestRefresh
// ---------------------------------------------------------------------------

test('buildSignupRequestRefresh: refreshes contact fields, omits createdAt + status', () => {
  const out = s.buildSignupRequestRefresh({
    businessName: 'Acme Plumbing',
    contactName: 'Jane Doe',
    email: 'JANE@acme.com',
    ref: 'x',
    source: 'website-v1-signup',
  });
  assert.equal(out.email, 'jane@acme.com');
  assert.ok('updatedAt' in out);
  assert.ok(!('createdAt' in out), 'refresh must not touch createdAt');
  assert.ok(!('status' in out), 'refresh must not reset status');
});

test('buildSignupRequestRefresh: still validates required fields', () => {
  assert.throws(() => s.buildSignupRequestRefresh({}), /businessName/);
});
