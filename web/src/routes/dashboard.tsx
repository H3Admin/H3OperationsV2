import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-hooks";
import { useCalls } from "@/hooks/useCalls";
import { useLastSeen } from "@/hooks/useLastSeen";
import {
  resolveEnabledFeatures,
  type AccountContext,
} from "@/lib/features/resolve";
import { DashboardContext } from "@/lib/dashboard-context";
import type { DateRange } from "@/lib/calls-format";
import { Badge } from "@/components/ui/badge";

/**
 * /dashboard — Subscriber Dashboard layout route.
 *
 * Owns what every child route needs so none of them re-derive it:
 *   1. auth — redirect to /login if not signed in.
 *   2. feature gate (§5.3C) — resolve the account's enabled feature set from
 *      its auth claims and require `subscriber_dashboard`; redirect home if
 *      absent. The ONE consumer of resolveEnabledFeatures in this slice (no
 *      top-level nav bar yet — that arrives with the authed-shell slice).
 *   3. the single useCalls() listener — Calls, Leads, and the detail view all
 *      read the same in-memory list via DashboardContext rather than each
 *      opening their own onSnapshot.
 *   4. the date-range filter state, applied by each list view.
 *   5. useLastSeen() — the "new since you last checked" badge counts, and the
 *      debounced touch() that marks the dashboard as seen.
 *
 * Renders the Calls|Leads segmented nav (with new-item count badges) and the
 * date-range inputs, then an Outlet for the active child. Reachable by URL
 * only for now.
 */

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DashboardLayout,
});

const TAB_BASE =
  "flex-1 rounded-full px-4 py-2 text-center text-sm font-semibold transition-colors";
const TAB_ACTIVE = `${TAB_BASE} bg-accent text-accent-foreground`;
const TAB_INACTIVE = `${TAB_BASE} text-muted-foreground`;

function DashboardLayout() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { calls, loading, error } = useCalls();
  const { lastSeenAt, touch } = useLastSeen();
  const [dateRange, setDateRange] = useState<DateRange>({ start: "", end: "" });

  // Feature gate: null = still checking, true = enabled, false = denied.
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);

  // Auth guard — mirrors customers.index.tsx.
  useEffect(() => {
    if (!authLoading && !user) nav({ to: "/login" });
  }, [authLoading, user, nav]);

  // Feature gate (§5.3C): build an AccountContext from the auth claims and
  // require subscriber_dashboard in the resolved set. No plan/industry/account
  // overrides are plumbed yet (§5.3A/D), so this resolves on the registry default.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdTokenResult();
        const ctx: AccountContext = {
          accountId: (token.claims.accountId as string) ?? "",
          role: token.claims.role as string | undefined,
        };
        const enabled = resolveEnabledFeatures(ctx).has("subscriber_dashboard");
        if (!cancelled) setFeatureEnabled(enabled);
      } catch {
        // Fail closed: if claims can't be read, treat the feature as off.
        if (!cancelled) setFeatureEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Denied → send home. A redirect (not a hard 404) since the flag can flip on
  // for this account later.
  useEffect(() => {
    if (featureEnabled === false) nav({ to: "/" });
  }, [featureEnabled, nav]);

  // Mark the dashboard as seen once it's actually showing (past the auth/
  // feature-gate checks below), not on every mount attempt. touch() itself is
  // debounced, so this firing on calls/lastSeenAt updates doesn't spam writes.
  useEffect(() => {
    if (authLoading || !user || featureEnabled !== true) return;
    touch();
  }, [authLoading, user, featureEnabled, touch]);

  // If lastSeenAt is missing (first ever visit), show no badge — don't flag
  // every historical call/lead as "new".
  const { newCallsCount, newLeadsCount } = useMemo(() => {
    if (!lastSeenAt) return { newCallsCount: 0, newLeadsCount: 0 };
    const isNew = (call: (typeof calls)[number]) => {
      const startedAt = call.startedAt?.toDate();
      return !!startedAt && startedAt > lastSeenAt;
    };
    const newCalls = calls.filter(isNew);
    return {
      newCallsCount: newCalls.length,
      newLeadsCount: newCalls.filter((c) => c.isNewLead).length,
    };
  }, [calls, lastSeenAt]);

  if (authLoading || !user) return null;
  if (featureEnabled !== true) return null; // checking or denied → render nothing

  return (
    <DashboardContext.Provider
      value={{ calls, loading, error, dateRange, setDateRange, newCallsCount, newLeadsCount }}
    >
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center gap-1 rounded-full border border-input bg-muted/50 p-1">
          <Link
            to="/dashboard/calls"
            className={TAB_INACTIVE}
            activeProps={{ className: TAB_ACTIVE }}
            inactiveProps={{ className: TAB_INACTIVE }}
          >
            <span className="inline-flex items-center gap-1.5">
              Calls
              {newCallsCount > 0 && (
                // The one coral spark, restrained per the style guide: a small
                // count badge, not a color wash across the tab.
                <Badge className="border-transparent bg-coral px-1.5 py-0 text-[11px] leading-4 text-white">
                  {newCallsCount}
                </Badge>
              )}
            </span>
          </Link>
          <Link
            to="/dashboard/leads"
            className={TAB_INACTIVE}
            activeProps={{ className: TAB_ACTIVE }}
            inactiveProps={{ className: TAB_INACTIVE }}
          >
            <span className="inline-flex items-center gap-1.5">
              Leads
              {newLeadsCount > 0 && (
                <Badge className="border-transparent bg-coral px-1.5 py-0 text-[11px] leading-4 text-white">
                  {newLeadsCount}
                </Badge>
              )}
            </span>
          </Link>
        </div>

        <div className="mt-4 flex items-end gap-3">
          <label className="flex-1 text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">From</span>
            <input
              type="date"
              value={dateRange.start}
              max={dateRange.end || undefined}
              onChange={(e) =>
                setDateRange((r) => ({ ...r, start: e.target.value }))
              }
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex-1 text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">To</span>
            <input
              type="date"
              value={dateRange.end}
              min={dateRange.start || undefined}
              onChange={(e) =>
                setDateRange((r) => ({ ...r, end: e.target.value }))
              }
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          {(dateRange.start || dateRange.end) && (
            <button
              type="button"
              onClick={() => setDateRange({ start: "", end: "" })}
              className="pb-1.5 text-xs font-medium text-accent"
            >
              Clear
            </button>
          )}
        </div>

        <div className="mt-6">
          <Outlet />
        </div>
      </div>
    </DashboardContext.Provider>
  );
}
