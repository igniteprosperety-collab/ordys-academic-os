type EdgeFunctionFeature = "assistant" | "password-recovery" | "account-deletion";

const messages: Record<EdgeFunctionFeature, string> = {
  assistant: "O serviço do Assistente Ordys está temporariamente indisponível. Tente novamente mais tarde.",
  "password-recovery": "A recuperação de senha está temporariamente indisponível. Tente novamente mais tarde.",
  "account-deletion": "Não foi possível confirmar a exclusão da conta. Não repita a solicitação agora; tente novamente mais tarde.",
};

export function edgeFunctionUnavailableMessage(error: unknown, feature: EdgeFunctionFeature): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { name?: unknown; context?: unknown };
  const status = record.context && typeof record.context === "object"
    ? (record.context as { status?: unknown }).status
    : undefined;
  if (status === 400 || status === 401 || status === 403) return null;
  return record.name === "FunctionsFetchError" ||
    (typeof status === "number" && (status === 404 || status === 410 || status >= 500))
    ? messages[feature]
    : null;
}