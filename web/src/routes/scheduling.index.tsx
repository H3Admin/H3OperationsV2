import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "@/lib/auth-hooks";
import { functions } from "@/integrations/firebase/client";
import { useJobs } from "@/hooks/useJobs";
import {
  JOB_STATUS_LABELS,
  JOB_STATUS_ORDER,
  type Job,
  type JobStatus,
} from "@/lib/jobs-schema";

export const Route = createFileRoute("/scheduling/")({
  head: () => ({
    meta: [
      { title: "Scheduling — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: SchedulingPage,
});

// updateJob is the server-side write path (jobs are write:if false for clients).
// It validates the patch and stamps updatedAt; the board's onSnapshot then
// re-renders the moved card live. NOTE: the callable expects the mutable fields
// nested under `patch` (it runs buildJobUpdate on data.patch) — NOT flat.
const updateJob = httpsCallable<
  { jobId: string; patch: { status: JobStatus } },
  { jobId: string }
>(functions, "updateJob");

function formatWhen(ts: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatMoney(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function SchedulingPage() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { jobs, loading, error } = useJobs();

  // Tracks which job is mid-status-change, to disable its controls + show state.
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Guard: redirect to login if not authenticated (mirrors customers.index.tsx).
  useEffect(() => {
    if (!authLoading && !user) {
      nav({ to: "/login" });
    }
  }, [authLoading, user, nav]);

  if (authLoading || !user) return null;

  // Group jobs into status columns client-side. The query already ordered by
  // scheduledAt asc, so each column preserves soonest-first ordering.
  const columns: Record<JobStatus, Job[]> = {
    scheduled: [],
    en_route: [],
    in_progress: [],
    complete: [],
    canceled: [],
  };
  for (const job of jobs) {
    // Defensive: an unknown status shouldn't happen (server validates), but if
    // one slips in, drop it into scheduled rather than crashing the board.
    (columns[job.status] ?? columns.scheduled).push(job);
  }

  async function moveJob(job: Job, nextStatus: JobStatus) {
    if (job.status === nextStatus) return;
    setMoveError(null);
    setMovingId(job.id);
    try {
      await updateJob({ jobId: job.id, patch: { status: nextStatus } });
      // No local state update needed: onSnapshot delivers the change live.
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Could not update the job. Please try again.";
      setMoveError(msg);
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Scheduling</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The dispatch board for your account.
          </p>
        </div>
        <Link
          to="/scheduling/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          New job
        </Link>
      </div>

      {loading && (
        <p className="mt-10 text-sm text-muted-foreground">Loading jobs…</p>
      )}

      {error && !loading && (
        <p className="mt-10 text-sm text-destructive">{error}</p>
      )}

      {moveError && (
        <p className="mt-6 text-sm text-destructive">{moveError}</p>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-input py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No jobs yet. Add one with “New job,” or they’ll arrive from the phone
            agent once handoff is wired.
          </p>
        </div>
      )}

      {!loading && !error && jobs.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {JOB_STATUS_ORDER.map((status) => (
            <div
              key={status}
              className="flex flex-col rounded-lg border border-input bg-muted/30"
            >
              <div className="flex items-center justify-between border-b border-input px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {JOB_STATUS_LABELS[status]}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {columns[status].length}
                </span>
              </div>

              <div className="flex flex-col gap-3 p-3">
                {columns[status].length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    —
                  </p>
                )}

                {columns[status].map((job) => {
                  const price = formatMoney(job.priceCents);
                  const isMoving = movingId === job.id;
                  return (
                    <div
                      key={job.id}
                      className="rounded-md border border-input bg-background p-3 shadow-sm"
                    >
                      <div className="text-sm font-medium">
                        {job.customerName}
                      </div>
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        {job.service}
                      </div>

                      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                        <div className="tabular-nums">
                          {formatWhen(job.scheduledAt)}
                        </div>
                        {job.assignee && <div>{job.assignee}</div>}
                        {price && (
                          <div className="tabular-nums">{price}</div>
                        )}
                      </div>

                      {/* Status change = the primary board action. A select is
                          the accessible, no-drag-library way to move a card;
                          it calls updateJob (server-side write path). */}
                      <label className="sr-only" htmlFor={`move-${job.id}`}>
                        Change status for {job.customerName}
                      </label>
                      <select
                        id={`move-${job.id}`}
                        className="mt-3 w-full rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50"
                        value={job.status}
                        disabled={isMoving}
                        onChange={(e) =>
                          moveJob(job, e.target.value as JobStatus)
                        }
                      >
                        {JOB_STATUS_ORDER.map((s) => (
                          <option key={s} value={s}>
                            {JOB_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
