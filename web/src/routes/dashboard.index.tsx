import { createFileRoute, redirect } from "@tanstack/react-router";

// /dashboard has no content of its own — Calls is the default tab.
export const Route = createFileRoute("/dashboard/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/calls" });
  },
});
