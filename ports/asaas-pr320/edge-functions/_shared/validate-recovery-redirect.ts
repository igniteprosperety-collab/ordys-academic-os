const NATIVE_RECOVERY_REDIRECT = "app.ordys.academy://auth/callback";
const RECOVERY_PATH = "/redefinir-senha";
const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function normalizeOrigin(value: string | null | undefined): string {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
}

/**
 * Validate where password-recovery credentials will be delivered.
 * Production web redirects must match the configured canonical app origin and
 * the browser's Origin. Local HTTP is restricted to loopback addresses.
 */
export function validateRecoveryRedirect(
  request: Request,
  redirectTo: string,
  configuredPublicAppUrl: string,
): boolean {
  if (redirectTo === NATIVE_RECOVERY_REDIRECT) return true;

  let candidate: URL;
  try {
    candidate = new URL(redirectTo);
  } catch {
    return false;
  }

  if (
    candidate.username ||
    candidate.password ||
    candidate.pathname !== RECOVERY_PATH ||
    candidate.search ||
    candidate.hash
  ) {
    return false;
  }

  const requestOrigin = normalizeOrigin(request.headers.get("Origin"));
  if (!requestOrigin || candidate.origin !== requestOrigin) return false;

  const isLocalHttp =
    candidate.protocol === "http:" && LOCAL_HTTP_HOSTS.has(candidate.hostname);
  if (isLocalHttp) return true;
  if (candidate.protocol !== "https:") return false;

  const configuredOrigin = normalizeOrigin(configuredPublicAppUrl);
  if (!configuredOrigin || configuredOrigin !== requestOrigin) return false;

  return candidate.origin === configuredOrigin;
}
