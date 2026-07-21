/**
 * calls-rules.test.ts — Firestore Security Rules tests for accounts/{id}/calls
 * (§7.2: tenant-isolation Rules tests are a REQUIRED standard).
 *
 * Covers the write-posture tightening (calls: read-only for clients, server-only
 * writes) AND the tenant-isolation invariant the rule enforces:
 *   1. member of A CAN read accounts/A/calls/{id}
 *   2. member of A CANNOT read accounts/B/calls/{id}   (tenant isolation)
 *   3. authed client CANNOT create/update/delete a call doc   (the tightening)
 *
 * Reads the REAL firestore.rules via readFileSync — no rules copy to drift. Runs
 * against the Firestore emulator; invoke through `npm run test:rules` at the repo
 * root (which wraps this in `firebase emulators:exec`). Requires Node 20 (§10).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

// The real rules file lives at repo root, one level up from this test.
const RULES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../firestore.rules",
);

const PROJECT_ID = "h3ops-rules-test";
const ACCOUNT_A = "accountA";
const ACCOUNT_B = "accountB";
const CALL_A = "CA_aaaaaaaa";
const CALL_B = "CA_bbbbbbbb";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, "utf8"),
      // host/port come from FIRESTORE_EMULATOR_HOST, set by `firebase emulators:exec`.
    },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  // Fresh state each test. Seed the call docs with rules DISABLED — this is the
  // Admin-SDK-equivalent path the real writers (ConversationRelay + handleCallStatus)
  // use, which bypasses Rules. The client contexts below are then subject to Rules.
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, `accounts/${ACCOUNT_A}/calls/${CALL_A}`), {
      callSid: CALL_A,
      accountId: ACCOUNT_A,
      from: "+12145550123",
      status: "completed",
    });
    await setDoc(doc(admin, `accounts/${ACCOUNT_B}/calls/${CALL_B}`), {
      callSid: CALL_B,
      accountId: ACCOUNT_B,
      from: "+18005551212",
      status: "completed",
    });
  });
});

// A member of ACCOUNT_A: authenticated WITH the accountId custom claim the rule
// checks (request.auth.token.accountId == accountId). Claims are set server-side
// by onUserCreate in production; here we mint them directly.
function memberOfA() {
  return testEnv
    .authenticatedContext("userA", { accountId: ACCOUNT_A })
    .firestore();
}

describe("calls rule — tenant-scoped read (unchanged by the tightening)", () => {
  test("member of A CAN read accounts/A/calls/{id}", async () => {
    const db = memberOfA();
    await assertSucceeds(
      getDoc(doc(db, `accounts/${ACCOUNT_A}/calls/${CALL_A}`)),
    );
  });

  test("member of A CANNOT read accounts/B/calls/{id} (tenant isolation)", async () => {
    const db = memberOfA();
    await assertFails(
      getDoc(doc(db, `accounts/${ACCOUNT_B}/calls/${CALL_B}`)),
    );
  });
});

describe("calls rule — server-only writes (the tightening)", () => {
  test("authed client CANNOT create a call doc", async () => {
    const db = memberOfA();
    await assertFails(
      setDoc(doc(db, `accounts/${ACCOUNT_A}/calls/CA_newnewnew`), {
        callSid: "CA_newnewnew",
        accountId: ACCOUNT_A,
        from: "+12145550199",
        status: "in_progress",
      }),
    );
  });

  test("authed client CANNOT update a call doc", async () => {
    const db = memberOfA();
    await assertFails(
      updateDoc(doc(db, `accounts/${ACCOUNT_A}/calls/${CALL_A}`), {
        status: "failed",
      }),
    );
  });

  test("authed client CANNOT delete a call doc", async () => {
    const db = memberOfA();
    await assertFails(
      deleteDoc(doc(db, `accounts/${ACCOUNT_A}/calls/${CALL_A}`)),
    );
  });
});
