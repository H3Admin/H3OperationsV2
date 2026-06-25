import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";

export function AccountSidebar() {
  const { user, signOut } = useAuth();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-input bg-background">
      <div className="px-4 py-6">
        <span className="text-lg font-semibold">H3 Operations</span>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        <Link
          to="/account"
          className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Dashboard
        </Link>
        <Link
          to="/account/customers"
          className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Customers
        </Link>
        <Link
          to="/account/team"
          className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Team
        </Link>
        <Link
          to="/account/profile"
          className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Profile
        </Link>
      </nav>

      <div className="border-t border-input px-4 py-4">
        <p className="truncate text-sm font-medium">{user?.displayName || user?.email}</p>
        <button
          onClick={() => signOut()}
          className="mt-2 w-full rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
