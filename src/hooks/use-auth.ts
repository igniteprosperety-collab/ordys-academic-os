import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getGuestId, isGuestMode } from "@/lib/demo-mode";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [guest, setGuest] = useState(() => isGuestMode());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      setLoading(false);
      if (next) setGuest(false);
    });

    const onGuestChange = () => setGuest(isGuestMode());
    window.addEventListener("ordys:guest-change", onGuestChange);
    window.addEventListener("storage", onGuestChange);

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("ordys:guest-change", onGuestChange);
      window.removeEventListener("storage", onGuestChange);
    };
  }, []);

  const user: User | null = session?.user ?? null;
  const guestId = guest ? getGuestId() : null;

  return {
    session,
    user,
    userId: user?.id ?? guestId,
    guest,
    loading,
  };
}
