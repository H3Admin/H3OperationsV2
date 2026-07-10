/**
 * jobs.rules.check.js — Firestore Rules unit tests for accounts/{accountId}/jobs/{jobId}
 *
 * Deliberately NOT named *.test.js: this repo has two other test runners
 * (functions/ bare `node --test`, root `vitest run` with unscoped defaults)
 * that would otherwise auto-discover and try to run this — and fail, since
 * it requires the Firebase Emulator Suite, not a plain node/vitest run.
 * Always invoke explicitly:
 *   firebase emulators:exec --only firestore "node --test firestore-tests/jobs.rules.check.js"
 *
 * Verified against live firestore.rules (2026-07-10):
 *   - isAccountMember(accountId) reads request.auth.token.accountId
 *   - jobs rule: allow read: if isAccountMember(accountId); allow write: if false;
 * Verified against live functions/src/schema/jobs.js: JOB_STATUS.EN_ROUTE = 'en_route'.
 */

const { describe, it, before, after } = require('node:test');
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = 'h3operations-rules-test';
const RULES_PATH = path.resolve(__dirname, '../firestore.rules');

const TENANT_A = 'accountA111';
const TENANT_B = 'accountB222';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

function memberContext(accountId, role = 'owner') {
  return testEnv.authenticatedContext(`user-${accountId}`, { accountId, role });
}

async function seedJob(accountId, jobId, data) {
  await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
    await adminCtx
      .firestore()
      .doc(`accounts/${accountId}/jobs/${jobId}`)
      .set(data);
  });
}

describe('jobs Firestore rules — tenant isolation', () => {
  it('allows a member to read a job in their own account', async () => {
    await seedJob(TENANT_A, 'job1', { status: 'scheduled', customerId: null });
    const db = memberContext(TENANT_A).firestore();
    await assertSucceeds(db.doc(`accounts/${TENANT_A}/jobs/job1`).get());
  });

  it('denies a member of tenant B reading tenant A jobs', async () => {
    await seedJob(TENANT_A, 'job1', { status: 'scheduled', customerId: null });
    const db = memberContext(TENANT_B).firestore();
    await assertFails(db.doc(`accounts/${TENANT_A}/jobs/job1`).get());
  });

  it('denies an unauthenticated read', async () => {
    await seedJob(TENANT_A, 'job1', { status: 'scheduled', customerId: null });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.doc(`accounts/${TENANT_A}/jobs/job1`).get());
  });
});

describe('jobs Firestore rules — server-only write (write: if false)', () => {
  it('denies a client-side create, even from a member of the same account', async () => {
    const db = memberContext(TENANT_A).firestore();
    await assertFails(
      db.doc(`accounts/${TENANT_A}/jobs/job2`).set({ status: 'scheduled' })
    );
  });

  it('denies a client-side update to an existing job', async () => {
    await seedJob(TENANT_A, 'job1', { status: 'scheduled', customerId: null });
    const db = memberContext(TENANT_A).firestore();
    await assertFails(
      db.doc(`accounts/${TENANT_A}/jobs/job1`).update({ status: 'en_route' })
    );
  });

  it('denies a client-side delete', async () => {
    await seedJob(TENANT_A, 'job1', { status: 'scheduled', customerId: null });
    const db = memberContext(TENANT_A).firestore();
    await assertFails(db.doc(`accounts/${TENANT_A}/jobs/job1`).delete());
  });
});
