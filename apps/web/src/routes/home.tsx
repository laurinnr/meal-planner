import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import { api } from "../api.ts";
import { rootRoute } from "./root.tsx";

const statusQuery = queryOptions({
  queryKey: ["status"],
  queryFn: async () => {
    const response = await api.status.$get();
    if (!response.ok) throw new Error(`GET /status failed with ${response.status}`);
    return response.json();
  },
});

const databaseLabels = {
  ok: "Database reachable",
  unavailable: "Database unavailable",
} as const;

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: ({ context }) => context.queryClient.ensureQueryData(statusQuery),
  component: Home,
  errorComponent: ({ error }) => (
    <p role="alert">
      Cannot reach the API: {error instanceof Error ? error.message : String(error)}
    </p>
  ),
});

function Home() {
  const { data: status } = useSuspenseQuery(statusQuery);
  return (
    <dl>
      <dt>Service</dt>
      <dd>{status.service}</dd>
      <dt>Database</dt>
      <dd>{databaseLabels[status.database]}</dd>
      <dt>Checked at</dt>
      <dd>
        <time dateTime={status.checkedAt}>{new Date(status.checkedAt).toLocaleString()}</time>
      </dd>
    </dl>
  );
}
