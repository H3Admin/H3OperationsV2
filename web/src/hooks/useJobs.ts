/**
 * useJobs — live-updating list of the current account's jobs (dispatch board).
 *
 * Reads accountId from the Firebase Auth ID token custom claim (set server-side
 * by onUserCreate), exactly like useCustomers. Opens an onSnapshot listener so
 * jobs created/updated (by the dispatcher, or later by the Receptionist handoff)
 * appear on the board without a refresh.
 *
 * Ordered by scheduledAt ascending (soonest first) — a pure single-field order,
 * which uses Firestore's automatic single-field index. NO composite index is
 * required. If a server-side date-window filter is ever added alongside this
 * order, that combination WOULD need a composite index (add it that slice).
 *
 * Grouping into status columns is done by the board component, client-side.
 */

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/lib/auth-hooks";
import { jobsCollectionPath, type Job } from "@/lib/jobs-schema";

interface UseJobsResult {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  accountId: string | null;
}

export function useJobs(): UseJobsResult {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setJobs([]);
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

        const colRef = collection(db, jobsCollectionPath(claimAccountId));
        const q = query(colRef, orderBy("scheduledAt", "asc"));

        unsubscribe = onSnapshot(
          q,
          (snap) => {
            const rows = snap.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as Job,
            );
            setJobs(rows);
            setLoading(false);
          },
          (err) => {
            setError(err.message);
            setLoading(false);
          },
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load jobs.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [user]);

  return { jobs, loading, error, accountId };
}
