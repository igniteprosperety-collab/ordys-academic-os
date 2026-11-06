/* eslint-disable @typescript-eslint/no-explicit-any */
import { stopDemoMode, getActiveLocalProfile, type LocalProfile, DEMO_USER_ID } from "@/lib/demo-mode";
import { supabase } from "@/integrations/supabase/client";

type AnyRow = Record<string, any>;
type Filter = { kind: "eq" | "neq" | "in" | "gte" | "lte" | "is"; column: string; value: any };
type Sort = { column: string; ascending: boolean; nullsFirst?: boolean };
type Result = { data: any; error: { message: string } | null; count?: number | null };

const STORAGE_PREFIX = "ordys_local_db_v3:";
const now = () => new Date().toISOString();
const uid = () => {
  try { return crypto.randomUUID(); } catch { return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
};

const TABLES = [
  "profiles","subjects","topics","tasks","subtasks","exams","grades","attendance_records","focus_sessions",
  "plan_sessions","reviews","goals","notifications","notification_preferences","subject_schedules",
  "calendar_events","daily_checkins","quiz_attempts","quiz_answers","calendar_connections","usage_events",
] as const;

function emptyStore(_profile: LocalProfile): Record<string, AnyRow[]> {
  return Object.fromEntries(
    TABLES.map((table) => [table, []]),
  ) as Record<string, AnyRow[]>;
}

function ensureProfile() {
  const profile = getActiveLocalProfile();
  if (profile) return profile;
  // Compatibility fallback for an already-active legacy demo flag.
  return { id: DEMO_USER_ID, name: "Aluno ORDYS", created_at: now(), updated_at: now() } satisfies LocalProfile;
}

function storageKey() {
  return `${STORAGE_PREFIX}${ensureProfile().id}`;
}

function readStore(): Record<string, AnyRow[]> {
  if (typeof window === "undefined") return emptyStore(ensureProfile());
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, AnyRow[]>;
      return parsed && typeof parsed === "object" ? parsed : emptyStore(ensureProfile());
    }
    const initial = emptyStore(ensureProfile());
    initial["profiles"] = [{
      id: ensureProfile().id,
      full_name: ensureProfile().name,
      stage: "medio",
      timezone: "America/Sao_Paulo",
      grade_scale_max: 10,
      grade_pass: 6,
      attendance_target: 75,
      weekly_study_target_minutes: 480,
      daily_load_limit_minutes: 240,
      created_at: ensureProfile().created_at,
      updated_at: ensureProfile().updated_at,
    }];
    initial["notification_preferences"] = [{
      id: uid(),
      user_id: ensureProfile().id,
      enabled: true,
      exams: true,
      tasks: true,
      overdue: true,
      classes: true,
      study_sessions: true,
      goals: true,
      daily_summary: true,
      weekly_summary: true,
      monthly_summary: false,
      created_at: now(),
      updated_at: now(),
    }];
    window.localStorage.setItem(storageKey(), JSON.stringify(initial));
    return initial;
  } catch {
    return emptyStore(ensureProfile());
  }
}

function writeStore(store: Record<string, AnyRow[]>) {
  if (typeof window !== "undefined") window.localStorage.setItem(storageKey(), JSON.stringify(store));
}

export function resetLocalStore() {
  const initial = emptyStore(ensureProfile());
  initial["profiles"] = [];
  initial["notification_preferences"] = [];
  writeStore(initial);
}

export function resetDemoStore() {
  resetLocalStore();
}

function compare(a: any, b: any) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a < b) return -1;
  return 1;
}

