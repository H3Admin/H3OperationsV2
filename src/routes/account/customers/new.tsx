import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { collection, doc, getCountFromServer, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/account/customers/new")({
  component: NewCustomerPage,
});

function NewCustomerPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [zip, setZip] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErr(null);
    setSaving(true);

    try {
      const idTokenResult = await user.getIdTokenResult();
      const accountId = idTokenResult.claims.accountId as string | undefined;
      if (!accountId) {
        throw new Error("No account found for this user.");
      }

      const customersRef = collection(db, "accounts", accountId, "customers");
      const countSnap = await getCountFromServer(customersRef);
      const sequence = countSnap.data().count + 1;
      const year = new Date().getFullYear();
      const displayId = `CUST-${year}-${String(sequence).padStart(4, "0")}`;

      const newDocRef = doc(customersRef);
      await setDoc(newDocRef, {
        id: newDocRef.id,
        displayId,
        firstName,
        lastName,
        email,
        phone,
        address: { street, city, state: addressState, zip },
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        createdVia: "manual",
      });

      nav({ to: "/account/customers" });
    } catch (error: unknown) {
      setSaving(false);
      if (error instanceof Error) {
        setErr(error.message);
      }
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold">Add Customer</h1>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
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

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex items-center gap-4">
          <button
            disabled={saving}
            className="rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save customer"}
          </button>
          <Link to="/account/customers" className="text-sm text-muted-foreground">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
