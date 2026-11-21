export function hasNativeNotificationSyncErrors(queryErrors: readonly unknown[]) {
  return queryErrors.some(Boolean);
}

export function nativeNotificationsEnabledForBuild(
  enableFlag: string | undefined,
  disableFlag: string | undefined,
): boolean {
  return enableFlag === "1" && disableFlag !== "1";
}
