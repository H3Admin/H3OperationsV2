/**
 * jobs.test.js — Unit tests for the job/dispatch schema module.
 *
 * Focus: scheduledAt coercion (the field the 14-day board queries/sorts on),
 * the customer-link hybrid (customerId nullable + denormalized snapshot),
 * factory validation, and path builders. Mirrors the structure and style of
 * customers.test.js.
 *
 * Runner: Node's built-in test runner. No dependencies.
 * Run from functions/: node --test
 * Or single file: node --test src/schema/jobs.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const j = require('./jobs.js');

// ---------------------------------------------------------------------------
// toTimestamp
// ---------------------------------------------------------------------------

test('toTimestamp: accepts a Date', () => {
  const d = new Date('2026-07-09T14:30:00Z');
  const ts = j.toTimestamp(d, 'scheduledAt');
  assert.equal(ts.toDate().getTime(), d.getTime());
});

test('toTimestamp: accepts epoch millis', () => {
  const ms = Date.parse('2026-07-09T14:30:00Z');
  const ts = j.toTimestamp(ms, 'scheduledAt');
  assert.equal(ts.toDate().getTime(), ms);
});

test('toTimestamp: accepts an ISO-8601 string', () => {
  const ts = j.toTimestamp('2026-07-09T14:30:00Z', 'scheduledAt');
  assert.equal(ts.toDate().toISOString(), '2026-07-09T14:30:00.000Z');
});

test('toTimestamp: throws on unparseable input', () => {
  for (const bad of [null, undefined, {}, [], 'not a date', NaN]) {
    assert.throws(() => j.toTimestamp(bad, 'scheduledAt'), /scheduledAt/, `input: ${String(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// normalizeSnapshotPhone (display-only — distinct from customers' identity path)
// ---------------------------------------------------------------------------

test('normalizeSnapshotPhone: absent -> null (optional field)', () => {
  assert.equal(j.normalizeSnapshotPhone(null), null);
  assert.equal(j.normalizeSnapshotPhone(undefined), null);
  assert.equal(j.normalizeSnapshotPhone(''), null);
});

test('normalizeSnapshotPhone: normalizes to E.164 like the customer identity path', () => {
  assert.equal(j.normalizeSnapshotPhone('(214) 555-0123'), '+12145550123');
});

test('normalizeSnapshotPhone: throws on unnormalizable value (never store raw)', () => {
  assert.throws(() => j.normalizeSnapshotPhone('123'), /customerPhone/);
});

// ---------------------------------------------------------------------------
// normalizePriceCents / normalizeDurationMin
// ---------------------------------------------------------------------------

test('normalizePriceCents: null/undefined -> null', () => {
  assert.equal(j.normalizePriceCents(null, 'priceCents'), null);
  assert.equal(j.normalizePriceCents(undefined, 'priceCents'), null);
});

test('normalizePriceCents: accepts non-negative integers', () => {
  assert.equal(j.normalizePriceCents(0, 'priceCents'), 0);
  assert.equal(j.normalizePriceCents(245000, 'priceCents'), 245000);
});

test('normalizePriceCents: rejects negatives, floats, and non-numbers', () => {
  for (const bad of [-1, 24.5, '2450', {}, NaN]) {
    assert.throws(() => j.normalizePriceCents(bad, 'priceCents'), /priceCents/, `input: ${String(bad)}`);
  }
});

test('normalizeDurationMin: null/undefined -> null', () => {
  assert.equal(j.normalizeDurationMin(null, 'durationMin'), null);
});

test('normalizeDurationMin: rejects zero, negatives, and non-integers', () => {
  for (const bad of [0, -30, 45.5, '60']) {
    assert.throws(() => j.normalizeDurationMin(bad, 'durationMin'), /durationMin/, `input: ${String(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// buildNewJob
// ---------------------------------------------------------------------------

test('buildNewJob: happy path applies defaults and coerces scheduledAt', () => {
  const doc = j.buildNewJob({
    accountId: 'acct1',
    createdBy: 'uid_123',
    customerName: 'Maria Delgado',
    service: 'HVAC tune-up',
    scheduledAt: '2026-07-10T13:00:00Z',
  });
  assert.equal(doc.accountId, 'acct1');
  assert.equal(doc.customerName, 'Maria Delgado');
  assert.equal(doc.status, j.JOB_STATUS.SCHEDULED); // default
  assert.equal(doc.source, j.JOB_SOURCE.MANUAL_ENTRY); // default
  assert.equal(doc.customerId, null); // nullable link, not supplied
  assert.equal(doc.customerPhone, null);
  assert.equal(doc.serviceAddress, null);
  assert.ok('createdAt' in doc && 'updatedAt' in doc);
  assert.equal(doc.scheduledAt.toDate().toISOString(), '2026-07-10T13:00:00.000Z');
});

test('buildNewJob: accepts a customerId link alongside the denormalized snapshot', () => {
  const doc = j.buildNewJob({
    accountId: 'acct1',
    createdBy: 'uid_123',
    customerId: '12145550123',
    customerName: 'Maria Delgado',
    customerPhone: '(214) 555-0123',
    service: 'HVAC tune-up',
    scheduledAt: Date.now(),
  });
  assert.equal(doc.customerId, '12145550123');
  assert.equal(doc.customerPhone, '+12145550123'); // normalized, matches customers.js rules
});

test('buildNewJob: serviceAddress uses the shared customers.js address shape', () => {
  const doc = j.buildNewJob({
    accountId: 'acct1',
    createdBy: 'uid_123',
    customerName: 'Maria Delgado',
    service: 'HVAC tune-up',
    scheduledAt: Date.now(),
    serviceAddress: { line1: '100 Main St', city: 'Keller' },
  });
  assert.deepEqual(doc.serviceAddress, {
    line1: '100 Main St',
    line2: null,
    city: 'Keller',
    state: null,
    postalCode: null,
  });
});

test('buildNewJob: throws on missing required fields', () => {
  const base = {
    accountId: 'a',
    createdBy: 'u',
    customerName: 'Someone',
    service: 'Repair',
    scheduledAt: Date.now(),
  };
  assert.throws(() => j.buildNewJob({ ...base, accountId: undefined }), /accountId/);
  assert.throws(() => j.buildNewJob({ ...base, createdBy: undefined }), /createdBy/);
  assert.throws(() => j.buildNewJob({ ...base, customerName: undefined }), /customerName/);
  assert.throws(() => j.buildNewJob({ ...base, service: undefined }), /service/);
  assert.throws(() => j.buildNewJob({ ...base, scheduledAt: undefined }), /scheduledAt/);
});

test('buildNewJob: throws on invalid status or source enum', () => {
  const base = {
    accountId: 'a',
    createdBy: 'u',
    customerName: 'Someone',
    service: 'Repair',
    scheduledAt: Date.now(),
  };
  assert.throws(() => j.buildNewJob({ ...base, status: 'en route' }), /invalid status/); // old Supabase value must NOT pass
  assert.throws(() => j.buildNewJob({ ...base, source: 'carrier_pigeon' }), /invalid source/);
});

test('buildNewJob: rejects an unnormalizable customerPhone rather than storing raw', () => {
  const base = {
    accountId: 'a',
    createdBy: 'u',
    customerName: 'Someone',
    service: 'Repair',
    scheduledAt: Date.now(),
  };
  assert.throws(() => j.buildNewJob({ ...base, customerPhone: '123' }), /customerPhone/);
});

// ---------------------------------------------------------------------------
// buildJobUpdate
// ---------------------------------------------------------------------------

test('buildJobUpdate: always stamps updatedAt', () => {
  const out = j.buildJobUpdate({});
  assert.ok('updatedAt' in out);
  assert.equal(Object.keys(out).length, 1);
});

test('buildJobUpdate: passes whitelisted fields, ignores identity fields', () => {
  const out = j.buildJobUpdate({
    status: j.JOB_STATUS.EN_ROUTE,
    notes: 'running 10 min late',
    accountId: 'other', // must be ignored (identity, immutable)
    createdBy: 'someone', // must be ignored
    createdAt: 'whatever', // must be ignored
  });
  assert.equal(out.status, 'en_route');
  assert.equal(out.notes, 'running 10 min late');
  assert.ok(!('accountId' in out));
  assert.ok(!('createdBy' in out));
  assert.ok(!('createdAt' in out));
});

test('buildJobUpdate: validates status/source when present', () => {
  assert.throws(() => j.buildJobUpdate({ status: 'in progress' }), /invalid status/); // space, old value
  assert.throws(() => j.buildJobUpdate({ source: 'nope' }), /invalid source/);
  assert.doesNotThrow(() => j.buildJobUpdate({ status: j.JOB_STATUS.IN_PROGRESS }));
});

test('buildJobUpdate: coerces scheduledAt when present', () => {
  const out = j.buildJobUpdate({ scheduledAt: '2026-07-11T09:00:00Z' });
  assert.equal(out.scheduledAt.toDate().toISOString(), '2026-07-11T09:00:00.000Z');
});

test('buildJobUpdate: re-validates customerName/service when present (non-empty)', () => {
  assert.throws(() => j.buildJobUpdate({ customerName: '' }), /customerName/);
  assert.throws(() => j.buildJobUpdate({ service: '' }), /service/);
  assert.doesNotThrow(() => j.buildJobUpdate({ customerName: 'New Name' }));
});

// ---------------------------------------------------------------------------
// path builders
// ---------------------------------------------------------------------------

test('path builders: produce canonical multi-tenant paths', () => {
  assert.equal(j.jobsCollectionPath('A'), 'accounts/A/jobs');
  assert.equal(j.jobDocPath('A', 'job1'), 'accounts/A/jobs/job1');
});

test('path builders: reject empty ids', () => {
  assert.throws(() => j.jobsCollectionPath(''), /accountId/);
  assert.throws(() => j.jobDocPath('A', ''), /jobId/);
});
