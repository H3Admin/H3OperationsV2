import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "@/lib/auth-hooks";
import { functions } from "@/integrations/firebase/client";
import { STATUS_LABELS, SOURCE_LABELS } from "@/lib/customers-schema";

export const Route = createFileRoute("/customers/new")({
  head: () => ({
    meta: [
      { title: "New Customer — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: NewCustomerPage,
});

const createCustomer = httpsCallable<
  Record<string, unknown>,
  { customerId: string }
>(functions, "createCustomer");

function NewCustomerPage() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("lead");
  const [source, setSource] = useState("manual_entry");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: redirect to login if not authenticated (mirrors customers.tsx).
  useEffect(() => {
    if (!authLoading && !user) {
      nav({ to: "/login" });
    }
  }, [authLoading, user, nav]);

  if (authLoading || !user) return null;

  async function handleSubmit() {
    setError(null);
    if (!phone.trim()) {
      setError("Phone number is required.");
      return;
    }
    setSubmitting(true);
    try {
      // Server (createCustomer) is the real validator; it derives the doc ID
      // from the phone and rejects duplicates / bad input with typed errors.
      await createCustomer({
        phone,
        displayName: displayName.trim() || null,
        email: email.trim() || null,
        status,
        source,
        notes: notes.trim() || null,
      });
      // Success: back to the list, where onSnapshot renders the new row live.
      nav({ to: "/customers" });
    } catch (err: unknown) {
      // HttpsError.message carries the server's client-facing text
      // (e.g. "Enter a valid US phone number.", "A customer with this phone already exists.").
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
      <h1 className="text-3xl font-semibold tracking-tight">New Customer</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a lead or customer to your account.
      </p>

      <div className="mt-8 space-y-5">
        <div>
          <label className={labelClass}>
            Phone <span className="text-destructive">*</span>
          </label>
          <input
            className={fieldClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(214) 555-0123"
            inputMode="tel"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            US numbers only. This is the customer's unique identifier.
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
            {submitting ? "Saving…" : "Save customer"}
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
