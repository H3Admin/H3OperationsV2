import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { assertOperator } from "./permissions.js";
import { writeOperatorAudit } from "./auditLog.js";

/**
 * callables — Operator Dashboard callables (Phase 1, Stage B).
 *
 * All callables below are operator-only (assertOperator, §8 S2/S3) and
 * cross-tenant by design — the entire point of the Operator Dashboard is
 * H3-staff visibility across accounts, which is why these live outside the
 * accounts/{accountId} isolation model that every tenant-facing callable
 * (createCustomer, updateCustomer, ...) respects.
 *
 * SECURITY: account documents today carry NO fields of their own — they are
 * created via `accounts.add({})` (see onUserCreate) and never written to
 * thereafter. There is no businessName/name/status/createdAt to read. Rather
 * than inventing fields that don't exist, operatorListAccounts/
 * operatorGetAccount return only what is real: the accountId (the doc ID)
 * and a memberCount derived from the members subcollection. Do NOT expand
 * this to customer/call/PII data without a fresh minimum-necessary review.
 */

// Mirrors index.ts's module-private VALID_ROLES (functions/src/index.ts) —
// not exported there, so duplicated here rather than reached into. Keep in
// sync: onUserCreate's invite branch rejects any role outside this set.
const VALID_ROLES = ["owner", "admin", "member"];

export interface OperatorAccountSummary {
  accountId: string;
  memberCount: number;
}

async function summarizeAccount(
  accountDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot,
): Promise<OperatorAccountSummary> {
  const membersSnap = await accountDoc.ref.collection("members").count().get();
  return {
    accountId: accountDoc.id,
    memberCount: membersSnap.data().count,
  };
}

/**
 * operatorListAccounts — lists every account with a minimum-necessary summary.
 *
 * No customer/call/PII data is returned — see module header. Writes one
 * audit entry per call (targetAccountId "*" since the action spans every
 * tenant, not one).
 */
export const operatorListAccounts = functions.https.onCall(async (_data, context) => {
  const { uid, roles } = assertOperator(context);
  const db = admin.firestore();

  const accountsSnap = await db.collection("accounts").get();
  const accounts = await Promise.all(accountsSnap.docs.map(summarizeAccount));

  await writeOperatorAudit(db, {
    actorUid: uid,
    roles,
    action: "list_accounts",
    targetAccountId: "*",
  });

  return { accounts };
});

/**
 * operatorGetAccount — minimum-necessary summary for a single account.
 *
 * Requires data.accountId. Account-level fields only for now (see module
 * header) — no nested customer/call PII dumps.
 */
export const operatorGetAccount = functions.https.onCall(async (data, context) => {
  const { uid, roles } = assertOperator(context);
  const db = admin.firestore();

  const accountId = (data?.accountId ?? "") as string;
  if (!accountId) {
    throw new functions.https.HttpsError("invalid-argument", "accountId is required.");
  }

  const accountRef = db.collection("accounts").doc(accountId);
  const accountDoc = await accountRef.get();
  if (!accountDoc.exists) {
    throw new functions.https.HttpsError("not-found", "No account with that id.");
  }

  const summary = await summarizeAccount(accountDoc);

  await writeOperatorAudit(db, {
    actorUid: uid,
    roles,
    action: "get_account",
    targetAccountId: accountId,
  });

  return { account: summary };
});

/**
 * operatorCreateInvite — concierge on-ramp: creates a fresh account and a
 * pending invite for a subscriber's first login, so onUserCreate's invite
 * branch (functions/src/index.ts) attaches them to THIS account/role rather
 * than minting a second new one via its no-invite fallback.
 *
 * Same empty-doc shape onUserCreate's self-serve path already uses
 * (`accounts.add({})`) — no fields invented here either (see module header).
 * email is lowercased ONLY (no trim/other transform) to match onUserCreate's
 * `normalizedEmail = email.toLowerCase()` exactly, since onUserCreate's
 * lookup is an equality match against this stored value (§8 S2).
 */
export const operatorCreateInvite = functions.https.onCall(async (data, context) => {
  const { uid, roles } = assertOperator(context);
  const db = admin.firestore();

  const rawEmail = (data?.email ?? "") as string;
  if (!rawEmail) {
    throw new functions.https.HttpsError("invalid-argument", "email is required.");
  }
  const email = rawEmail.toLowerCase();

  const role = (data?.role ?? "owner") as string;
  if (!VALID_ROLES.includes(role)) {
    throw new functions.https.HttpsError("invalid-argument", `role must be one of ${VALID_ROLES.join(", ")}.`);
  }

  const accountRef = await db.collection("accounts").add({});
  const accountId = accountRef.id;

  const inviteRef = db.collection("invites").doc();
  await inviteRef.set({
    email,
    accountId,
    role,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  await writeOperatorAudit(db, {
    actorUid: uid,
    roles,
    action: "create_invite",
    targetAccountId: accountId,
    targetRef: inviteRef.id,
  });

  return { accountId, inviteId: inviteRef.id };
});
