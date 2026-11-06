export type AssistantApiSessionCheck =
  | { ok: true; authorization: string }
  | { ok: false; status: 401 | 503; error: string };

export async function verifyAssistantApiSession(
  request: Request,
  supabaseUrl: string,
  supabaseKey: string,
  fetcher: typeof fetch = fetch,
): Promise<AssistantApiSessionCheck> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Sessão inválida." };
  }

  if (!supabaseUrl || !supabaseKey) {
    return {
      ok: false,
      status: 503,
      error: "O serviço de autenticação está indisponível. Tente novamente.",
    };
  }

  let response: Response;
  try {
    response = await fetcher(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, Authorization: authorization },
    });
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Não foi possível validar sua sessão agora. Tente novamente.",
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: 401, error: "Sessão inválida." };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 503,
      error: "O serviço de autenticação está indisponível. Tente novamente.",
    };
  }

  const payload = await response.json().catch(() => null) as { id?: string } | null;
  if (!payload || typeof payload.id !== "string" || !payload.id.trim()) {
    return {
      ok: false,
      status: 503,
      error: "Não foi possível validar sua sessão agora. Tente novamente.",
    };
  }

  return { ok: true, authorization };
}
