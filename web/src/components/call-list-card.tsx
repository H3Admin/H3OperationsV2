import { Link } from "@tanstack/react-router";
import { CALL_STATUS_LABELS, type Call } from "@/lib/calls-schema";
import {
  formatCaller,
  formatDuration,
  formatStartedAt,
  statusVariant,
} from "@/lib/calls-format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * CallListCard — one row in the Calls or Leads list. Shared so both tabs
 * render a call identically; tapping navigates to the shared detail route.
 */
export function CallListCard({ call }: { call: Call }) {
  return (
    <Link
      to="/dashboard/calls/$callSid"
      params={{ callSid: call.callSid }}
      className="block"
    >
      <Card className="shadow-soft transition-colors hover:border-accent/40">
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
              // The one deliberate coral accent (§ Operator Blue: sparingly).
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
        </CardContent>
      </Card>
    </Link>
  );
}
