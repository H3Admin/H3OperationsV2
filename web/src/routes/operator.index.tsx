import { createFileRoute, redirect } from "@tanstack/react-router";

// /operator has no content of its own — Accounts is the default view.
export const Route = createFileRoute("/operator/")({
  beforeLoad: () => {
    throw redirect({ to: "/operator/accounts" });
  },
});
