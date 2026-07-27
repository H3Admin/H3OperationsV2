/**
 * userstate-schema.ts — Front-end mirror of the READ-side of the per-user
 * dashboard state doc, accounts/{accountId}/userState/{uid}. There is no
 * server-side schema module for this doc (functions/src/schema/*) — it is
 * written directly by the client (see the userState Rules block in
 * firestore.rules, which restricts the write to the caller's own doc and to
 * the lastSeenAt field only), so this file is both the read and write shape.
 *
 * Two fields today: lastSeenAt and lastExportAt. See DECISION in
 * useLastSeen.ts for why each is a single shared timestamp rather than one
 * per tab.
 */

// Firestore path for a user's per-account dashboard state doc. Doc id is the
// Firebase Auth uid (§2.1: never an accountId).
export function userStatePath(accountId: string, uid: string): string {
  if (!accountId) throw new Error("accountId must be a non-empty string");
  if (!uid) throw new Error("uid must be a non-empty string");
  return `accounts/${accountId}/userState/${uid}`;
}

// Shape of the userState document as READ from Firestore. Timestamp typed
// loosely for the UI, matching calls-schema.ts / customers-schema.ts.
export interface UserState {
  lastSeenAt: { toDate: () => Date } | null;
  lastExportAt: { toDate: () => Date } | null;
}
