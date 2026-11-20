import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const client = readFileSync(
  new URL("../src/lib/ordys-assistant-client.ts", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../src/routes/assistente.tsx", import.meta.url), "utf8");
const shared = readFileSync(
  new URL("../src/lib/ordys-ai-access-shared.ts", import.meta.url),
  "utf8",
);

function functionBody(startMarker: string, endMarker?: string): string {
  const start = client.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing function: ${startMarker}`);
  const end = endMarker ? client.indexOf(endMarker, start + startMarker.length) : client.length;
  if (end < 0) throw new Error(`Missing end marker for: ${startMarker}`);
  return client.slice(start, end);
}

describe("Ordys AI client policy enforcement", () => {
  it("keeps the release gate disabled in source until trusted verification exists", () => {
    expect(shared).toContain("ORDYS_AGE_ASSURANCE_VERIFIED = false");
    expect(shared).toContain("ORDYS_GUARDIAN_CONSENT_POLICY_VERIFIED = false");
  });

  it.each([
    ["quiz", "export async function generateOrdysQuiz(", "function readFunctionResult("],
    [
      "video transcription",
      "async function transcribeOrdysVideo(",
      "export async function askOrdysAssistant(",
    ],
    [
      "assistant",
      "export async function askOrdysAssistant(",
      "export async function pollOrdysResearch(",
    ],
    [
      "research polling",
      "export async function pollOrdysResearch(",
      "export async function cancelOrdysResearch(",
    ],
    ["configuration", "export async function applyOrdysConfiguration(", undefined],
  ] as const)("checks the trusted policy before starting %s", (_name, start, end) => {
    const body = functionBody(start, end);
    const policyCheck = body.indexOf("assertOrdysAiAccessPolicyReady();");
    expect(policyCheck).toBeGreaterThanOrEqual(0);
    const markers = ["getAccessContext()", "supabase.functions.invoke("];
    const callPositions = markers.map((marker) => {
      const index = body.indexOf(marker);
      return index < 0 ? Number.POSITIVE_INFINITY : index;
    });
    const firstNetworkOrSessionCall = Math.min(...callPositions);
    expect(policyCheck).toBeLessThan(firstNetworkOrSessionCall);
  });

  it("allows cancellation of an existing research response while all new AI work is blocked", () => {
    const body = functionBody(
      "export async function cancelOrdysResearch(",
      "export async function applyOrdysConfiguration(",
    );
    expect(body).not.toContain("assertOrdysAiAccessPolicyReady();");
    expect(body).toContain('action: "cancel"');
  });

  it("disables the assistant controls and explains the policy without relying on profile birth date", () => {
    expect(page).toContain("!ORDYS_AI_ACCESS_POLICY_READY");
    expect(page).toContain("ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE");
    expect(page).toContain("aiUnavailable");
    expect(page).toContain("disabled={isDemo || aiUnavailable || busy || preparingFiles}");
  });
});
