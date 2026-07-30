/**
 * operator-audit-log-rules.test.ts — Firestore Security Rules tests for the
 * root-level, server-only `operatorAuditLog` collection (§7.2: anything on
 * the security path gets a test).
 *
 * This collection is NOT tenant-scoped (an operator action like
 * list_accounts can span every tenant at once — see the rule comment in
 * firestore.rules). All legitimate writes are Admin SDK from
 * writeOperatorAudit (functions/src/operator/auditLog.ts), which bypasses
 * Rules; a signed-in client — tenant member OR operator — must get nothing
 * here. This is a server-only audit log, not a dashboard data source.
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
const AUDIT_ENTRY_ID = "auditEntry1";

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
  // Admin-SDK-equivalent path the real writer (writeOperatorAudit) uses,
  // which bypasses Rules. The client context below is then subject to Rules.
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, `operatorAuditLog/${AUDIT_ENTRY_ID}`), {
      actorUid: "operatorUid1",
      roles: ["operator"],
      action: "list_accounts",
      targetAccountId: "*",
    });
  });
});

// A member of ACCOUNT_A: authenticated WITH the accountId custom claim, same
// as any other legitimate signed-in tenant client. Tenant membership must
// grant NOTHING here — this collection isn't tenant data.
function memberOfA() {
  return testEnv
    .authenticatedContext("userA", { accountId: ACCOUNT_A })
    .firestore();
}

// A signed-in user who is NOT an operator (no roles claim at all) — proves
// the deny-all applies even to a plausible-looking authenticated client, not
// just an anonymous one.
function nonOperator() {
  return testEnv.authenticatedContext("plainUser", {}).firestore();
}

describe("operatorAuditLog — server-only, no client has access", () => {
  test("an authed non-operator client cannot read an audit entry", async () => {
    const db = nonOperator();
    await assertFails(getDoc(doc(db, `operatorAuditLog/${AUDIT_ENTRY_ID}`)));
  });

  test("an authed non-operator client cannot write an audit entry", async () => {
    const db = nonOperator();
    await assertFails(
      setDoc(doc(db, "operatorAuditLog/forged"), {
        actorUid: "plainUser",
        roles: [],
        action: "list_accounts",
        targetAccountId: "*",
      }),
    );
  });

  test("an authed tenant member cannot read an audit entry", async () => {
    const db = memberOfA();
    await assertFails(getDoc(doc(db, `operatorAuditLog/${AUDIT_ENTRY_ID}`)));
  });

  test("an authed tenant member cannot write an audit entry", async () => {
    const db = memberOfA();
    await assertFails(
      setDoc(doc(db, "operatorAuditLog/forged"), {
        actorUid: "userA",
        roles: [],
        action: "list_accounts",
        targetAccountId: "*",
      }),
    );
  });
});
