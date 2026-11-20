/**
 * Ordys AI stays closed until the product has a trusted, server-verifiable
 * age/guardian policy and a deployed backend that enforces the same decision.
 *
 * profiles.birth_date is self-declared and editable by the account holder;
 * it must never be the sole authority for sending student data to an AI vendor.
 */
export const ORDYS_AGE_ASSURANCE_VERIFIED = false;
export const ORDYS_GUARDIAN_CONSENT_POLICY_VERIFIED = false;
export const ORDYS_AI_ACCESS_POLICY_READY =
  ORDYS_AGE_ASSURANCE_VERIFIED || ORDYS_GUARDIAN_CONSENT_POLICY_VERIFIED;

export const ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE =
  "Os recursos de IA estão temporariamente indisponíveis enquanto o Ordys conclui a verificação segura de idade e as proteções de dados dos estudantes.";

export const ORDYS_PLUS_AI_ENABLED = false;

export const ORDYS_FREE_ASSIST_HOURLY_LIMIT = 2;
export const ORDYS_FREE_ASSIST_DAILY_LIMIT = 5;

export const ORDYS_PLUS_LOCK_MESSAGE =
  "Este recurso avançado será liberado quando o Ordys Plus estiver ativo.";

export const ORDYS_PLUS_LOCK_SHORT_MESSAGE = "Disponível quando o Ordys Plus for ativado.";
