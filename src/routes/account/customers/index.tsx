import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, type Timestamp } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/account/customers/")({
  component: CustomersListPage,
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

function CustomersListPage() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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
        const q = query(collection(db, "accounts", accountId, "customers"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        if (!cancelled) {
          setCustomers(snap.docs.map((d) => d.data() as Customer));
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "Failed to load customers.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <Link
          to="/account/customers/new"
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
        >
          Add Customer
        </Link>
      </div>

      {loading && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}
      {err && <p className="mt-8 text-sm text-destructive">{err}</p>}

      {!loading && !err && customers.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">No customers yet.</p>
      )}

      {!loading && !err && customers.length > 0 && (
        <table className="mt-8 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-input text-muted-foreground">
              <th className="py-2 pr-4 font-medium">ID</th>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Phone</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} className="border-b border-input">
                <td className="py-2 pr-4">
                  <Link
                    to="/account/customers/$customerId"
                    params={{ customerId: customer.id }}
                    className="text-accent"
                  >
                    {customer.displayId}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  {customer.firstName} {customer.lastName}
                </td>
                <td className="py-2 pr-4">{customer.email}</td>
                <td className="py-2 pr-4">{customer.phone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
