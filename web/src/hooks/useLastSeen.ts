/**
 * useLastSeen — reads and updates the current user's dashboard
 * "last seen" timestamp, accounts/{accountId}/userState/{uid}.lastSeenAt.
 *
 * Mirrors useCalls/useCustomers: reads accountId from the Firebase Auth ID
 * token custom claim (getIdTokenResult — NOT a Firestore membership lookup)
 * and opens an onSnapshot listener. uid is the Firebase Auth uid.
 *
 * This is the one hook in the dashboard slice that also WRITES — see
 * firestore.rules' userState block (SECURITY) for the self-scoped,
 * field-restricted enforcement that makes that safe. touch() is the only
 * write path; it's debounced so viewing the dashboard doesn't write on every
 * render/snapshot.
 *
 * DECISION (2026-07): one shared lastSeenAt for the whole dashboard, not one
 * per tab (e.g. lastSeenAtCalls / lastSeenAtLeads). Leads is already a filtered
 * view of the same call data (see dashboard.leads.tsx), so a per-tab timestamp
 * would double-write on every dashboard visit for no behavioral difference
 * today. A single field is the smaller thing that works (§1 lean-first); if a
 * genuine need for independent tab freshness shows up later, this doc can grow
 * a second field (e.g. lastSeenAtLeads) without a migration — existing readers
 * of lastSeenAt are unaffected.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/lib/auth-hooks";
import { userStatePath } from "@/lib/userstate-schema";

const TOUCH_DEBOUNCE_MS = 3000;

interface UseLastSeenResult {
  lastSeenAt: Date | null;
  loading: boolean;
  // Marks "seen now" (serverTimestamp()), debounced. Safe to call on every
  // render of the dashboard shell.
  touch: () => void;
}

export function useLastSeen(): UseLastSeenResult {
  const { user } = useAuth();
  const [lastSeenAt, setLastSeenAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const accountIdRef = useRef<string | null>(null);
  const uidRef = useRef<string | null>(null);
  const debounceHandle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) {
      setLastSeenAt(null);
      setLoading(false);
      accountIdRef.current = null;
      uidRef.current = null;
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        // accountId lives in the ID token custom claim, not on the user object.
        const token = await user.getIdTokenResult();
        const claimAccountId = token.claims.accountId as string | undefined;

        if (!claimAccountId) {
          if (!cancelled) setLoading(false);
          return;
        }
        if (cancelled) return;
        accountIdRef.current = claimAccountId;
        uidRef.current = user.uid;

        const ref = doc(db, userStatePath(claimAccountId, user.uid));

        unsubscribe = onSnapshot(
          ref,
          (snap) => {
            const data = snap.data();
            setLastSeenAt(data?.lastSeenAt?.toDate() ?? null);
            setLoading(false);
          },
          () => {
            // Missing/denied reads just mean "no badge yet" — not surfaced as
            // a page-level error, since this is a secondary UX affordance.
            setLastSeenAt(null);
            setLoading(false);
          },
        );
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      if (debounceHandle.current) clearTimeout(debounceHandle.current);
    };
  }, [user]);

  const touch = useCallback(() => {
    if (debounceHandle.current) clearTimeout(debounceHandle.current);
    debounceHandle.current = setTimeout(() => {
      const accountId = accountIdRef.current;
      const uid = uidRef.current;
      if (!accountId || !uid) return;
      // setDoc (not updateDoc): the doc may not exist yet on a user's first
      // ever visit, and the field set is identical either way. Rules restrict
      // this write to exactly {lastSeenAt} regardless.
      void setDoc(doc(db, userStatePath(accountId, uid)), {
        lastSeenAt: serverTimestamp(),
      });
    }, TOUCH_DEBOUNCE_MS);
  }, []);

  return { lastSeenAt, loading, touch };
}
