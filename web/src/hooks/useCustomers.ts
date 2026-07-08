/**
 * useCustomers — live-updating list of the current account's customers.
 *
 * Reads accountId from the Firebase Auth ID token custom claim (set server-side
 * by onUserCreate). Opens an onSnapshot listener so new leads written by the
 * Receptionist agent appear without a refresh.
 */

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/lib/auth-hooks";
import {
  customersCollectionPath,
  type Customer,
} from "@/lib/customers-schema";

interface UseCustomersResult {
  customers: Customer[];
  loading: boolean;
  error: string | null;
  accountId: string | null;
}

export function useCustomers(): UseCustomersResult {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setCustomers([]);
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

        const colRef = collection(db, customersCollectionPath(claimAccountId));
        const q = query(colRef, orderBy("createdAt", "desc"));

        unsubscribe = onSnapshot(
          q,
          (snap) => {
            const rows = snap.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as Customer,
            );
            setCustomers(rows);
            setLoading(false);
          },
          (err) => {
            setError(err.message);
            setLoading(false);
          },
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load customers.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [user]);

  return { customers, loading, error, accountId };
}
