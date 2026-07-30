import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-hooks";
import { useIsOperator } from "@/lib/operator-permissions";

/**
 * /operator — Operator Dashboard layout route (Phase 1, Stage B/C).
 *
 * Guards:
 *   1. auth — redirect to /login if not signed in (mirrors dashboard.tsx).
 *   2. operator claim (useIsOperator) — a signed-in non-operator is
 *      redirected to /dashboard. This is UX only; the real boundary is
 *      assertOperator() inside the operatorListAccounts/operatorGetAccount
 *      callables (CODING_STANDARDS §8 S2 — client checks are never the
 *      security layer).
 *
 * Deliberately minimal chrome: an "Operator" header, nav to Accounts, an
 * Outlet. No feature-flag gate here — operator_dashboard (registry.ts) is
 * scope:"global" precisely because the operator claim + this route guard are
 * the real gate, not the flag (see registry.ts comment).
 */
export const Route = createFileRoute("/operator")({
  head: () => ({
    meta: [
      { title: "Operator — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: OperatorLayout,
});

function OperatorLayout() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const isOperator = useIsOperator();

  useEffect(() => {
    if (!authLoading && !user) nav({ to: "/login" });
  }, [authLoading, user, nav]);

  // Denied → send to the subscriber dashboard, not a hard 404: the claim can
  // be granted later without this becoming a dead link.
  useEffect(() => {
    if (isOperator === false) nav({ to: "/dashboard" });
  }, [isOperator, nav]);

  if (authLoading || !user) return null;
  if (isOperator !== true) return null; // checking or denied → render nothing

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Operator</h1>
        <nav className="flex items-center gap-1 rounded-full border border-input bg-muted/50 p-1">
          <Link
            to="/operator/accounts"
            className="flex-1 rounded-full px-4 py-2 text-center text-sm font-semibold text-muted-foreground transition-colors"
            activeProps={{ className: "flex-1 rounded-full px-4 py-2 text-center text-sm font-semibold bg-accent text-accent-foreground transition-colors" }}
            inactiveOptions={{ exact: false }}
          >
            Accounts
          </Link>
        </nav>
      </div>

      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
