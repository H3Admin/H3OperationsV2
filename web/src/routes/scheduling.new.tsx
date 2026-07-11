import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "@/lib/auth-hooks";
import { functions } from "@/integrations/firebase/client";
import { JOB_STATUS_LABELS, JOB_STATUS_ORDER } from "@/lib/jobs-schema";

export const Route = createFileRoute("/scheduling/new")({
  head: () => ({
    meta: [
      { title: "New Job — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: NewJobPage,
});

// createJob is the server-side write path. It runs buildNewJob (the canonical
// validator/factory): required fields, snake_case status/source, cents for
// money, E.164 for the phone snapshot. The client only collects and sends.
const createJob = httpsCallable<
  Record<string, unknown>,
  { jobId: string }
>(functions, "createJob");

function NewJobPage() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [customerName, setCustomerName] = useState("");
  const [service, setService] = useState("");
  // datetime-local yields "YYYY-MM-DDTHH:mm"; new Date(...) parses it in local
  // time, and the server coerces to a Firestore Timestamp (UTC) via toTimestamp.
  const [scheduledAt, setScheduledAt] = useState("");
  const [status, setStatus] = useState("scheduled");
  const [customerPhone, setCustomerPhone] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: redirect to login if not authenticated (mirrors customers.new.tsx).
  useEffect(() => {
    if (!authLoading && !user) {
      nav({ to: "/login" });
    }
  }, [authLoading, user, nav]);

  if (authLoading || !user) return null;

  async function handleSubmit() {
    setError(null);
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!service.trim()) {
      setError("Service is required.");
      return;
    }
    if (!scheduledAt) {
      setError("A scheduled date and time is required.");
      return;
    }

    // Convert dollars → integer cents at the boundary (money is cents on the
    // server; never send floats). Empty = omit (null on the server).
    let priceCents: number | null = null;
    if (priceDollars.trim()) {
      const parsed = Number(priceDollars);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Price must be a non-negative dollar amount.");
        return;
      }
      priceCents = Math.round(parsed * 100);
    }

    setSubmitting(true);
    try {
      // Server (createJob) is the real validator; it derives accountId from the
      // auth token claim and rejects bad input with typed HttpsError messages.
      await createJob({
        customerName: customerName.trim(),
        service: service.trim(),
        // Send ISO-8601; the server's toTimestamp accepts an ISO string.
        scheduledAt: new Date(scheduledAt).toISOString(),
        status,
        customerPhone: customerPhone.trim() || null,
        assignee: assignee.trim() || null,
        priceCents,
        notes: notes.trim() || null,
      });
      // Success: back to the board, where onSnapshot renders the new card live.
      nav({ to: "/scheduling" });
    } catch (err: unknown) {
      // HttpsError.message carries the server's client-facing text
      // (e.g. "customerName must be a non-empty string").
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Something went wrong. Please try again.";
      setError(msg);
      setSubmitting(false);
    }
  }

  const fieldClass =
    "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  const labelClass = "block text-sm font-medium";

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">New Job</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a job to the dispatch board.
      </p>

      <div className="mt-8 space-y-5">
        <div>
          <label className={labelClass}>
            Customer name <span className="text-destructive">*</span>
          </label>
          <input
            className={fieldClass}
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Jane Smith"
          />
        </div>

        <div>
          <label className={labelClass}>
            Service <span className="text-destructive">*</span>
          </label>
          <input
            className={fieldClass}
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="Water heater replacement"
          />
        </div>

        <div>
          <label className={labelClass}>
            Scheduled <span className="text-destructive">*</span>
          </label>
          <input
            type="datetime-local"
            className={fieldClass}
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>Status</label>
          <select
            className={fieldClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {JOB_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Customer phone</label>
          <input
            className={fieldClass}
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="(214) 555-0123"
            inputMode="tel"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Optional. US numbers only — stored as a display snapshot.
          </p>
        </div>

        <div>
          <label className={labelClass}>Assignee</label>
          <input
            className={fieldClass}
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="Unassigned"
          />
        </div>

        <div>
          <label className={labelClass}>Price</label>
          <input
            className={fieldClass}
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Optional. In dollars — converted to cents on save.
          </p>
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            className={fieldClass}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save job"}
          </button>
          <button
            onClick={() => nav({ to: "/scheduling" })}
            disabled={submitting}
            className="rounded-md border border-input px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
