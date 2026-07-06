import { useEffect, useState } from "react";
import { useAuth } from "./auth-hooks";

// TODO(supabase-strip / firestore-rewrite): The original implementation queried
// Supabase (`account_members` + `accounts`, snake_case, role "admin" | "user").
// That schema does NOT match this repo's Firestore model:
//   accounts/{accountId}/members/{uid} { role: "owner" | "admin" | "member" }
//   and accountId/role are delivered via custom claims (user.getIdTokenResult()).
// This hook is intentionally left as a non-functional stub so no wrong data
// model leaks in. Reimplement against Firestore before any screen depends on it.
export type Membership = {
  id: string;
  accountId: string;
  uid: string;
  role: "owner" | "admin" | "member";
  account: { id: string; name: string };
};

export function useMyMembership() {
  const { user } = useAuth();
  const [data, setData] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // TODO(firestore-rewrite): read custom claims for accountId, then load
    // accounts/{accountId}/members/{user.uid} and accounts/{accountId}.
    setData(null);
    setLoading(false);
  }, [user]);

  return { membership: data, loading, isAdmin: data?.role === "admin" || data?.role === "owner" };
}
