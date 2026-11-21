import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  invalidateOrdysRealtimeOwnerQueries,
  subscribeToOrdysRealtime,
} from "@/lib/ordys-realtime";
import {
  cancelAllOrdysNativeNotifications,
  cancelNativeFocusTimerAlarm,
  scheduleNativeFocusTimerAlarm,
} from "@/lib/native-notifications";
import { readFocusTimerState } from "@/lib/focus-timer-state";

export function RealtimeSyncBridge() {
  const { userId, loading, isDemo } = useAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);
  const notificationSyncChain = useRef<Promise<void>>(Promise.resolve());
  const needsNotificationCleanup = useRef(false);

  useEffect(() => {
    const previous = previousUserId.current;
    const shouldClearOrdysReminders = Boolean(
      previous && (previous !== userId || !userId || isDemo),
    );
    if (shouldClearOrdysReminders) needsNotificationCleanup.current = true;
    previousUserId.current = userId ?? null;
    let cancelled = false;

    const syncAccountNotifications = async () => {
      if (needsNotificationCleanup.current) {
        await cancelAllOrdysNativeNotifications();
        needsNotificationCleanup.current = false;
      }
      if (cancelled || loading || !userId || isDemo) return;

      const saved = readFocusTimerState(userId);
      if (
        saved?.status === "running" &&
        saved.endsAtMs !== null &&
        saved.endsAtMs > Date.now()
      ) {
        await scheduleNativeFocusTimerAlarm(userId, saved.endsAtMs);
      } else {
        await cancelNativeFocusTimerAlarm(userId);
      }
    };

    if (shouldClearOrdysReminders || (!loading && userId && !isDemo)) {
      const queued = notificationSyncChain.current
        .catch(() => undefined)
        .then(syncAccountNotifications);
      notificationSyncChain.current = queued.catch((error) => {
        console.error("[notifications] account reminder reconciliation failed", error);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [isDemo, loading, userId]);

  useEffect(() => {
    if (loading || !userId || isDemo) return;
    return subscribeToOrdysRealtime(queryClient, userId);
  }, [isDemo, loading, queryClient, userId]);

  useEffect(() => {
    if (loading || !userId || isDemo) return;

    const refreshVisibleSession = () => {
      if (document.visibilityState !== "visible") return;
      invalidateOrdysRealtimeOwnerQueries(queryClient, userId);

      const restoreFocusAlarm = async () => {
        if (needsNotificationCleanup.current) {
          await cancelAllOrdysNativeNotifications();
          needsNotificationCleanup.current = false;
        }
        const saved = readFocusTimerState(userId);
        if (
          saved?.status === "running" &&
          saved.endsAtMs !== null &&
          saved.endsAtMs > Date.now()
        ) {
          await scheduleNativeFocusTimerAlarm(userId, saved.endsAtMs);
        } else {
          await cancelNativeFocusTimerAlarm(userId);
        }
      };
      const queued = notificationSyncChain.current
        .catch(() => undefined)
        .then(restoreFocusAlarm);
      notificationSyncChain.current = queued.catch((error) => {
        console.error("[focus] could not restore Android timer alarm after resume", error);
      });
    };

    document.addEventListener("visibilitychange", refreshVisibleSession);
    window.addEventListener("online", refreshVisibleSession);
    return () => {
      document.removeEventListener("visibilitychange", refreshVisibleSession);
      window.removeEventListener("online", refreshVisibleSession);
    };
  }, [isDemo, loading, queryClient, userId]);

  return null;
}
