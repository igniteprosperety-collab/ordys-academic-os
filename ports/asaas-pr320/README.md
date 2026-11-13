# Asaas billing (PR #320, commit bcfd8c9) — archived, NOT deployed

Source: igniteprosperety-collab/ordys-academy.app PR #320, head bcfd8c9538c4d1e751d46a54922bdcd55e94808d.

- `edge-functions/` is a verbatim copy of the PR's Supabase Edge Functions. This project cannot create Edge Functions, so they are stored here and are never deployed. To go live, port each handler to a TanStack server route (`src/routes/api/public/asaas/*` for the webhook) or a `createServerFn`.
- `tests/` are the PR's billing tests, with imports pointed at `edge-functions/`. They are outside the default Vitest include on purpose.
- The migrations (all 46 from the PR tree, original names) are in `supabase/migrations/`. None were applied; 18 are already in the database ledger.
- Billing stays off: `billing_enabled = FALSE` and both plans have `enabled = FALSE` and `price_cents = NULL`. `ASAAS_ENVIRONMENT` must be `sandbox`.
- Plus is granted only by a confirmed-payment webhook, never by the checkout redirect. Plus/billing stays fail-closed until age assurance is solved (Issue #323); self-declared birth_date is not proof of age.
