import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/account/")({
  component: AccountIndexPage,
});

function AccountIndexPage() {
  const { user } = useAuth();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    user.getIdTokenResult().then((idTokenResult) => {
      setAccountId((idTokenResult.claims.accountId as string | undefined) ?? null);
      setRole((idTokenResult.claims.role as string | undefined) ?? null);
    });
  }, [user]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">Welcome back, {user?.displayName || user?.email}.</p>

      <div className="mt-8 rounded-md border border-input p-4 text-sm">
        <p>
          <span className="font-medium">Account:</span> {accountId ?? "Loading…"}
        </p>
        <p className="mt-1">
          <span className="font-medium">Role:</span> {role ?? "Loading…"}
        </p>
      </div>
    </div>
  );
}
