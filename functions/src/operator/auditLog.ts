import * as admin from "firebase-admin";

/**
 * auditLog — append-only audit trail for Operator Dashboard access.
 *
 * Writes to the root-level `operatorAuditLog` collection (Admin SDK only;
 * firestore.rules denies all client read/write — see deny-all rule). Not
 * tenant-scoped: an operator action can span or precede knowledge of a
 * specific tenant (e.g. list_accounts touches every tenant at once), so this
 * mirrors the phoneRateLimits/phoneUsage root-level exception pattern (§2.1)
 * rather than living under accounts/{accountId}.
 *
 * COMPLIANCE: this log records that privileged access occurred, never the
 * data that was accessed. Per §9.2 ("no sensitive data in logs"), callers
 * must NEVER pass customer/account PII payloads into `action` or `targetRef`
 * — those fields are for identifiers and action names only.
 */

export interface WriteOperatorAuditInput {
  actorUid: string;
  roles: string[];
  action: string;
  targetAccountId: string;
  targetRef?: string;
}

/**
 * writeOperatorAudit — appends one entry to operatorAuditLog/{autoId}.
 *
 * @param db  Admin SDK Firestore instance (caller's, so this stays testable
 *            without a module-level singleton).
 */
export async function writeOperatorAudit(
  db: admin.firestore.Firestore,
  { actorUid, roles, action, targetAccountId, targetRef }: WriteOperatorAuditInput,
): Promise<void> {
  const entry: Record<string, unknown> = {
    actorUid,
    roles,
    action,
    targetAccountId,
    at: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (targetRef !== undefined) {
    entry.targetRef = targetRef;
  }

  await db.collection("operatorAuditLog").add(entry);
}
