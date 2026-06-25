import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AccountSidebar } from "@/components/account-sidebar";

export const Route = createFileRoute("/account")({
  component: AccountLayout,
});

function AccountLayout() {
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      nav({ to: "/login" });
    }
  }, [loading, user, nav]);

  if (loading || !user) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen">
      <AccountSidebar />
      <main className="flex-1 px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
