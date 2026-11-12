import { describe, expect, it } from "vitest";
import { edgeFunctionUnavailableMessage } from "../src/lib/edge-function-errors";

const messages = {
  assistant: "O serviço do Assistente Ordys está temporariamente indisponível. Tente novamente mais tarde.",
  "password-recovery": "A recuperação de senha está temporariamente indisponível. Tente novamente mais tarde.",
  "account-deletion": "Não foi possível confirmar a exclusão da conta. Não repita a solicitação agora; tente novamente mais tarde.",
} as const;

describe("edge function infrastructure errors", () => {
  for (const feature of ["assistant", "password-recovery", "account-deletion"] as const) {
    for (const status of [404, 410, 503]) {
      it(`${feature}: HTTP ${status} reports unavailability`, () => {
        expect(edgeFunctionUnavailableMessage({ context: { status } }, feature)).toBe(messages[feature]);
      });
    }
    it(`${feature}: FunctionsFetchError reports unavailability`, () => {
      expect(edgeFunctionUnavailableMessage({ name: "FunctionsFetchError" }, feature)).toBe(messages[feature]);
    });
  }

  for (const status of [400, 401, 403]) {
    it(`HTTP ${status} is not masked as unavailability`, () => {
      expect(edgeFunctionUnavailableMessage({ context: { status } }, "assistant")).toBeNull();
      expect(edgeFunctionUnavailableMessage({ name: "FunctionsFetchError", context: { status } }, "assistant")).toBeNull();
    });
  }

  it("ordinary errors and unknown values are not infrastructure failures", () => {
    for (const error of [new Error("ordinary failure"), null, undefined, "failure", {}, { context: { status: "503" } }]) {
      expect(edgeFunctionUnavailableMessage(error, "assistant")).toBeNull();
    }
  });

  it("all server failures starting at HTTP 500 report unavailability", () => {
    for (const status of [500, 502, 599]) {
      expect(edgeFunctionUnavailableMessage({ context: { status } }, "assistant")).toBe(messages.assistant);
    }
  });

  it("distinguishes the three features", () => {
    const actual = (["assistant", "password-recovery", "account-deletion"] as const)
      .map((feature) => edgeFunctionUnavailableMessage({ context: { status: 404 } }, feature));
    expect(new Set(actual).size).toBe(3);
  });
});