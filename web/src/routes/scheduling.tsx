import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/scheduling")({
  component: () => <Outlet />,
});
