import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { doc, getDoc, updateDoc, type Timestamp } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/account/customers/$customerId")({
  component: CustomerDetailPage,
});

interface Customer {
  id: string;
  displayId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: { street: string; city: string; state: string; zip: string };
  createdAt: Timestamp | null;
  createdBy: string;
  createdVia: string;
}

function CustomerDetailPage() {
  const { customerId } = Route.useParams();
  const { user } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [zip, setZip] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const idTokenResult = await user.getIdTokenResult();
        const accountId = idTokenResult.claims.accountId as string | undefined;
        if (!accountId) {
          if (!cancelled) setErr("No account found for this user.");
          return;
        }
        const snap = await getDoc(doc(db, "accounts", accountId, "customers", customerId));
        if (!snap.exists()) {
          if (!cancelled) setErr("Customer not found.");
          return;
        }
        const data = snap.data() as Customer;
        if (!cancelled) {
          setCustomer(data);
          setFirstName(data.firstName);
          setLastName(data.lastName);
          setEmail(data.email);
          setPhone(data.phone);
          setStreet(data.address?.street ?? "");
          setCity(data.address?.city ?? "");
          setAddressState(data.address?.state ?? "");
          setZip(data.address?.zip ?? "");
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "Failed to load customer.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, customerId]);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setErr(null);

    try {
      const idTokenResult = await user.getIdTokenResult();
      const accountId = idTokenResult.claims.accountId as string | undefined;
      if (!accountId) {
        throw new Error("No account found for this user.");
      }

      const updated = {
        firstName,
        lastName,
        email,
        phone,
        address: { street, city, state: addressState, zip },
      };
      await updateDoc(doc(db, "accounts", accountId, "customers", customerId), updated);
      setCustomer((prev) => (prev ? { ...prev, ...updated } : prev));
      setEditing(false);
    } catch (error: unknown) {
      if (error instanceof Error) {
        setErr(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (err && !customer) {
    return (
      <div>
        <p className="text-sm text-destructive">{err}</p>
        <Link to="/account/customers" className="mt-4 inline-block text-sm text-accent">
          ← Back to customers
        </Link>
      </div>
    );
  }

  if (!customer) {
    return null;
  }

  return (
    <div className="max-w-lg">
      <Link to="/account/customers" className="text-sm text-muted-foreground">
        ← Back to customers
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{customer.displayId}</h1>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="rounded-full border border-input px-4 py-1.5 text-sm font-medium"
          >
            Edit
          </button>
        )}
      </div>

      {err && <p className="mt-4 text-sm text-destructive">{err}</p>}

      {!editing ? (
        <div className="mt-6 space-y-2 text-sm">
          <p>
            <span className="font-medium">Name:</span> {customer.firstName} {customer.lastName}
          </p>
          <p>
            <span className="font-medium">Email:</span> {customer.email}
          </p>
          <p>
            <span className="font-medium">Phone:</span> {customer.phone}
          </p>
          <p>
            <span className="font-medium">Address:</span> {customer.address?.street}, {customer.address?.city},{" "}
            {customer.address?.state} {customer.address?.zip}
          </p>
        </div>
      ) : (
        <form onSubmit={onSave} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">First name</label>
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Last name</label>
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Street</label>
            <input
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">City</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">State</label>
              <input
                value={addressState}
                onChange={(e) => setAddressState(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">ZIP</label>
              <input
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              disabled={saving}
              className="rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-muted-foreground">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
