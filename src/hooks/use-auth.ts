import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getDemoUser, isDemoMode, stopDemoMode } from "@/lib/demo-mode";

const AUTH_SESSION_TIMEOUT_MS = 8_000;

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [guest, setGuest] = useState(() => isDemoMode());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let authStateChanged = false;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      authStateChanged = true;
      setSession(next);
      setLoading(false);
      if (next) {
        // A local/demo marker must never override an authenticated cloud session.
        if (isDemoMode()) stopDemoMode();
        setGuest(false);
      } else {
        setGuest(isDemoMode());
      }
    });

    const loadSession = async () => {
      let timeoutId: number | ReturnType<typeof window.setTimeout> | undefined;
      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(
              () => reject(new Error("Auth session timeout")),
              AUTH_SESSION_TIMEOUT_MS,
            );
          }),
        ]);

        if (!mounted) return;
        // A live auth event wins over a potentially stale session snapshot.
        if (!authStateChanged) {
          setSession(result.data.session);
          if (result.data.session && isDemoMode()) stopDemoMode();
          setGuest(result.data.session ? false : isDemoMode());
        }
        setLoading(false);
      } catch (error) {
        if (!mounted) return;
        console.warn(
          "ORDYS auth session initialization did not complete:",
          error,
        );
        // Do not erase a valid session already delivered by onAuthStateChange.
        if (!authStateChanged) {
          setSession(null);
          setGuest(isDemoMode());
        }
        setLoading(false);
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    };

    void loadSession();

    const onGuestChange = () => setGuest(isDemoMode());
    window.addEventListener("ordys:guest-change", onGuestChange);
    window.addEventListener("ordys-local-profile-changed", onGuestChange);

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("ordys:guest-change", onGuestChange);
      window.removeEventListener("ordys-local-profile-changed", onGuestChange);
    };
  }, []);

  const demoUser = guest ? getDemoUser() : null;
  const user: User | null = session?.user ?? demoUser;
  const userId = user?.id ?? null;

  return {
    session,
    user,
    userId,
    guest,
    isDemo: guest,
    loading,
  };
}
