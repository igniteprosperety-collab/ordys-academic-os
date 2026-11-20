# Ordys AI access assurance — V1

**Product rule:** AI remains part of Ordys V1. The existing Assistant, generated quizzes, research/deep research, routine configuration, mind maps, attachment analysis, and entitled transcription paths are not being removed or replaced with placeholders.

## Runtime state

The global `ORDYS_AI_ACCESS_POLICY_READY` switch remains **false** until the assurance migration and Edge Function changes are deployed to the existing Lovable Cloud project and validated end to end. It is a rollout/kill switch, not the product eligibility rule.

When enabled, the authenticated server endpoint `ordys-assistant` action `access-status` evaluates the current user's server-owned `ordys_ai_access_assurance` row. The same policy is enforced inside every generation, quiz, transcription, polling, and result-delivery path. Cancellation remains available even after access is revoked. Failure to read the assurance record fails closed.

## Account states

- **Adult:** age band 18+, a current verified age-assurance status, trusted source, validity timestamps, current policy version, and opaque evidence reference.
- **Minor 14–17:** a current age-band signal plus a separate, explicit, current, revocable AI consent from a verified legal guardian; guardian identity and relationship must both be verified; the consent must be tied to the exact policy version.
- **Unknown, declared-only, expired, pending, denied, revoked, inconsistent, or unverifiable:** only the OpenAI calls for that account are blocked. The student core and local/non-AI functions remain available.
- **Under 14:** not enabled in this initial AI integration.

A profile birth date, timezone, self-attestation, local-storage flag, client-supplied boolean, or ordinary email verification is never sufficient evidence.

## Platform signal mapping

### Android / Google Play

Use the current Play Age Signals two-step flow: `requestAgeSignalsAccess()`, then `checkAgeSignals()`. For SDK 0.0.4+, read `ageRangeSource`, age bounds and significant-change status; do not rely on deprecated `userStatus`.

- `TIER_A`: self-declared. Not accepted as age assurance for OpenAI access.
- `TIER_B`: parent/guardian-managed age range. Maps only to `supervised`; it still requires a separate verified guardian consent for the specific AI data flow.
- `TIER_C`: estimated/assessed age. Not accepted as verified age evidence in this V1 policy.
- `TIER_D`: verified via ID check. Maps to verified age evidence after Play Integrity is verified server-side.
- Missing/unshared signals remain unknown and blocked.

Use Play Integrity with the native signal flow and verify its result on the server before trusting a submitted native signal. The API can return `TIER_A` outside regulated regions even when the lower bound is 18; never map that to `verified`. The mapping helper accepts only `TIER_D` as verified and `TIER_B` as supervised.

The platform's significant-change approval is not automatically interchangeable with the product's separate AI consent. Use it only if the platform configuration explicitly describes the AI data-processing change and the consent meaning is reviewed.

### Apple

For a future iOS client, support the Declared Age Range API and PermissionKit according to OS, region and sharing state. On iOS/iPadOS 26.5+, only `confirmed` maps to verified age evidence. `guardianDeclared` maps to supervised age evidence and still requires separate, verified guardian consent. `selfDeclared` does not grant access. Do not infer the verification method when Apple no longer returns it.

### Web and direct APK

Neither ordinary web sign-in nor a sideloaded APK automatically provides a trusted age signal. These channels require an independently validated age-assurance provider or another legally/technically acceptable verified method. Do not silently fall back to profile DOB.

## Guardian consent

The consent record must prove all of the following: the person is the legal guardian, that person affirmatively approved the specific AI use/data flow, the policy version shown, when consent was granted, and that consent remains unexpired and unrevoked.

A parent-managed Google account / Apple family relationship, a mailbox link, a student-entered guardian email, or a generic app-update approval is not automatically sufficient proof of explicit AI consent. The verification flow must establish the guardian's identity and legal relationship, without keeping raw ID images, document numbers, or unnecessary contact data in the Ordys database.

## Data and audit controls

- Evidence is stored as opaque provider references, not identity documents or raw provider payloads.
- The evidence table is inaccessible to `anon` and `authenticated`; only trusted server code can read/write it.
- The audit log is server-only and append-only for grant, denial, expiry, revocation and policy events.
- Context selection remains opt-in and per message. Only selected academic context is sent.
- Apply age-appropriate input/output filters, abuse/risk monitoring, reporting and escalation before opening access to minors.
- Keep OpenAI credentials server-side. Do not put provider secrets or proof payloads in the client, Vite variables, logs, or chat.

## Current implementation boundary

The current work adds the server decision contract, isolated assurance/audit schema, policy tests, Edge Function enforcement, result re-checks, and the client status display in separate review branches. It does **not** claim that age-provider attestation, guardian identity/relationship verification, consent capture, the remote migration, or Edge Function deployment is complete. The feature switch must remain false until those integrations and device/web acceptance tests are finished.

## Official references

- Google Play Age Signals: https://developer.android.com/google/play/age-signals/request-age-signals
- Google Play Age Signals response mapping: https://developer.android.com/google/play/age-signals/understand-age-signals-responses
- Google Play Age Signals release notes: https://developer.android.com/google/play/age-signals/release-notes
- Apple age assurance: https://developer.apple.com/br/support/age-assurance/
- OpenAI Under-18 API guidance: https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance
- ANPD age-assurance guidance: https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-orientacoes-preliminares-e-cronograma-para-afericao-de-idade-no-ambiente-digital
