export function nativeNotificationsEnabledForBuild(
  enableFlag: string | undefined,
  disableFlag: string | undefined,
): boolean {
  return enableFlag === "1" && disableFlag !== "1";
}
