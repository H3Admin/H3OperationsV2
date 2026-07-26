/**
 * userstate-rules.test.ts — Firestore Security Rules tests for
 * accounts/{id}/userState/{uid} (§7.2: tenant-isolation Rules tests are a
 * REQUIRED standard).
 *
 * Unlike calls/customers/jobs, userState IS written directly by the client (no
 * Admin SDK path), so the Rules block itself is the only enforcement of:
 *   1. a user CAN read/write their OWN userState/{uid} doc
 *   2. a user CANNOT write another member's userState/{otherUid} doc, same account
 *   3. a user CANNOT read/write userState in a DIFFERENT account (tenant isolation)
 *   4. a write containing any field other than lastSeenAt is rejected
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
import { doc, getDoc, setDoc } from "firebase/firestore";

// The real rules file lives at repo root, one level up from this test.
const RULES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../firestore.rules",
);

const PROJECT_ID = "h3ops-rules-test";
const ACCOUNT_A = "accountA";
const ACCOUNT_B = "accountB";
const USER_A = "userA";
const USER_A2 = "userA2";

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
  // Fresh state each test. Seed with rules DISABLED so setup itself isn't
  // subject to the rule under test.
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, `accounts/${ACCOUNT_A}/userState/${USER_A}`), {
      lastSeenAt: new Date("2026-07-20T00:00:00Z"),
    });
    await setDoc(doc(admin, `accounts/${ACCOUNT_A}/userState/${USER_A2}`), {
      lastSeenAt: new Date("2026-07-20T00:00:00Z"),
    });
  });
});

// userA: a member of ACCOUNT_A, authenticated with the accountId custom claim
// the rule checks (request.auth.token.accountId == accountId). Claims are set
// server-side by onUserCreate in production; here we mint them directly.
function asUserA() {
  return testEnv
    .authenticatedContext(USER_A, { accountId: ACCOUNT_A })
    .firestore();
}

describe("userState rule — self-scoped read/write", () => {
  test("user CAN read their own userState/{uid} doc", async () => {
    const db = asUserA();
    await assertSucceeds(
      getDoc(doc(db, `accounts/${ACCOUNT_A}/userState/${USER_A}`)),
    );
  });

  test("user CAN write their own userState/{uid} doc", async () => {
    const db = asUserA();
    await assertSucceeds(
      setDoc(doc(db, `accounts/${ACCOUNT_A}/userState/${USER_A}`), {
        lastSeenAt: new Date(),
      }),
    );
  });

  test("user CANNOT write another user's userState/{otherUid} doc, same account", async () => {
    const db = asUserA();
    await assertFails(
      setDoc(doc(db, `accounts/${ACCOUNT_A}/userState/${USER_A2}`), {
        lastSeenAt: new Date(),
      }),
    );
  });

  test("user CANNOT read another user's userState/{otherUid} doc, same account", async () => {
    const db = asUserA();
    await assertFails(
      getDoc(doc(db, `accounts/${ACCOUNT_A}/userState/${USER_A2}`)),
    );
  });
});

describe("userState rule — tenant isolation", () => {
  test("user CANNOT read userState in a different account", async () => {
    const db = asUserA();
    await assertFails(
      getDoc(doc(db, `accounts/${ACCOUNT_B}/userState/${USER_A}`)),
    );
  });

  test("user CANNOT write userState in a different account", async () => {
    const db = asUserA();
    await assertFails(
      setDoc(doc(db, `accounts/${ACCOUNT_B}/userState/${USER_A}`), {
        lastSeenAt: new Date(),
      }),
    );
  });
});

describe("userState rule — field restriction", () => {
  test("write containing only lastSeenAt succeeds", async () => {
    const db = asUserA();
    await assertSucceeds(
      setDoc(doc(db, `accounts/${ACCOUNT_A}/userState/${USER_A}`), {
        lastSeenAt: new Date(),
      }),
    );
  });

  test("write containing a field other than lastSeenAt is rejected", async () => {
    const db = asUserA();
    await assertFails(
      setDoc(doc(db, `accounts/${ACCOUNT_A}/userState/${USER_A}`), {
        lastSeenAt: new Date(),
        role: "owner",
      }),
    );
  });
});
