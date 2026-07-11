import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "@/lib/auth-hooks";
import { functions } from "@/integrations/firebase/client";
import { useCustomers } from "@/hooks/useCustomers";
import { STATUS_LABELS, SOURCE_LABELS } from "@/lib/customers-schema";

export const Route = createFileRoute("/customers/$id")({
  head: () => ({
    meta: [
      { title: "Edit Customer — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: EditCustomerPage,
});

// Nested payload, mirroring updateJob (see the updateCustomer DECISION comment
// in functions/src/index.ts). customerId is the routing key; the mutable fields
// ride under `patch`, which the server hands straight to buildCustomerUpdate.
const updateCustomer = httpsCallable<
  Record<string, unknown>,
  { customerId: string }
>(functions, "updateCustomer");

function EditCustomerPage() {
  const nav = useNavigate();
  const { id } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const {
    customers,
    loading: customersLoading,
    error: loadError,
  } = useCustomers();

  // Serve the single doc from the live list snapshot rather than a parallel
  // fetch — useCustomers already holds it and keeps it fresh via onSnapshot.
  const customer = customers.find((c) => c.id === id);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("lead");
  const [source, setSource] = useState("manual_entry");
  const [notes, setNotes] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: redirect to login if not authenticated (mirrors customers.new.tsx).
  useEffect(() => {
    if (!authLoading && !user) {
      nav({ to: "/login" });
    }
  }, [authLoading, user, nav]);

  // Prefill the form ONCE from the snapshot. Hydrating a single time means later
  // onSnapshot emissions (including our own write landing) never stomp edits the
  // user has in progress. Live reflection is verified on the list after save.
  useEffect(() => {
    if (!hydrated && customer) {
      setDisplayName(customer.displayName ?? "");
      setEmail(customer.email ?? "");
      setStatus(customer.status ?? "lead");
      setSource(customer.source ?? "manual_entry");
      setNotes(customer.notes ?? "");
      setHydrated(true);
    }
  }, [hydrated, customer]);

  if (authLoading || !user) return null;

  const fieldClass =
    "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  const labelClass = "block text-sm font-medium";

  // Still loading the account's customers and haven't matched this id yet.
  if (customersLoading && !customer) {
    return (
      <div className="mx-auto max-w-xl px-6 py-12">
        <p className="text-sm text-muted-foreground">Loading customer…</p>
      </div>
    );
  }

  // Load error from the hook, or a genuinely missing / cross-account id.
  if (loadError || !customer) {
    return (
      <div className="mx-auto max-w-xl px-6 py-12">
        <p className="text-sm text-destructive">
          {loadError ?? "Customer not found."}
        </p>
        <button
          onClick={() => nav({ to: "/customers" })}
          className="mt-6 rounded-md border border-input px-4 py-2 text-sm font-medium"
        >
          Back to customers
        </button>
      </div>
    );
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      // Server (updateCustomer) is the real validator: it enforces the mutable
      // allowlist, validates enums, stamps updatedAt, and 404s a bad id.
      await updateCustomer({
        customerId: id,
        patch: {
          displayName: displayName.trim() || null,
          email: email.trim() || null,
          status,
          source,
          notes: notes.trim() || null,
        },
      });
      // Success: back to the list, where onSnapshot renders the update live.
      nav({ to: "/customers" });
    } catch (err: unknown) {
      // HttpsError.message carries the server's client-facing text
      // (e.g. "Customer not found.", "invalid status …").
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Something went wrong. Please try again.";
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Edit Customer</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Update this lead or customer's details.
      </p>

      <div className="mt-8 space-y-5">
        <div>
          <label className={labelClass}>Phone</label>
          <input
            className={`${fieldClass} cursor-not-allowed opacity-60`}
            value={customer.phone}
            readOnly
            disabled
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Phone is the customer's unique identifier and can't be changed here.
          </p>
        </div>

        <div>
          <label className={labelClass}>Name</label>
          <input
            className={fieldClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jane Smith"
          />
        </div>

        <div>
          <label className={labelClass}>Email</label>
          <input
            className={fieldClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            inputMode="email"
          />
        </div>

        <div>
          <label className={labelClass}>Status</label>
          <select
            className={fieldClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Source</label>
          <select
            className={fieldClass}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
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

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={() => nav({ to: "/customers" })}
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
