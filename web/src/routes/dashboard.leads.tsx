import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDashboardContext } from "@/lib/dashboard-context";
import { filterByDateRange } from "@/lib/calls-format";
import { callsToCsv, downloadCsv } from "@/lib/csv-export";
import { callsToXlsxWorkbook, downloadXlsx } from "@/lib/xlsx-export";
import { CallListCard } from "@/components/call-list-card";

// Leads is the same call data as Calls, filtered to isNewLead === true — the
// "new business" view. No separate Firestore read; both tabs share the one
// useCalls() listener via DashboardContext.
export const Route = createFileRoute("/dashboard/leads")({
  head: () => ({
    meta: [
      { title: "Leads — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  const { calls, loading, error, dateRange } = useDashboardContext();
  const filtered = useMemo(() => {
    const newLeads = calls.filter((c) => c.isNewLead);
    return filterByDateRange(newLeads, dateRange);
  }, [calls, dateRange]);

  const exportCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`leads-${today}.csv`, callsToCsv(filtered));
  };

  const exportXlsx = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadXlsx(`leads-${today}.xlsx`, callsToXlsxWorkbook(filtered));
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Leads
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            New business from calls to your line.
          </p>
        </div>
        {!loading && !error && filtered.length > 0 && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="shrink-0 rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={exportXlsx}
              className="shrink-0 rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              Export XLSX
            </button>
          </div>
        )}
      </div>

      {loading && (
        <p className="mt-8 text-sm text-muted-foreground">Loading leads…</p>
      )}

      {error && !loading && (
        <p className="mt-8 text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-input py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {calls.some((c) => c.isNewLead)
              ? "No new leads in this date range."
              : "No new leads yet. New callers your phone agent captures will appear here."}
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
