export type RecoveryScreenMode = "request" | "reset";

export type RecoveryScreenModeResolution = {
  mode: RecoveryScreenMode;
  status: "resolved" | "fallback";
};

type AuthSessionLookup = {
  data: { session: unknown | null };
  error?: unknown | null;
};

const DEFAULT_SESSION_LOOKUP_TIMEOUT_MS = 8_000;

/**
 * Resolve whether the recovery screen should show the request form or the
 * password form. A failed or stalled local session lookup must not leave the
 * user indefinitely on the loading screen.
 */
export async function resolveRecoveryScreenMode(
  getSession: () => Promise<AuthSessionLookup>,
  timeoutMs = DEFAULT_SESSION_LOOKUP_TIMEOUT_MS,
): Promise<RecoveryScreenModeResolution> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      getSession(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Auth session initialization timed out")),
          timeoutMs,
        );
      }),
    ]);

    if (result.error) {
      return { mode: "request", status: "fallback" };
    }

    return {
      mode: result.data.session ? "reset" : "request",
      status: "resolved",
    };
  } catch {
    return { mode: "request", status: "fallback" };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
