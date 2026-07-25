import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout for /dashboard/calls/* — mirrors customers.tsx. The list lives in
// dashboard.calls.index.tsx and the detail view in dashboard.calls.$callSid.tsx;
// both need this Outlet to have somewhere to render.
export const Route = createFileRoute("/dashboard/calls")({
  component: () => <Outlet />,
});
