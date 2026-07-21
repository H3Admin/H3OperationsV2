/**
 * useCalls — live-updating list of the current account's calls.
 *
 * Mirrors useCustomers exactly: reads accountId from the Firebase Auth ID token
 * custom claim (getIdTokenResult — NOT a Firestore membership lookup) and opens
 * an onSnapshot listener so calls appear/update without a refresh. Read-only —
 * no writes (the service + handleCallStatus own all call-doc writes).
 *
 * Orders by startedAt DESC — the call-doc start Timestamp (see calls-schema.ts).
 */

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/lib/auth-hooks";
import { callsCollectionPath, type Call } from "@/lib/calls-schema";

interface UseCallsResult {
  calls: Call[];
  loading: boolean;
  error: string | null;
  accountId: string | null;
}

export function useCalls(): UseCallsResult {
  const { user } = useAuth();
  const [calls, setCalls] = useState<Call[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setCalls([]);
      setAccountId(null);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // accountId lives in the ID token custom claim, not on the user object.
        const token = await user.getIdTokenResult();
        const claimAccountId = token.claims.accountId as string | undefined;

        if (!claimAccountId) {
          if (!cancelled) {
            setError("No account is associated with this user.");
            setLoading(false);
          }
          return;
        }
        if (cancelled) return;
        setAccountId(claimAccountId);

        const colRef = collection(db, callsCollectionPath(claimAccountId));
        // startedAt DESC: most recent call first. Its automatic single-field index
        // is intact (the calls fieldOverride is on callSid only), so no composite
        // index is required.
        const q = query(colRef, orderBy("startedAt", "desc"));

        unsubscribe = onSnapshot(
          q,
          (snap) => {
            const rows = snap.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as Call,
            );
            setCalls(rows);
            setLoading(false);
          },
          (err) => {
            setError(err.message);
            setLoading(false);
          },
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load calls.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [user]);

  return { calls, loading, error, accountId };
}
