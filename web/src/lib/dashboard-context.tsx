/**
 * dashboard-context.tsx — state shared across the /dashboard layout route and
 * its children (Calls tab, Leads tab, call detail).
 *
 * The /dashboard layout route owns the single useCalls() listener and the
 * date-range filter state; children read both here instead of re-fetching or
 * re-deriving them. Plain React context, not TanStack Router context — this is
 * live UI state (a controlled date range), not route/loader configuration.
 */

import { createContext, useContext } from "react";
import type { Call } from "@/lib/calls-schema";
import type { DateRange } from "@/lib/calls-format";

export interface DashboardContextValue {
  calls: Call[];
  loading: boolean;
  error: string | null;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboardContext(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error("useDashboardContext must be used within the /dashboard layout route");
  }
  return ctx;
}
