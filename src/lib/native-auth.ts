import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

export const ORDYS_NATIVE_AUTH_REDIRECT_URI = "app.ordys.academy://auth/callback";
export const ORDYS_NATIVE_RECOVERY_PENDING_KEY = "ordys:native-recovery-pending-v1";
export const NATIVE_AUTH_EVENT = "ordys:native-auth";

export type NativeAuthEventDetail = {
  status: "success" | "error" | "cancelled";
  purpose?: "signin" | "recovery";
  message?: string;
};

let authUrlListener: PluginListenerHandle | null = null;
let browserFinishedListener: PluginListenerHandle | null = null;
let appStateListener: PluginListenerHandle | null = null;
let nativeAuthInitPromise: Promise<void> | null = null;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let lastHandledAuthCallbackUrl = "";
let lastHandledAuthCallbackAt = 0;
const RECENT_AUTH_CALLBACK_WINDOW_MS = 30_000;
let nativeGooglePending = false;
let nativeGoogleStartedAt = 0;
let nativeCallbackInFlight = false;

const emitNativeAuth = (detail: NativeAuthEventDetail) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<NativeAuthEventDetail>(NATIVE_AUTH_EVENT, { detail }),
    );
  }
};

const clearResumeTimer = () => {
  if (resumeTimer !== null) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
};

const clearNativeRecoveryPending = () => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ORDYS_NATIVE_RECOVERY_PENDING_KEY);
  }
};

const hasFreshNativeRecoveryPending = () => {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(ORDYS_NATIVE_RECOVERY_PENDING_KEY);
  const timestamp = Number(raw);
  if (!Number.isFinite(timestamp)) return false;
  if (Date.now() - timestamp > 2 * 60 * 60 * 1000) {
    clearNativeRecoveryPending();
    return false;
  }
  return true;
};

export const markNativeRecoveryPending = () => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      ORDYS_NATIVE_RECOVERY_PENDING_KEY,
      String(Date.now()),
    );
  }
};

const settleNativeGoogle = (
  status: NativeAuthEventDetail["status"],
  message?: string,
  purpose: NativeAuthEventDetail["purpose"] = "signin",
) => {
  nativeGooglePending = false;
  nativeCallbackInFlight = false;
  clearResumeTimer();
  emitNativeAuth({ status, purpose, ...(message === undefined ? {} : { message }) });
};

async function closeExternalBrowser() {
  await Browser.close().catch(() => undefined);
}

function getCallbackError(parsed: URL) {
  const description = parsed.searchParams.get("error_description");
  const error = parsed.searchParams.get("error");

  if (description || error) {
    return description ?? error ?? "Falha na autenticação com Google.";
  }

  if (parsed.hash.startsWith("#")) {
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    const fragmentDescription = fragment.get("error_description");
    const fragmentError = fragment.get("error");
    if (fragmentDescription || fragmentError) {
      return fragmentDescription ?? fragmentError ?? "Falha na autenticação com Google.";
    }
  }

  return null;
}

async function handleAuthCallbackUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (
    parsed.protocol !== "app.ordys.academy:" ||
    parsed.hostname !== "auth" ||
    parsed.pathname !== "/callback"
  ) {
    return false;
  }

  const now = Date.now();
  if (
    lastHandledAuthCallbackUrl === url &&
    now - lastHandledAuthCallbackAt < RECENT_AUTH_CALLBACK_WINDOW_MS
  ) {
    // Android can deliver the same cold-start link through both appUrlOpen and getLaunchUrl.
    return true;
  }
  if (nativeCallbackInFlight) return true;

  lastHandledAuthCallbackUrl = url;
  lastHandledAuthCallbackAt = now;
  nativeCallbackInFlight = true;
  let callbackPurpose: NativeAuthEventDetail["purpose"] = "signin";

  try {
    const callbackError = getCallbackError(parsed);
    const fragment =
      parsed.hash.startsWith("#")
        ? new URLSearchParams(parsed.hash.slice(1))
        : null;
    const tokenType =
      parsed.searchParams.get("type") ?? fragment?.get("type");
    const recoveryFlow = tokenType
      ? tokenType === "recovery"
      : hasFreshNativeRecoveryPending();
    if (tokenType && tokenType !== "recovery") clearNativeRecoveryPending();
    callbackPurpose = recoveryFlow ? "recovery" : "signin";

    if (callbackError) {
      clearNativeRecoveryPending();
      settleNativeGoogle(
        "error",
        callbackError,
        recoveryFlow ? "recovery" : "signin",
      );
      await closeExternalBrowser();
      return true;
    }

    const code = parsed.searchParams.get("code");
    const tokenHash = parsed.searchParams.get("token_hash");

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else if (
      tokenHash &&
      (tokenType === "signup" ||
        tokenType === "email" ||
        tokenType === "email_change" ||
        tokenType === "recovery")
    ) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: tokenType as
          | "signup"
          | "email"
          | "email_change"
          | "recovery",
      });
      if (error) throw error;
    } else {
      const accessToken = fragment?.get("access_token");
      const refreshToken = fragment?.get("refresh_token");

      if (!accessToken || !refreshToken) {
        throw new Error("O link de autenticação está incompleto. Solicite um novo e-mail ou tente novamente.");
      }

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    }

    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw new Error(
        "O acesso foi retornado, mas a sessão não pôde ser estabelecida.",
      );
    }

    const purpose = recoveryFlow ? "recovery" : "signin";
    clearNativeRecoveryPending();
    settleNativeGoogle("success", undefined, purpose);
    await closeExternalBrowser();
    return true;
  } catch (error) {
    if (callbackPurpose === "recovery") clearNativeRecoveryPending();
    settleNativeGoogle(
      "error",
      error instanceof Error
        ? error.message
        : "Não foi possível concluir o acesso.",
      callbackPurpose,
    );
    await closeExternalBrowser();
    return true;
  }
}

