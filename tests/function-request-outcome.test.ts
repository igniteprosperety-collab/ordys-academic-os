import { describe, expect, it } from "vitest";
import { withAuthRequestTimeout, AuthRequestTimeoutError } from "@/lib/auth-request-timeout";
import { isInconclusiveFunctionRequestError } from "@/lib/function-request-outcome";

const httpError = (status: number) => ({ name: "FunctionsHttpError", context: new Response("{}", { status }) });

describe("withAuthRequestTimeout", () => {
  it("returns the value when the request finishes in time", async () => {
    await expect(withAuthRequestTimeout(async () => 7, 100)).resolves.toBe(7);
  });
  it("rejects with a timeout error when the request takes too long", async () => {
    await expect(withAuthRequestTimeout(() => new Promise(() => {}), 20)).rejects.toBeInstanceOf(AuthRequestTimeoutError);
  });
});

describe("isInconclusiveFunctionRequestError", () => {
  it("treats connection failures as inconclusive", () => {
    expect(isInconclusiveFunctionRequestError({ name: "FunctionsFetchError" })).toBe(true);
  });
  it("treats a client-side timeout as inconclusive", () => {
    expect(isInconclusiveFunctionRequestError(new AuthRequestTimeoutError())).toBe(true);
  });
  it("treats 500 and 504 as inconclusive", () => {
    expect(isInconclusiveFunctionRequestError(httpError(500))).toBe(true);
    expect(isInconclusiveFunctionRequestError(httpError(504))).toBe(true);
  });
  it("does not treat a missing function (404) as inconclusive", () => {
    expect(isInconclusiveFunctionRequestError(httpError(404))).toBe(false);
  });
  it("does not treat validation or permission errors as inconclusive", () => {
    for (const s of [400, 401, 403, 409]) expect(isInconclusiveFunctionRequestError(httpError(s))).toBe(false);
  });
});
