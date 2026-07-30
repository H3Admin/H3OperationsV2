import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/integrations/firebase/client";

/**
 * /operator/accounts/$accountId — Account detail.
 *
 * Calls the deployed operatorGetAccount callable with accountId — no direct
 * Firestore read. Renders exactly what the callable returns (accountId,
 * memberCount); see the honesty note in operator.accounts.tsx.
 */
export const Route = createFileRoute("/operator/accounts/$accountId")({
  head: () => ({
    meta: [
      { title: "Account — Operator — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: OperatorAccountDetailPage,
});

interface OperatorAccountSummary {
  accountId: string;
  memberCount: number;
}

const operatorGetAccount = httpsCallable<
  { accountId: string },
  { account: OperatorAccountSummary }
>(functions, "operatorGetAccount");

function OperatorAccountDetailPage() {
  const { accountId } = Route.useParams();
  const [account, setAccount] = useState<OperatorAccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAccount(null);
    operatorGetAccount({ accountId })
      .then((result) => {
        if (!cancelled) setAccount(result.data.account);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Something went wrong. Please try again.";
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return (
    <div>
      <Link to="/operator/accounts" className="text-sm font-medium text-accent">
        ← Back to accounts
      </Link>

      {loading && (
        <p className="mt-8 text-sm text-muted-foreground">Loading account…</p>
      )}

      {error && !loading && (
        <p className="mt-8 text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && account && (
        <div className="mt-8 overflow-hidden rounded-lg border border-input">
          <dl className="divide-y divide-input text-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="font-medium text-muted-foreground">Account ID</dt>
              <dd className="font-mono">{account.accountId}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="font-medium text-muted-foreground">Members</dt>
              <dd className="tabular-nums">{account.memberCount}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
