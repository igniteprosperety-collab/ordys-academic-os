import type { User } from "@supabase/supabase-js";

export type LocalProfile = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_FLAG = "ordys_demo_mode";
const PROFILES_KEY = "ordys_local_profiles_v1";
const ACTIVE_PROFILE_KEY = "ordys_local_active_profile_v1";
const CHANGE_EVENT = "ordys-local-profile-changed";

const now = () => new Date().toISOString();

function randomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function isDemoMode() {
  return typeof window !== "undefined" && window.localStorage.getItem(DEMO_FLAG) === "1";
}

export function getLocalProfiles(): LocalProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    const rows = raw ? (JSON.parse(raw) as LocalProfile[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeProfiles(rows: LocalProfile[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROFILES_KEY, JSON.stringify(rows));
}

export function getActiveLocalProfileId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY);
}

export function getActiveLocalProfile(): LocalProfile | null {
  const profiles = getLocalProfiles();
  const id = getActiveLocalProfileId();
  return profiles.find((p) => p.id === id) ?? profiles[0] ?? null;
}

export function addLocalProfile(name: string): LocalProfile {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("Informe um nome.");
  const profile: LocalProfile = {
    id: randomId(),
    name: clean,
    created_at: now(),
    updated_at: now(),
  };
  const profiles = [...getLocalProfiles(), profile];
  writeProfiles(profiles);
  if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_PROFILE_KEY, profile.id);
  dispatchLocalChange();
  return profile;
}

export function updateLocalProfileName(name: string) {
  const active = getActiveLocalProfile();
  if (!active) throw new Error("Perfil local não encontrado.");
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("Informe um nome.");
  writeProfiles(
    getLocalProfiles().map((p) => (p.id === active.id ? { ...p, name: clean, updated_at: now() } : p)),
  );
  dispatchLocalChange();
}

export function switchLocalProfile(profileId: string) {
  const profiles = getLocalProfiles();
  if (!profiles.some((p) => p.id === profileId)) throw new Error("Perfil local não encontrado.");
  if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
  if (!isDemoMode()) startDemoMode();
  dispatchLocalChange();
}

export function removeLocalProfile(profileId: string) {
  const profiles = getLocalProfiles();
  if (profiles.length <= 1) throw new Error("Mantenha pelo menos um perfil local.");
  const targetExists = profiles.some((p) => p.id === profileId);
  if (!targetExists) throw new Error("Perfil local não encontrado.");
  const next = profiles.filter((p) => p.id !== profileId);
  writeProfiles(next);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(`ordys_local_db_v3:${profileId}`);
    if (getActiveLocalProfileId() === profileId) {
      window.localStorage.setItem(ACTIVE_PROFILE_KEY, next[0]!.id);
    }
  }
  dispatchLocalChange();
}

export function deleteLocalProfile(profileId: string) {
  const profiles = getLocalProfiles();
  if (!profiles.some((p) => p.id === profileId)) throw new Error("Perfil local não encontrado.");
  const next = profiles.filter((p) => p.id !== profileId);
  writeProfiles(next);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(`ordys_local_db_v3:${profileId}`);
    if (getActiveLocalProfileId() === profileId) {
      if (next.length) window.localStorage.setItem(ACTIVE_PROFILE_KEY, next[0]!.id);
      else window.localStorage.removeItem(ACTIVE_PROFILE_KEY);
    }
  }
  dispatchLocalChange();
}

export function startDemoMode(name?: string) {
  let active = getActiveLocalProfile();
  if (!active && name?.trim()) active = addLocalProfile(name);
  if (!active) throw new Error("Informe seu nome para criar o perfil local.");
  if (typeof window !== "undefined") window.localStorage.setItem(DEMO_FLAG, "1");
  dispatchLocalChange();
  return active;
}

export function stopDemoMode() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(DEMO_FLAG);
    dispatchLocalChange();
  }
}

export function dispatchLocalChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getDemoUser(): User {
  const profile = getActiveLocalProfile();
  const id = profile?.id ?? DEMO_USER_ID;
  const name = profile?.name ?? "Aluno ORDYS";
  const timestamp = profile?.updated_at ?? now();
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: `${id}@local.ordys`,
    email_confirmed_at: timestamp,
    phone: "",
    confirmed_at: timestamp,
    last_sign_in_at: timestamp,
    app_metadata: { provider: "local" },
    user_metadata: { full_name: name, provider: "local" },
    identities: [],
    created_at: profile?.created_at ?? timestamp,
    updated_at: timestamp,
  } as unknown as User;
}

export const LOCAL_PROFILE_CHANGE_EVENT = CHANGE_EVENT;
