export type SignupSessionOutcome =
  | "signed-in"
  | "confirmation-pending"
  | "login-required"
  | "retry-login";

export function signupEmailIsAlreadyConfirmed(
  emailConfirmedAt: string | null | undefined,
): boolean {
  return typeof emailConfirmedAt === "string" && emailConfirmedAt.trim().length > 0;
}

/**
 * After signup creates a user without returning a session, try the password
 * immediately. Auth may have confirmed the account in a database trigger even
 * when the user snapshot returned by signup has a stale/missing timestamp.
 */
export async function resolveSignupSessionOutcome(
  emailConfirmedAt: string | null | undefined,
  signIn: () => Promise<{ error: { message?: string } | null }>,
): Promise<SignupSessionOutcome> {
  let signInError = "";

  try {
    const result = await signIn();
    signInError = result.error?.message ?? "";
  } catch (error) {
    signInError = error instanceof Error ? error.message : String(error);
  }

  if (!signInError) return "signed-in";
  if (signupEmailIsAlreadyConfirmed(emailConfirmedAt)) return "login-required";

  const normalizedError = signInError.toLowerCase();
  if (
    normalizedError.includes("email not confirmed") ||
    normalizedError.includes("email_not_confirmed")
  ) {
    return "confirmation-pending";
  }

  return "retry-login";
}
