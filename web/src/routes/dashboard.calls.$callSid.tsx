import { createFileRoute, Link } from "@tanstack/react-router";
import { useDashboardContext } from "@/lib/dashboard-context";
import { CALL_STATUS_LABELS } from "@/lib/calls-schema";
import {
  formatCaller,
  formatDuration,
  formatStartedAt,
  statusVariant,
} from "@/lib/calls-format";
import { Badge } from "@/components/ui/badge";

/**
 * /dashboard/calls/$callSid — call detail: caller info, status, timestamps,
 * duration, and the full transcript. Reused for both the Calls and Leads
 * tabs — a lead IS a call, same document, same detail view.
 *
 * No summary field: the call schema (functions/src/schema/calls.js) has no
 * `summary` — only `turns`. Rather than inventing one, this view shows the
 * transcript only. Same honesty-flag treatment as the deferred Messages tab.
 *
 * Reads from the DashboardContext list already loaded by the layout route —
 * no separate Firestore fetch for a single call.
 */
export const Route = createFileRoute("/dashboard/calls/$callSid")({
  head: () => ({
    meta: [
      { title: "Call detail — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: CallDetailPage,
});

function CallDetailPage() {
  const { callSid } = Route.useParams();
  const { calls, loading, error } = useDashboardContext();
  const call = calls.find((c) => c.callSid === callSid);

  return (
    <div>
      <Link to="/dashboard/calls" className="text-sm font-medium text-accent">
        ← Back to calls
      </Link>

      {loading && (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      )}

      {error && !loading && (
        <p className="mt-8 text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && !call && (
        <p className="mt-8 text-sm text-muted-foreground">
          Call not found.
        </p>
      )}

      {call && (
        <>
          <div className="mt-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {formatCaller(call.from)}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatStartedAt(call.startedAt)}
              </p>
            </div>
            {call.isNewLead && (
              <Badge className="shrink-0 border-transparent bg-coral text-white">
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

          <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-input p-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Started
              </dt>
              <dd className="mt-0.5">{formatStartedAt(call.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Ended
              </dt>
              <dd className="mt-0.5">{formatStartedAt(call.endedAt)}</dd>
            </div>
          </dl>

          <div className="mt-8">
            <h2 className="text-lg font-semibold tracking-tight">
              Transcript
            </h2>
            {call.turns.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No transcript recorded for this call.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {call.turns.map((turn, i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    {turn.callerText && (
                      <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground">
                        {turn.callerText}
                      </div>
                    )}
                    {turn.aiText && (
                      <div className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-foreground">
                        {turn.aiText}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
