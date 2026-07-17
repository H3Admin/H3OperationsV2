/**
 * checklistRequests.test.js — Unit tests for the checklist-request schema module.
 *
 * Runner: Node's built-in test runner. No dependencies.
 *   Run from functions/:  node --test
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const s = require('./checklistRequests.js');

// ---------------------------------------------------------------------------
// normalizeEmail (also the doc-ID deriver — must stay doc-ID safe)
// ---------------------------------------------------------------------------

test('normalizeEmail: lowercases + trims a valid address', () => {
  assert.equal(s.normalizeEmail('  You@Example.COM '), 'you@example.com');
});

test('normalizeEmail: rejects malformed and slash/whitespace-bearing input', () => {
  assert.throws(() => s.normalizeEmail(''), /email/);
  assert.throws(() => s.normalizeEmail('nope'), /valid address/);
  assert.throws(() => s.normalizeEmail('a/b@example.com'), /valid address/); // doc-ID safety
  assert.throws(() => s.normalizeEmail('a b@example.com'), /valid address/);
});

// ---------------------------------------------------------------------------
// buildNewChecklistRequest
// ---------------------------------------------------------------------------

test('buildNewChecklistRequest: happy path sets fields, new status, timestamps', () => {
  const doc = s.buildNewChecklistRequest({
    email: 'You@Example.com',
    ref: 'cadenza',
    source: 'website-v1-checklist',
  });
  assert.equal(doc.email, 'you@example.com'); // normalized
  assert.equal(doc.ref, 'cadenza');
  assert.equal(doc.source, 'website-v1-checklist');
  assert.equal(doc.status, s.CHECKLIST_REQUEST_STATUS.NEW);
  assert.ok('createdAt' in doc && 'updatedAt' in doc);
});

test('buildNewChecklistRequest: ref/source default to null when absent/blank', () => {
  const doc = s.buildNewChecklistRequest({ email: 'you@example.com' });
  assert.equal(doc.ref, null);
  assert.equal(doc.source, null);
});

test('buildNewChecklistRequest: throws on invalid email', () => {
  assert.throws(() => s.buildNewChecklistRequest({ email: 'bad' }), /valid address/);
  assert.throws(() => s.buildNewChecklistRequest({}), /email/);
});

// ---------------------------------------------------------------------------
// buildChecklistRequestRefresh
// ---------------------------------------------------------------------------

test('buildChecklistRequestRefresh: refreshes provenance, omits createdAt/status/email', () => {
  const out = s.buildChecklistRequestRefresh({ ref: 'x', source: 'website-v1-checklist' });
  assert.equal(out.ref, 'x');
  assert.equal(out.source, 'website-v1-checklist');
  assert.ok('updatedAt' in out);
  assert.ok(!('createdAt' in out), 'refresh must not touch createdAt');
  assert.ok(!('status' in out), 'refresh must not reset status');
  assert.ok(!('email' in out), 'email is the doc ID — never in a merge partial');
});
