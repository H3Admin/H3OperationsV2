import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-hooks";
import { useCalls } from "@/hooks/useCalls";
import {
  CALL_STATUS,
  CALL_STATUS_LABELS,
  type Call,
  type CallStatus,
} from "@/lib/calls-schema";
import {
  resolveEnabledFeatures,
  type AccountContext,
} from "@/lib/features/resolve";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * /dashboard — Subscriber Dashboard, slice 1: the account's live calls list.
 *
 * Read-only, mobile-first (operators are in the field). Two gates, both mirroring
 * the customers.index.tsx pattern:
 *   1. auth — redirect to /login if not signed in.
 *   2. feature (§5.3C) — resolve the account's enabled feature set from its auth
 *      claims and require `subscriber_dashboard`; redirect home if absent. This
 *      route is the ONE consumer of resolveEnabledFeatures this slice (no nav bar
 *      yet — visible nav + nav.ts arrive with the authed-shell slice).
 *
 * Reachable by URL only for now.
 */

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DashboardPage,
});

// Format a full E.164 caller number for display; falls back to the raw value for
// anything that isn't a NANP +1 number.
function formatCaller(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 || "—";
}

// Firestore Timestamp → local date + time string.
function formatStartedAt(ts: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

// Integer seconds → compact "m s" (or "s" under a minute).
function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Map call status → Badge variant. Terminal-negative outcomes read as
// destructive; everything else stays neutral (secondary). Operator Blue accents
// come from the tokens, not hardcoded hex.
function statusVariant(status: CallStatus): "secondary" | "destructive" {
  const negative: CallStatus[] = [
    CALL_STATUS.NO_ANSWER,
    CALL_STATUS.BUSY,
    CALL_STATUS.FAILED,
    CALL_STATUS.CANCELLED,
  ];
  return negative.includes(status) ? "destructive" : "secondary";
}

function CallCard({ call }: { call: Call }) {
  return (
    <Card className="shadow-soft">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold tabular-nums text-foreground">
              {formatCaller(call.from)}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {formatStartedAt(call.startedAt)}
            </p>
          </div>
          {call.isNewLead && (
            // Subtle new-lead marker in the accent (Operator Blue).
            <Badge className="shrink-0 border-transparent bg-accent text-accent-foreground">
              New lead
            </Badge>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Badge variant={statusVariant(call.status)}>
            {CALL_STATUS_LABELS[call.status] ?? call.status}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {formatDuration(call.durationSeconds)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { calls, loading, error } = useCalls();

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

  if (authLoading || !user) return null;
  if (featureEnabled !== true) return null; // checking or denied → render nothing

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Calls
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every call to your line, most recent first.
        </p>
      </div>

      {loading && (
        <p className="mt-8 text-sm text-muted-foreground">Loading calls…</p>
      )}

      {error && !loading && (
        <p className="mt-8 text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && calls.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-input py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No calls yet. Calls answered by your phone agent will appear here.
          </p>
        </div>
      )}

      {!loading && !error && calls.length > 0 && (
        <div className="mt-6 flex flex-col gap-3">
          {calls.map((call) => (
            <CallCard key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}
