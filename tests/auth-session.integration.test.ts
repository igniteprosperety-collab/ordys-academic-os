import { afterAll, describe, expect, it } from "vitest";

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const ANON_KEY =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["SUPABASE_ANON_KEY"] ??
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  "";
const SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const enabled = Boolean(URL && ANON_KEY && SERVICE_ROLE_KEY);
const nonce = crypto.randomUUID().replaceAll("-", "");
const email = `ordys-auth-flow-${nonce}@example.invalid`;
const initialPassword = `Ordys-Auth-CI-${nonce}-A9!`;
const updatedPassword = `Ordys-Auth-Updated-${nonce}-B7!`;

type AuthUser = { id?: string; email?: string; email_confirmed_at?: string | null };
type AuthSession = AuthUser & {
  access_token?: string;
  refresh_token?: string;
  user?: AuthUser;
  msg?: string;
  message?: string;
  error_description?: string;
};

let userId = "";

function serviceHeaders(): HeadersInit {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

function publicHeaders(): HeadersInit {
  return { apikey: ANON_KEY, "Content-Type": "application/json" };
}

async function parseJson<T>(response: Response): Promise<T> {
  return await response.json().catch(() => ({})) as T;
}

async function signIn(password: string): Promise<Response> {
  return fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: publicHeaders(),
    body: JSON.stringify({ email, password }),
  });
}

describe.runIf(enabled)("Ordys Supabase Auth lifecycle", () => {
  afterAll(async () => {
    if (!userId) return;
    const deletion = await fetch(
      `${URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: serviceHeaders() },
    );
    if (!deletion.ok && deletion.status !== 404) {
      throw new Error(`Falha ao remover usuário temporário: HTTP ${deletion.status}`);
    }
  }, 30_000);

  it("signs up, creates the profile, authenticates, refreshes and changes the password", async () => {
    const signup = await fetch(`${URL}/auth/v1/signup`, {
      method: "POST",
      headers: publicHeaders(),
      body: JSON.stringify({
        email,
        password: initialPassword,
        data: { full_name: "ORDYS Auth Integration" },
      }),
    });
    const signupBody = await parseJson<AuthSession>(signup);
    expect(signup.ok, signupBody.msg ?? signupBody.message ?? "Signup failed.").toBe(true);
    const signupUser = signupBody.user ?? signupBody;
    expect(signupUser.id).toBeTruthy();
    userId = signupUser.id!;

    // Confirm only this disposable test account, without relying on SMTP.
    const confirmation = await fetch(
      `${URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "PUT",
        headers: serviceHeaders(),
        body: JSON.stringify({ email_confirm: true }),
      },
    );
    expect(confirmation.ok, await confirmation.clone().text()).toBe(true);

    const wrongPassword = await signIn(`${initialPassword}-wrong`);
    expect(wrongPassword.ok).toBe(false);

    const login = await signIn(initialPassword);
    const loginBody = await parseJson<AuthSession>(login);
    expect(login.ok, loginBody.msg ?? loginBody.message ?? "Password login failed.").toBe(true);
    expect(loginBody.user?.id).toBe(userId);
    expect(loginBody.access_token).toBeTruthy();
    expect(loginBody.refresh_token).toBeTruthy();

    const currentUser = await fetch(`${URL}/auth/v1/user`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${loginBody.access_token}`,
      },
    });
    const currentUserBody = await parseJson<AuthUser>(currentUser);
    expect(currentUser.ok, JSON.stringify(currentUserBody)).toBe(true);
    expect(currentUserBody.id).toBe(userId);
    expect(currentUserBody.email).toBe(email);

    const profile = await fetch(
      `${URL}/rest/v1/profiles?select=id&id=eq.${encodeURIComponent(userId)}`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${loginBody.access_token}`,
        },
      },
    );
    const profileRows = await parseJson<Array<{ id: string }>>(profile);
    expect(profile.ok, JSON.stringify(profileRows)).toBe(true);
    expect(profileRows).toMatchObject([{ id: userId }]);

    const refresh = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: publicHeaders(),
      body: JSON.stringify({ refresh_token: loginBody.refresh_token }),
    });
    const refreshed = await parseJson<AuthSession>(refresh);
    expect(refresh.ok, refreshed.msg ?? refreshed.message ?? "Refresh failed.").toBe(true);
    expect(refreshed.user?.id).toBe(userId);
    expect(refreshed.access_token).toBeTruthy();
    expect(refreshed.refresh_token).toBeTruthy();

    const passwordUpdate = await fetch(`${URL}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${refreshed.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: updatedPassword }),
    });
    expect(passwordUpdate.ok, await passwordUpdate.clone().text()).toBe(true);

    const oldPassword = await signIn(initialPassword);
    expect(oldPassword.ok).toBe(false);

    const newPassword = await signIn(updatedPassword);
    const newPasswordBody = await parseJson<AuthSession>(newPassword);
    expect(newPassword.ok, newPasswordBody.msg ?? newPasswordBody.message ?? "Updated password login failed.").toBe(true);
    expect(newPasswordBody.user?.id).toBe(userId);
    expect(newPasswordBody.access_token).toBeTruthy();
  }, 60_000);
});
