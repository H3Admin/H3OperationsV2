import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-hooks";
import { useCustomers } from "@/hooks/useCustomers";
import { STATUS_LABELS, SOURCE_LABELS } from "@/lib/customers-schema";

export const Route = createFileRoute("/customers/")({
  head: () => ({
    meta: [
      { title: "Customers — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: CustomersPage,
});

function formatDate(ts: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleDateString();
  } catch {
    return "—";
  }
}

function CustomersPage() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { customers, loading, error } = useCustomers();

  // Guard: redirect to login if not authenticated (mirrors login.tsx pattern).
  useEffect(() => {
    if (!authLoading && !user) {
      nav({ to: "/login" });
    }
  }, [authLoading, user, nav]);

  if (authLoading || !user) return null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Leads and customers across your account.
          </p>
        </div>
      </div>

      {loading && (
        <p className="mt-10 text-sm text-muted-foreground">Loading customers…</p>
      )}

      {error && !loading && (
        <p className="mt-10 text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && customers.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-input py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No customers yet. Leads captured by the phone agent will appear here.
          </p>
        </div>
      )}

      {!loading && !error && customers.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-lg border border-input">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-input">
                  <td className="px-4 py-3">{c.displayName || "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{c.phone}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {c.source ? (SOURCE_LABELS[c.source] ?? c.source) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(c.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
