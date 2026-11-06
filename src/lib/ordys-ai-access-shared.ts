/**
 * Temporary Ordys AI access policy while recurring billing is paused.
 *
 * Keep Plus features disabled until the billing entitlement is implemented and
 * checked server-side in every generation path, including the web quiz handler.
 * Never enable this flag merely because checkout UI exists.
 */
export const ORDYS_PLUS_AI_ENABLED = false;

export const ORDYS_FREE_ASSIST_HOURLY_LIMIT = 2;
export const ORDYS_FREE_ASSIST_DAILY_LIMIT = 5;

export const ORDYS_PLUS_LOCK_MESSAGE =
  "Este recurso avançado será liberado quando o Ordys Plus estiver ativo.";

export const ORDYS_PLUS_LOCK_SHORT_MESSAGE =
  "Disponível quando o Ordys Plus for ativado.";