export function initializeNativeAuth(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (nativeAuthInitPromise) return nativeAuthInitPromise;

  nativeAuthInitPromise = initializeNativeAuthOnce().catch(async (error: unknown) => {
    const handles = [authUrlListener, browserFinishedListener, appStateListener];
    await Promise.all(handles.map(async (handle) => {
      if (!handle) return;
      try {
        await handle.remove();
      } catch {
        // Listener cleanup is best-effort; preserve the original initialization error.
      }
    }));
    authUrlListener = null;
    browserFinishedListener = null;
    appStateListener = null;
    nativeAuthInitPromise = null;
    throw error;
  });
  return nativeAuthInitPromise;
}

async function initializeNativeAuthOnce() {
  authUrlListener = await App.addListener("appUrlOpen", ({ url }) => {
    void handleAuthCallbackUrl(url);
  });

  browserFinishedListener = await Browser.addListener("browserFinished", () => {
    if (!nativeGooglePending || nativeCallbackInFlight) return;
    clearResumeTimer();
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (!nativeGooglePending || nativeCallbackInFlight) return;
      settleNativeGoogle("cancelled");
    }, 500);
  });

  appStateListener = await App.addListener(
    "appStateChange",
    ({ isActive }) => {
      if (!isActive || !nativeGooglePending || nativeCallbackInFlight) return;

      const elapsed = Date.now() - nativeGoogleStartedAt;
      if (elapsed < 700) return;

      clearResumeTimer();
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (!nativeGooglePending || nativeCallbackInFlight) return;
        settleNativeGoogle("cancelled");
      }, 4_000);
    },
  );

  const launchUrl = await App.getLaunchUrl();
  if (launchUrl?.url) {
    await handleAuthCallbackUrl(launchUrl.url);
  }
}

export function cancelNativeGoogleSignIn() {
  if (!Capacitor.isNativePlatform() || !nativeGooglePending) return;
  settleNativeGoogle("cancelled");
  void closeExternalBrowser();
}

export function expireNativeGoogleSignIn() {
  if (!Capacitor.isNativePlatform() || !nativeGooglePending) return;
  settleNativeGoogle(
    "error",
    "A tentativa de acesso expirou. Tente novamente.",
  );
  void closeExternalBrowser();
}

export async function startGoogleSignIn(webRedirectUri: string) {
  if (!Capacitor.isNativePlatform()) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: webRedirectUri,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) throw error;
    return { redirected: true };
  }

  // Mark the attempt pending before initialization so initialization failures
  // can be reported through the same native event channel as OAuth failures.
  nativeGooglePending = true;
  nativeGoogleStartedAt = Date.now();
  nativeCallbackInFlight = false;
  clearResumeTimer();

  try {
    await initializeNativeAuth();
    clearNativeRecoveryPending();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: ORDYS_NATIVE_AUTH_REDIRECT_URI,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) throw error;
    if (!data.url) {
      throw new Error("Não foi possível iniciar o acesso com Google.");
    }

    await Browser.open({ url: data.url });
    return { redirected: false };
  } catch (error) {
    settleNativeGoogle(
      "error",
      error instanceof Error
        ? error.message
        : "Não foi possível iniciar o acesso com Google.",
    );
    throw error;
  }
}