class DemoQuery implements PromiseLike<Result> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: AnyRow | AnyRow[] | null = null;
  private filters: Filter[] = [];
  private sorts: Sort[] = [];
  private take: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;
  private conflictColumns: string[] = [];

  constructor(private readonly table: string) {}

  select(_columns = "*") { return this; }
  eq(column: string, value: any) { this.filters.push({ kind: "eq", column, value }); return this; }
  neq(column: string, value: any) { this.filters.push({ kind: "neq", column, value }); return this; }
  in(column: string, value: any[]) { this.filters.push({ kind: "in", column, value }); return this; }
  gte(column: string, value: any) { this.filters.push({ kind: "gte", column, value }); return this; }
  lte(column: string, value: any) { this.filters.push({ kind: "lte", column, value }); return this; }
  is(column: string, value: any) { this.filters.push({ kind: "is", column, value }); return this; }
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const sort: Sort = { column, ascending: opts?.ascending !== false };
    if (opts?.nullsFirst !== undefined) sort.nullsFirst = opts.nullsFirst;
    this.sorts.push(sort);
    return this;
  }
  limit(n: number) { this.take = n; return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybeSingle"; return this; }
  insert(payload: AnyRow | AnyRow[]) { this.action = "insert"; this.payload = payload; return this; }
  update(payload: AnyRow) { this.action = "update"; this.payload = payload; return this; }
  delete() { this.action = "delete"; return this; }
  upsert(payload: AnyRow | AnyRow[], opts?: { onConflict?: string }) {
    this.action = "upsert";
    this.payload = payload;
    this.conflictColumns = (opts?.onConflict ?? "id").split(",").map((x) => x.trim()).filter(Boolean);
    return this;
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private matches(row: AnyRow) {
    return this.filters.every((f) => {
      const actual = row[f.column];
      switch (f.kind) {
        case "eq": return actual === f.value;
        case "neq": return actual !== f.value;
        case "in": return f.value.includes(actual);
        case "gte": return actual != null && actual >= f.value;
        case "lte": return actual != null && actual <= f.value;
        case "is": return f.value === null ? actual == null : actual === f.value;
      }
    });
  }

  private project(rows: AnyRow[]): Result {
    let out = rows.slice();
    for (const s of this.sorts) out.sort((a, b) => { const c = compare(a[s.column], b[s.column]); return s.ascending ? c : -c; });
    if (this.take != null) out = out.slice(0, this.take);
    if (this.singleMode === "single") {
      if (out.length !== 1) return { data: null, error: { message: out.length ? "Multiple rows returned" : "No rows returned" } };
      return { data: out[0], error: null };
    }
    if (this.singleMode === "maybeSingle") return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  private execute(): Result {
    const store = readStore();
    const rows = store[this.table] ?? [];

    if (this.action === "select") return this.project(rows.filter((r) => this.matches(r)));

    if (this.action === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const created = incoming.map((row) => ({
        id: row.id ?? uid(),
        created_at: row.created_at ?? now(),
        updated_at: row.updated_at ?? now(),
        ...row,
      }));
      store[this.table] = [...rows, ...created];
      writeStore(store);
      return this.singleMode ? this.project(created) : { data: created, error: null };
    }

    if (this.action === "update") {
      const updated: AnyRow[] = [];
      store[this.table] = rows.map((row) => {
        if (!this.matches(row)) return row;
        const next = { ...row, ...(this.payload ?? {}), updated_at: now() };
        updated.push(next);
        return next;
      });
      writeStore(store);
      return this.singleMode ? this.project(updated) : { data: updated, error: null };
    }

    if (this.action === "delete") {
      const deleted = rows.filter((row) => this.matches(row));
      store[this.table] = rows.filter((row) => !this.matches(row));
      writeStore(store);
      return { data: deleted, error: null };
    }

    const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((row) => ({
      id: row.id ?? uid(),
      created_at: row.created_at ?? now(),
      updated_at: row.updated_at ?? now(),
      ...row,
    }));
    const tableRows = store[this.table] ?? [];
    store[this.table] = tableRows;
    const output: AnyRow[] = [];
    for (const row of incoming) {
      const index = tableRows.findIndex((existing) =>
        this.conflictColumns.every((c) => existing[c] === row[c]),
      );
      const existing = index >= 0 ? tableRows[index] : undefined;
      if (existing !== undefined) {
        const next = { ...existing, ...row, updated_at: now() };
        tableRows[index] = next;
        output.push(next);
      } else {
        tableRows.push(row);
        output.push(row);
      }
    }
    writeStore(store);
    return this.singleMode ? this.project(output) : { data: output, error: null };
  }
}

export const demoSupabase = {
  from(table: string) {
    return new DemoQuery(table);
  },
};

export function getOrdysDataClient() {
  return demoSupabase;
}

let bridged = false;
export function installDemoSupabaseBridge() {
  if (bridged) return;
  const cloud = supabase as any;
  const originalFrom = cloud.from.bind(cloud);
  const originalSignOut = cloud.auth.signOut.bind(cloud.auth);
  cloud.from = (table: string) => isDemoBridgeActive() ? demoSupabase.from(table) : originalFrom(table);
  cloud.auth.signOut = async () => {
    if (isDemoBridgeActive()) {
      stopDemoMode();
      return { error: null };
    }
    return originalSignOut();
  };
  bridged = true;
}
function isDemoBridgeActive() {
  return typeof window !== "undefined" && window.localStorage.getItem("ordys_demo_mode") === "1";
}
