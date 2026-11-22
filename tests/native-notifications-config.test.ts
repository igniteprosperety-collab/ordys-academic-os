import { describe, expect, it } from "vitest";
import {
  hasNativeNotificationSyncErrors,
  nativeNotificationsEnabledForBuild,
} from "@/lib/native-notifications-config";

describe("native notification build flags", () => {
  it("keeps native notifications disabled when no distribution opts in", () => {
    expect(nativeNotificationsEnabledForBuild(undefined, undefined)).toBe(false);
    expect(nativeNotificationsEnabledForBuild("0", undefined)).toBe(false);
    expect(nativeNotificationsEnabledForBuild(undefined, "0")).toBe(false);
  });

  it("enables native notifications only for an explicit opt-in build", () => {
    expect(nativeNotificationsEnabledForBuild("1", undefined)).toBe(true);
    expect(nativeNotificationsEnabledForBuild("1", "0")).toBe(true);
  });

  it("lets an explicit disable switch override an enable flag", () => {
    expect(nativeNotificationsEnabledForBuild("1", "1")).toBe(false);
  });
});

describe("native notification sync completeness", () => {
  it("aborts reconciliation when any required query fails", () => {
    expect(hasNativeNotificationSyncErrors([])).toBe(false);
    expect(hasNativeNotificationSyncErrors([null, undefined, false])).toBe(false);
    expect(hasNativeNotificationSyncErrors([null, new Error("calendar unavailable")])).toBe(true);
  });
});
