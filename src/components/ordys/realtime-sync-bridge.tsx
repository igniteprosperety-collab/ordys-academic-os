import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToOrdysRealtime } from "@/lib/ordys-realtime";

export function RealtimeSyncBridge() {
  const { userId, loading, isDemo } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (loading || !userId || isDemo) return;
    return subscribeToOrdysRealtime(queryClient, userId);
  }, [isDemo, loading, queryClient, userId]);

  return null;
}
