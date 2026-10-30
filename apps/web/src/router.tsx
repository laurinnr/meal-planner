import type { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { homeRoute } from "./routes/home.tsx";
import { rootRoute } from "./routes/root.tsx";

const routeTree = rootRoute.addChildren([homeRoute]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient } });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
