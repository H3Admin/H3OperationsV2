/**
 * phone-rate-limit-rules.test.ts — Firestore Security Rules tests for the
 * root-level spend-guard collections `phoneRateLimits` / `phoneUsage`
 * (§7.2: anything on the security path gets a test).
 *
 * These collections are NOT tenant-scoped (see phone-rate-limit.js DECISION —
 * a rate limit gates BEFORE we know or trust the caller's account). All
 * legitimate writes are Admin SDK from services/conversation-relay, which
 * bypasses Rules; a signed-in client of ANY tenant must get nothing here.
 *
 * Reads the REAL firestore.rules via readFileSync — no rules copy to drift. Runs
 * against the Firestore emulator; invoke through `npm run test:rules` at the
 * repo root (which wraps this in `firebase emulators:exec`). Requires Node 20
 * (§10).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
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
const RATE_LIMIT_BUCKET = "18175551234__d20260727";
const USAGE_DAY = "20260727";

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
  // Fresh state each test. Seed with rules DISABLED — this is the
  // Admin-SDK-equivalent path the real writer (services/conversation-relay)
  // uses, which bypasses Rules. The client context below is then subject to Rules.
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, `phoneRateLimits/${RATE_LIMIT_BUCKET}`), {
      caller: "18175551234",
      count: 3,
    });
    await setDoc(doc(admin, `phoneUsage/${USAGE_DAY}`), {
      count: 42,
    });
  });
});

// A member of ACCOUNT_A: authenticated WITH the accountId custom claim, same as
// any other legitimate signed-in client. These collections predate account
// resolution, so tenant membership must grant NOTHING here.
function memberOfA() {
  return testEnv
    .authenticatedContext("userA", { accountId: ACCOUNT_A })
    .firestore();
}

describe("phoneRateLimits — server-only, no tenant has access", () => {
  test("client cannot read a rate-limit bucket", async () => {
    const db = memberOfA();
    await assertFails(
      getDoc(doc(db, `phoneRateLimits/${RATE_LIMIT_BUCKET}`)),
    );
  });

  test("client cannot write a rate-limit bucket", async () => {
    const db = memberOfA();
    await assertFails(
      setDoc(doc(db, "phoneRateLimits/x"), { count: 0 }),
    );
  });
});

describe("phoneUsage — server-only, no tenant has access", () => {
  test("client cannot read the global daily counter", async () => {
    const db = memberOfA();
    await assertFails(getDoc(doc(db, `phoneUsage/${USAGE_DAY}`)));
  });

  test("client cannot write the global daily counter", async () => {
    const db = memberOfA();
    await assertFails(
      setDoc(doc(db, `phoneUsage/${USAGE_DAY}`), { count: 0 }),
    );
  });
});
