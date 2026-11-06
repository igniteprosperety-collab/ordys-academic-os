import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: mocks.signOut,
      getSession: mocks.getSession,
      getUser: mocks.getUser,
    },
  },
}));

import { signOutCurrentSession } from "../src/lib/ordys-session";

describe("Ordys session sign-out", () => {
  beforeEach(() => {
    mocks.signOut.mockReset();
    mocks.getSession.mockReset();
    mocks.getUser.mockReset();
  });

  it("ends only the current device session for ordinary logout", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(signOutCurrentSession()).resolves.toBeUndefined();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("accepts local cleanup after a network error when the session is cleared", async () => {
    mocks.signOut.mockRejectedValue(new Error("network unavailable"));
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(signOutCurrentSession()).resolves.toBeUndefined();
  });

  it("does not report local logout while a session remains active", async () => {
    const networkError = new Error("network unavailable");
    mocks.signOut.mockResolvedValue({ error: networkError });
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: "test-user" } } },
      error: null,
    });

    await expect(signOutCurrentSession()).rejects.toBe(networkError);
  });

  it("fails closed when local session state cannot be read", async () => {
    const readError = new Error("storage unavailable");
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: readError,
    });

    await expect(signOutCurrentSession()).rejects.toBe(readError);
  });

  it("revokes other sessions while preserving the current device session", async () => {
    const activeSession = { user: { id: "test-user" } };
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "test-user" } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getSession.mockResolvedValue({
      data: { session: activeSession },
      error: null,
    });

    await expect(signOutCurrentSession({ scope: "others" })).resolves.toBeUndefined();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });

  it("preserves the current session and allows retry when other-session revocation fails", async () => {
    const networkError = new Error("network unavailable");
    const activeSession = { user: { id: "test-user" } };
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "test-user" } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: networkError });
    mocks.getSession.mockResolvedValue({
      data: { session: activeSession },
      error: null,
    });

    await expect(signOutCurrentSession({ scope: "others" })).rejects.toBe(networkError);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });

  it("does not request other-session revocation when there is no current session", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(signOutCurrentSession({ scope: "others" })).rejects.toThrow(
      "Não há uma sessão ativa neste dispositivo",
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("does not treat an invalid server-side identity as a successful other-session revoke", async () => {
    const identityError = new Error("invalid JWT");
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: "test-user" } } },
      error: null,
    });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: identityError });

    await expect(signOutCurrentSession({ scope: "others" })).rejects.toBe(identityError);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
