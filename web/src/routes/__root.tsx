import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => <Outlet />,
  // Root-level not-found boundary. Without this, a transient not-found during
  // navigation/hydration surfaces as an unhandled notFoundError (Open Item #5,
  // intermittent on /signin → /login) instead of rendering a graceful page.
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        That page doesn’t exist or has moved.
      </p>
      <div className="mt-8 flex gap-4">
        <Link to="/login" className="font-medium text-accent">
          Go to sign in
        </Link>
        <Link to="/" className="font-medium text-accent">
          Home
        </Link>
      </div>
    </div>
  );
}
