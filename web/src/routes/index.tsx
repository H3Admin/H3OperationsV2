import { createFileRoute, Link } from "@tanstack/react-router";

// Minimal placeholder landing for the harvested SPA. The live marketing site
// still serves the public pages; this app owns the authenticated surface.
export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">H3 Operations</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Internal application shell.
      </p>
      <div className="mt-8 flex gap-4">
        <Link to="/login" className="font-medium text-accent">
          Sign in
        </Link>
        <Link to="/signup" className="font-medium text-accent">
          Create account
        </Link>
      </div>
    </div>
  );
}
