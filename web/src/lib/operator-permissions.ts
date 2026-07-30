import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-hooks";

/**
 * operator-permissions — client-side read of the `operator` custom claim
 * (functions/src/operator/permissions.ts is the server-side source of truth;
 * this mirrors the READ side only, per CODING_STANDARDS §2.2).
 *
 * This is UX, not security (CODING_STANDARDS §8 S2: "client validation is
 * UX, not security"). The real boundary is assertOperator() enforced inside
 * operatorListAccounts / operatorGetAccount — a non-operator who bypasses
 * this guard still gets permission-denied from the callables. This hook only
 * decides whether to show the /operator UI at all and redirect away early.
 */

/** True if the given ID-token claims carry the operator role. */
export function claimsHaveOperatorRole(claims: Record<string, unknown>): boolean {
  const roles = claims.roles;
  return Array.isArray(roles) && roles.includes("operator");
}

/** Reads the operator claim off a signed-in user's fresh ID-token result. */
export async function isOperator(user: User): Promise<boolean> {
  const token = await user.getIdTokenResult();
  return claimsHaveOperatorRole(token.claims as Record<string, unknown>);
}

/**
 * useIsOperator — resolves whether the current signed-in user carries the
 * operator claim. `null` while checking (no user yet, or the token read is
 * in flight); `true`/`false` once resolved. Fails closed: any error reading
 * claims resolves to `false`, mirroring the subscriber_dashboard feature
 * gate's fail-closed pattern in dashboard.tsx.
 */
export function useIsOperator(): boolean | null {
  const { user, loading: authLoading } = useAuth();
  const [operator, setOperator] = useState<boolean | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setOperator(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await isOperator(user);
        if (!cancelled) setOperator(result);
      } catch {
        if (!cancelled) setOperator(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  return operator;
}
