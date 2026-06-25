import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5 * 60_000, gcTime: 20 * 60_000, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});
