import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { toast } from "sonner";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.me().then((r) => r.user),
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.login,
    onSuccess: (data) => { qc.setQueryData(["me"], data.user); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.register,
    onSuccess: () => { qc.setQueryData(["me"], null); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => { qc.setQueryData(["me"], null); qc.invalidateQueries(); },
  });
}
