import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

vi.mock("../src/lib/ordys-ai-access-shared", () => ({
  ORDYS_AGE_ASSURANCE_VERIFIED: false,
  ORDYS_GUARDIAN_CONSENT_POLICY_VERIFIED: false,
  ORDYS_AI_ACCESS_POLICY_READY: true,
  ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE: "A autorização ainda não foi implantada.",
  ORDYS_FREE_ASSIST_DAILY_LIMIT: 5,
  ORDYS_FREE_ASSIST_HOURLY_LIMIT: 2,
  ORDYS_PLUS_AI_ENABLED: false,
  ORDYS_PLUS_LOCK_MESSAGE: "Ordys Plus is not active.",
  ORDYS_PLUS_LOCK_SHORT_MESSAGE: "Disponível quando o Ordys Plus for ativado.",
}));

import {
  assertOrdysAiAccessPolicyReady,
  getOrdysAiAccessStatus,
} from "../src/lib/ordys-ai-access";

describe("per-account AI access status client", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the adult decision from the authenticated server endpoint", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        status: "completed",
        access: { allowed: true, tier: "adult", reason: "verified_adult" },
      },
      error: null,
    });

    await expect(getOrdysAiAccessStatus()).resolves.toEqual({
      allowed: true,
      tier: "adult",
      reason: "verified_adult",
      message: "",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ordys-assistant", {
      body: { action: "access-status" },
    });
  });

  it("allows a minor only when the server reports verified guardian consent", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        status: "completed",
        access: {
          allowed: true,
          tier: "minor_protected",
          reason: "verified_guardian_consent",
        },
      },
      error: null,
    });

    await expect(assertOrdysAiAccessPolicyReady()).resolves.toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("returns a user-facing reason when the server denies account access", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        status: "completed",
        access: {
          allowed: false,
          tier: "blocked",
          reason: "guardian_consent_required",
        },
      },
      error: null,
    });

    await expect(getOrdysAiAccessStatus()).resolves.toMatchObject({
      allowed: false,
      tier: "blocked",
      reason: "guardian_consent_required",
      message: "Esta conta precisa da autorização do responsável legal antes de usar os recursos de IA.",
    });
    await expect(assertOrdysAiAccessPolicyReady()).rejects.toThrow(
      "Esta conta precisa da autorização do responsável legal antes de usar os recursos de IA.",
    );
  });

  it("fails closed when the access endpoint is unavailable", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: new Error("network unavailable"),
    });

    await expect(getOrdysAiAccessStatus()).rejects.toThrow(
      "Não foi possível validar a autorização de IA. Tente novamente.",
    );
  });

  it("fails closed when the endpoint returns an incomplete contract", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: { status: "completed", access: { allowed: true, tier: "adult" } },
      error: null,
    });

    // A missing reason is normalized to a non-authorizing state.
    await expect(getOrdysAiAccessStatus()).resolves.toMatchObject({
      allowed: false,
      tier: "adult",
      reason: "assurance_missing",
    });
  });
});
