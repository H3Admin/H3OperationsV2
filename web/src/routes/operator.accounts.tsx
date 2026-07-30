import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/integrations/firebase/client";

/**
 * /operator/accounts — Accounts list.
 *
 * Calls the deployed operatorListAccounts callable directly — no Firestore
 * reads from the client (functions/src/operator/callables.ts is the only
 * read path, and it already enforces assertOperator + writes the audit
 * entry). Renders exactly what the callable returns: accountId and
 * memberCount. The callable does not (yet) return businessName, status, or
 * createdAt because the account doc itself carries no such fields today
 * (see the SECURITY note in callables.ts) — so this table doesn't scaffold
 * columns for data that doesn't exist.
 */
export const Route = createFileRoute("/operator/accounts")({
  head: () => ({
    meta: [
      { title: "Accounts — Operator — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: OperatorAccountsPage,
});

interface OperatorAccountSummary {
  accountId: string;
  memberCount: number;
}

const operatorListAccounts = httpsCallable<
  Record<string, never>,
  { accounts: OperatorAccountSummary[] }
>(functions, "operatorListAccounts");

function OperatorAccountsPage() {
  const [accounts, setAccounts] = useState<OperatorAccountSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    operatorListAccounts({})
      .then((result) => {
        if (!cancelled) setAccounts(result.data.accounts);
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
  }, []);

  return (
    <div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Accounts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every tenant account, across all industries.
        </p>
      </div>

      {loading && (
        <p className="mt-10 text-sm text-muted-foreground">Loading accounts…</p>
      )}

      {error && !loading && (
        <p className="mt-10 text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && accounts && accounts.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-input py-16 text-center">
          <p className="text-sm text-muted-foreground">No accounts yet.</p>
        </div>
      )}

      {!loading && !error && accounts && accounts.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-lg border border-input">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Account ID</th>
                <th className="px-4 py-3 font-medium">Members</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.accountId} className="border-t border-input">
                  <td className="px-4 py-3">
                    <Link
                      to="/operator/accounts/$accountId"
                      params={{ accountId: a.accountId }}
                      className="font-medium text-accent hover:underline"
                    >
                      {a.accountId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{a.memberCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
