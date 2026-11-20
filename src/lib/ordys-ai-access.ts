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

import {
  ORDYS_AI_ACCESS_POLICY_READY,
  ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE,
} from "./ordys-ai-access-shared";

/** Client-side preflight only; a future server endpoint must enforce the same policy. */
export function assertOrdysAiAccessPolicyReady(): void {
  if (!ORDYS_AI_ACCESS_POLICY_READY) {
    throw new Error(ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE);
  }
}
