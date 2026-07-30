import * as functions from "firebase-functions/v1";

/**
 * permissions — Operator Dashboard authorization helpers.
 *
 * Operator status is carried in the custom-claims `roles` array (distinct
 * from the per-account `role` claim used by createCustomer/updateCustomer
 * etc.) — an operator is an H3 staff member, not an account member, so it
 * rides its own claim rather than overloading the tenant role.
 */

export interface OperatorClaims {
  roles?: string[];
  [key: string]: unknown;
}

export interface OperatorPermissions {
  isOperator: boolean;
  roles: string[];
}

/**
 * resolveOperatorPermissions — pure resolver over a decoded ID-token's claims.
 *
 * @param claims  the token claims object (context.auth.token); roles may be
 *                absent on any user who has never been granted operator access.
 */
export function resolveOperatorPermissions(claims: OperatorClaims | undefined | null): OperatorPermissions {
  const roles = Array.isArray(claims?.roles) ? (claims!.roles as string[]) : [];
  return {
    isOperator: roles.includes("operator"),
    roles,
  };
}

/**
 * assertOperator — auth guard for operator-only callables.
 *
 * Mirrors the existing callable pattern (createCustomer, updateCustomer):
 * uid off context.auth, HttpsError on failure. Throws "unauthenticated" if
 * there's no signed-in user, "permission-denied" if the signed-in user is not
 * an operator.
 */
export function assertOperator(context: functions.https.CallableContext): { uid: string; roles: string[] } {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }

  const { isOperator, roles } = resolveOperatorPermissions(context.auth?.token as OperatorClaims | undefined);
  if (!isOperator) {
    throw new functions.https.HttpsError("permission-denied", "Operator access required.");
  }

  return { uid, roles };
}
