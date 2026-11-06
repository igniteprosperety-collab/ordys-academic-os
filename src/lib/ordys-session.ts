import { supabase } from "@/integrations/supabase/client";

/**
 * Ends the requested Supabase session scope and verifies the resulting state.
 * Use "others" before "local" when changing a password: this preserves the
 * current session if the server cannot revoke sessions on other devices.
 */
export async function signOutCurrentSession(
  options: { scope?: "local" | "others" } = {},
): Promise<void> {
  const scope = options.scope ?? "local";

  if (scope === "others") {
    const { data: before, error: beforeReadError } = await supabase.auth.getSession();
    if (beforeReadError) throw beforeReadError;
    if (!before.session) {
      throw new Error("Não há uma sessão ativa neste dispositivo para solicitar a revogação das outras sessões.");
    }

    // Supabase JS 2.118.0 treats some HTTP 403 responses as already-signed-out
    // for signOut, including bad_jwt and user_banned. Validate this identity
    // against Auth before interpreting a null signOut error as a revoke success.
    const { data: identity, error: identityReadError } = await supabase.auth.getUser();
    if (identityReadError) throw identityReadError;
    if (!identity.user || identity.user.id !== before.session.user.id) {
      throw new Error("Não foi possível validar a identidade desta sessão antes de revogar os outros dispositivos.");
    }

    let signOutError: unknown;
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      signOutError = error;
    } catch (error) {
      signOutError = error;
    }

    // Supabase JS 2.118.0 keeps the current session for the "others" scope,
    // including when the remote request fails. Verify that it remains available
    // so the person can retry instead of silently losing the only retry token.
    const { data: after, error: afterReadError } = await supabase.auth.getSession();
    if (afterReadError) throw signOutError ?? afterReadError;
    if (!after.session) {
      throw signOutError ?? new Error("A sessão local não permaneceu ativa após a tentativa de revogação das outras sessões.");
    }
    if (signOutError) throw signOutError;
    return;
  }

  let signOutError: unknown;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    signOutError = error;
  } catch (error) {
    signOutError = error;
  }

  // Local logout must work even when offline, but do not report success while
  // the persisted session is still present or cannot be read.
  const { data, error: sessionReadError } = await supabase.auth.getSession();
  if (sessionReadError) throw signOutError ?? sessionReadError;
  if (data.session) {
    throw signOutError ?? new Error("A sessão local permaneceu ativa após a tentativa de logout.");
  }
}
