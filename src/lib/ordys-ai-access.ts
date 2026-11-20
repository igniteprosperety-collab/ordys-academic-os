import { supabase } from "@/integrations/supabase/client";
import {
  ORDYS_AI_ACCESS_POLICY_READY,
  ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE,
} from "./ordys-ai-access-shared";

export {
  ORDYS_AGE_ASSURANCE_VERIFIED,
  ORDYS_GUARDIAN_CONSENT_POLICY_VERIFIED,
  ORDYS_AI_ACCESS_POLICY_READY,
  ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE,
  ORDYS_FREE_ASSIST_DAILY_LIMIT,
  ORDYS_FREE_ASSIST_HOURLY_LIMIT,
  ORDYS_PLUS_AI_ENABLED,
  ORDYS_PLUS_LOCK_MESSAGE,
  ORDYS_PLUS_LOCK_SHORT_MESSAGE,
} from "./ordys-ai-access-shared";

export type OrdysAiAccessTier = "adult" | "minor_protected" | "blocked";

export type OrdysAiAccessStatus = {
  allowed: boolean;
  tier: OrdysAiAccessTier;
  reason: string;
  message: string;
};

function accessMessage(reason: string): string {
  switch (reason) {
    case "assurance_missing":
      return "Para usar os recursos de IA, o Ordys precisa confirmar a faixa etária desta conta.";
    case "age_band_unsupported":
      return "Esta faixa etária ainda não está habilitada para enviar dados à IA.";
    case "age_assurance_invalid":
      return "A confirmação de idade desta conta expirou ou não é válida. Atualize a verificação para continuar.";
    case "guardian_consent_required":
      return "Esta conta precisa da autorização do responsável legal antes de usar os recursos de IA.";
    case "guardian_consent_invalid":
      return "A autorização do responsável está ausente, expirada ou foi revogada.";
    case "policy_version_outdated":
      return "É necessário atualizar a autorização de IA desta conta para a política atual do Ordys.";
    default:
      return "Não foi possível confirmar a autorização de IA desta conta.";
  }
}

/**
 * Read the server-owned, per-account AI decision.
 *
 * The global switch is only a deployment gate: keep it closed until the
 * assurance migration and Edge Functions are deployed and the complete
 * verification flow has been validated. Once open, eligibility is decided
 * for the authenticated account by the server, never by profiles.birth_date.
 */
export async function getOrdysAiAccessStatus(): Promise<OrdysAiAccessStatus> {
  if (!ORDYS_AI_ACCESS_POLICY_READY) {
    return {
      allowed: false,
      tier: "blocked",
      reason: "policy_not_deployed",
      message: ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE,
    };
  }

  const { data, error } = await supabase.functions.invoke("ordys-assistant", {
    body: { action: "access-status" },
  });

  if (error) {
    throw new Error("Não foi possível validar a autorização de IA. Tente novamente.");
  }

  if (!data || typeof data !== "object") {
    throw new Error("O serviço de autorização de IA retornou uma resposta inválida.");
  }

  const payload = data as Record<string, unknown>;
  const rawAccess = payload["access"];
  if (payload["status"] !== "completed" || !rawAccess || typeof rawAccess !== "object") {
    throw new Error("O serviço de autorização de IA retornou uma resposta inválida.");
  }

  const access = rawAccess as Record<string, unknown>;
  const allowed = access["allowed"] === true;
  const tier =
    access["tier"] === "adult" || access["tier"] === "minor_protected"
      ? access["tier"]
      : "blocked";
  const reason = typeof access["reason"] === "string" ? access["reason"] : "assurance_missing";

  return {
    allowed: allowed && tier !== "blocked",
    tier,
    reason,
    message: allowed ? "" : accessMessage(reason),
  };
}

/** Client-side UX preflight. The Edge Function independently enforces this policy. */
export async function assertOrdysAiAccessPolicyReady(): Promise<void> {
  const access = await getOrdysAiAccessStatus();
  if (!access.allowed) throw new Error(access.message || accessMessage(access.reason));
}
