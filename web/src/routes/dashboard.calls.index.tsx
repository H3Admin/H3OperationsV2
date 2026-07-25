import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDashboardContext } from "@/lib/dashboard-context";
import { filterByDateRange } from "@/lib/calls-format";
import { callsToCsv, downloadCsv } from "@/lib/csv-export";
import { CallListCard } from "@/components/call-list-card";

export const Route = createFileRoute("/dashboard/calls/")({
  head: () => ({
    meta: [
      { title: "Calls — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: CallsPage,
});

function CallsPage() {
  const { calls, loading, error, dateRange } = useDashboardContext();
  const filtered = useMemo(
    () => filterByDateRange(calls, dateRange),
    [calls, dateRange],
  );

  const exportCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`calls-${today}.csv`, callsToCsv(filtered));
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Calls
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every call to your line, most recent first.
          </p>
        </div>
        {!loading && !error && filtered.length > 0 && (
          <button
            type="button"
            onClick={exportCsv}
            className="shrink-0 rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground"
          >
            Export CSV
          </button>
        )}
      </div>

      {loading && (
        <p className="mt-8 text-sm text-muted-foreground">Loading calls…</p>
      )}

      {error && !loading && (
        <p className="mt-8 text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-input py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {calls.length === 0
              ? "No calls yet. Calls answered by your phone agent will appear here."
              : "No calls in this date range."}
          </p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="mt-6 flex flex-col gap-3">
          {filtered.map((call) => (
            <CallListCard key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}
