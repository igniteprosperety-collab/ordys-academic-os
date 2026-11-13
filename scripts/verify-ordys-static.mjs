import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  findUnsafePublicDefaultPrivileges,
  findUnsafePublicTableGrants,
} from "./lib/migration-grant-audit.mjs";

const failures = [];
const root = process.cwd();

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    failures.push(`Não foi possível ler ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

function requireFile(path) {
  if (!existsSync(path)) failures.push(`Arquivo obrigatório ausente: ${path}`);
}

function requireIncludes(path, snippets) {
  const content = read(path);
  for (const snippet of snippets) {
    if (!content.includes(snippet)) failures.push(`${path} não contém: ${snippet}`);
  }
}

for (const icon of ["public/icon-192.png", "public/icon-512.png", "public/icon-512-maskable.png"]) {
  requireFile(icon);
}
requireFile("mobile/branding/ordys-launcher.webp");
const brandLockupSource = read("src/components/ordys/brand-lockup.tsx");
const shell = read("src/components/ordys/shell.tsx");
const canonicalBranding =
  brandLockupSource.includes('import officialLogo from "../../../mobile/branding/ordys-launcher.webp";') &&
  brandLockupSource.includes('import symbolLogo from "../../../mobile/branding/ordys-symbol.svg";') &&
  brandLockupSource.includes("src={compact ? symbolLogo : officialLogo}") &&
  brandLockupSource.includes('alt={compact ? "ORDYS" : "ORDYS ACADEMY"}');
if (!canonicalBranding) {
  failures.push("brand-lockup.tsx deve usar a marca oficial canônica");
}
if (!shell.includes("min-h-11 px-1 text-left sm:min-h-9")) {
  failures.push("Ações de notificação devem ter alvo de toque mobile de 44px");
}

for (const forbidden of ["ORDYS_OFFICIAL_LOGO", "@/lib/ordys-brand", "ordys-logo.webp", "ordys-icon.webp"]) {
  if (brandLockupSource.includes(forbidden)) {
    failures.push(`brand-lockup.tsx ainda contém ativo legado: ${forbidden}`);
  }
}

const authRoute = read("src/routes/auth.tsx");
if (authRoute.includes('<p className="text-[11px] font-semibold tracking-[0.18em] text-primary">ORDYS ACADEMY</p>')) {
  failures.push("auth.tsx não deve duplicar o lockup ORDYS ACADEMY já renderizado por OrdysBrandLockup");
}

const manifestText = read("public/manifest.webmanifest");
try {
  const manifest = JSON.parse(manifestText);
  if (manifest.name !== "Ordys Academy") failures.push("manifest.name deve ser Ordys Academy");
  if (manifest.id !== "/") failures.push("manifest.id deve ser /");
  if (manifest.start_url !== "/") failures.push("manifest.start_url deve apontar para /");
  if (manifest.theme_color !== "#0A1128") failures.push("manifest.theme_color deve ser #0A1128");
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const requiredIcons = [
    ["192x192", "any"],
    ["512x512", "any"],
    ["512x512", "maskable"],
  ];
  const expectedManifestIcons = [
    { src: "/icon-192.png", sizes: "192x192", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", purpose: "any" },
    { src: "/icon-512-maskable.png", sizes: "512x512", purpose: "maskable" },
  ];
  for (const expected of expectedManifestIcons) {
    if (
      !icons.some(
        (icon) =>
          icon?.src === expected.src &&
          icon?.sizes === expected.sizes &&
          icon?.purpose === expected.purpose,
      )
    ) {
      failures.push(
        `manifest não aponta ${expected.src} com sizes=${expected.sizes} e purpose=${expected.purpose}`,
      );
    }
  }
  if (manifest.display !== "standalone") failures.push("manifest.display deve ser standalone");
  if (manifest.lang !== "pt-BR") failures.push("manifest.lang deve ser pt-BR");
  if (manifest.scope !== "/") failures.push("manifest.scope deve apontar para /");
  if (manifest.orientation !== "portrait-primary") {
    failures.push("manifest.orientation deve ser portrait-primary");
  }
} catch (error) {
  failures.push(`manifest.webmanifest inválido: ${error instanceof Error ? error.message : String(error)}`);
}

const migrationDir = "supabase/migrations";

try {
  const migrationFiles = readdirSync(migrationDir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  const foreignKeys = new Map();
const constraints = new Map();


  for (const file of migrationFiles) {
    const content = readFileSync(migrationDir + "/" + file, "utf8");
    let table = "";
    let pendingConstraint = "";
    for (const line of content.split("\n")) {
      const tableMatch = line.match(/^ALTER TABLE public\.([a-zA-Z0-9_]+)/i);
      if (tableMatch) table = tableMatch[1];

      const addConstraintMatch = line.match(/ADD CONSTRAINT\s+([a-zA-Z0-9_]+)/i);
      if (addConstraintMatch && table) {
        const name = addConstraintMatch[1];
        const key = `${table}|${name}`;
        const previous = constraints.get(key);
        if (previous && !content.includes("DROP CONSTRAINT IF EXISTS " + name)) {
          failures.push("Migration " + file + " repete a constraint de " + previous.file + ": " + key);
        }
        constraints.set(key, { file });
      }
      const constraintMatch = line.match(/ADD CONSTRAINT\s+([a-zA-Z0-9_]+)/i);
      if (constraintMatch) pendingConstraint = constraintMatch[1];
      const fkMatch = line.match(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+public\.([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*(?:ON DELETE\s+([A-Z ]+))?/i);
      if (!fkMatch || !table) continue;
      const signature = [
        table,
        fkMatch[1].replace(/\s+/g, " ").trim(),
        fkMatch[2],
        fkMatch[3].replace(/\s+/g, " ").trim(),
        (fkMatch[4] || "").replace(/\s+/g, " ").trim(),
      ].join("|");
      const previous = foreignKeys.get(signature);
      if (previous && !content.includes("DROP CONSTRAINT IF EXISTS " + previous.constraint)) {
        failures.push("Migration " + file + " repete a mesma foreign key de " + previous.file + ": " + signature);
      }
      foreignKeys.set(signature, { file, constraint: pendingConstraint });
      pendingConstraint = "";
    }
  }
} catch (error) {
  failures.push("Não foi possível verificar as migrations de integridade: " + (error instanceof Error ? error.message : String(error)));
}

/**
 * New public tables must declare their Data API access explicitly.
 * Supabase's October 30, 2026 rollout no longer guarantees implicit grants
 * for newly created public tables. RLS and SQL privileges are independent:
 * require both a role-specific grant and an owner-scoped policy for app tables.
 */
try {
  const migrationFiles = readdirSync(migrationDir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  const migrationSources = migrationFiles.map((file) => ({
    file,
    source: readFileSync(migrationDir + "/" + file, "utf8"),
  }));
  const allMigrationSource = migrationSources.map(({ source }) => source).join("\n");

  for (const { file, source } of migrationSources) {
    for (const finding of findUnsafePublicTableGrants(source)) {
      failures.push(
        `Migration ${file} grants structural or blanket table privileges to a client role: ${finding.statement}`,
      );
    }
    for (const finding of findUnsafePublicDefaultPrivileges(source)) {
      failures.push(
        `Migration ${file} grants default ${finding.objectType} privileges to a client role: ${finding.statement}`,
      );
    }
  }
  const createdPublicTables = new Map();

  for (const { file, source } of migrationSources) {
    for (const match of source.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)/gi,
    )) {
      const table = match[1];
      if (!createdPublicTables.has(table)) createdPublicTables.set(table, file);
    }
  }

  for (const [table, createdIn] of createdPublicTables) {
    const escapedTable = table;
    const tableTarget = "(?:TABLE\\s+)?public\\." + escapedTable + "\\b";
    const serviceRoleGrant = new RegExp(
      "\\bGRANT\\s+(?:ALL|[A-Z]+(?:\\s*,\\s*[A-Z]+)*)\\s+ON\\s+" +
        tableTarget + "\\s+TO\\s+service_role\\s*;",
      "i",
    ).test(allMigrationSource);
    const authenticatedGrant = new RegExp(
      "\\bGRANT\\s+(?:ALL|SELECT\\s*,\\s*INSERT\\s*,\\s*UPDATE\\s*,\\s*DELETE)\\s+ON\\s+" +
        tableTarget + "\\s+TO\\s+authenticated\\s*;",
      "i",
    ).test(allMigrationSource);
    const clientRolesRevoked = new RegExp(
      "\\bREVOKE\\s+ALL\\s+ON\\s+" + tableTarget +
        "\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*;",
      "i",
    ).test(allMigrationSource);
    const rlsEnabled = new RegExp(
      "\\bALTER\\s+TABLE\\s+public\\." + escapedTable +
        "\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;",
      "i",
    ).test(allMigrationSource);
    const ownerColumn = table === "profiles" ? "id" : "user_id";
    const ownerScopedPolicy = [
      ...allMigrationSource.matchAll(
        new RegExp(
          "\\bCREATE\\s+POLICY\\b[^;]*?\\bON\\s+public\\." +
            escapedTable + "\\b[^;]*;",
          "gi",
        ),
      ),
    ].some(([policy]) => {
      const hasOwnerPredicate = (expression) =>
        new RegExp(
          "\\bauth\\.uid\\s*\\(\\s*\\)\\s*=\\s*" + ownerColumn + "\\b",
          "i",
        ).test(expression);
      const usingClause = policy.match(/\bUSING\s*\([\s\S]*$/i)?.[0] ?? "";
      const checkClause = policy.match(/\bWITH\s+CHECK\s*\([\s\S]*$/i)?.[0] ?? "";
      return (
        /\bTO\s+authenticated\b/i.test(policy) &&
        hasOwnerPredicate(usingClause) &&
        hasOwnerPredicate(checkClause)
      );
    });
    const anonymousGrant = new RegExp(
      "\\bGRANT\\b[^;]*\\bON\\s+" + tableTarget + "\\s+TO\\s+anon\\b",
      "i",
    ).test(allMigrationSource);

    if (!serviceRoleGrant) {
      failures.push(
        "Migration " + createdIn + ": public." + table +
          " precisa de GRANT explícito para service_role.",
      );
    }
    if (!rlsEnabled) {
      failures.push("Migration " + createdIn + ": public." + table + " precisa habilitar RLS.");
    }
    if (anonymousGrant) {
      failures.push(
        "Migration " + createdIn + ": public." + table +
          " não pode conceder acesso direto a anon sem revisão explícita.",
      );
    }

    if (clientRolesRevoked) {
      // Internal/server-only table: no Data API grants for user-facing roles.
      continue;
    }

    if (!authenticatedGrant) {
      failures.push(
        "Migration " + createdIn + ": public." + table +
          " precisa declarar GRANT explícito para authenticated ou revogar os papéis clientes como tabela interna.",
      );
    }
    if (!ownerScopedPolicy) {
      failures.push(
        "Migration " + createdIn + ": public." + table +
          " precisa de policy para authenticated com escopo auth.uid().",
      );
    }
  }
} catch (error) {
  failures.push(
    "Não foi possível verificar os grants e políticas das tabelas públicas: " +
      (error instanceof Error ? error.message : String(error)),
  );
}

const baseSchema = read("supabase/migrations/20260814212706_7d997b1c-8901-4617-8850-9b7f79519157.sql");
const baseTables = [...baseSchema.matchAll(/CREATE TABLE public\.([a-zA-Z0-9_]+)/g)].map((match) => match[1]);
const retentionDeletion = read("supabase/migrations/20260926073000_profile_validation_and_retention.sql");
for (const table of baseTables) {
  if (!retentionDeletion.includes(`DELETE FROM public.${table}`)) {
    failures.push(`Exclusão de conta não remove explicitamente a tabela base: ${table}`);
  }
}
for (const table of ["assistant_jobs", "usage_events"]) {
  if (!retentionDeletion.includes(`DELETE FROM public.${table}`)) {
    failures.push(`Exclusão de conta não contempla a tabela interna esperada: ${table}`);
  }
}

const rlsTables = new Set([...baseSchema.matchAll(/ALTER TABLE public\.([a-zA-Z0-9_]+)\s+ENABLE ROW LEVEL SECURITY/gi)].map((match) => match[1]));
const policyLines = baseSchema.split("\n").filter((line) => /CREATE POLICY /i.test(line));
for (const table of baseTables) {
  if (!rlsTables.has(table)) failures.push(`Tabela base sem RLS: ${table}`);
  const policiesForTable = policyLines.filter((line) => new RegExp(`ON public\\.${table}\\b`, "i").test(line));
  if (!policiesForTable.length) failures.push(`Tabela base sem policy: ${table}`);
  if (policiesForTable.some((line) => !line.includes("auth.uid()"))) {
    failures.push(`Tabela base possui policy sem escopo explícito de sessão: ${table}`);
  }
}

const serverSource = read("src/server.ts");
if (!serverSource.includes("if (response.status >= 500)")) {
  failures.push("server.ts deve aplicar ERROR_CSP somente às respostas de erro");
}
if (/headers\.set\("Content-Security-Policy", ERROR_CSP\);\s*\n\s*headers\.set\("X-Content-Type-Options"/.test(serverSource)) {
  failures.push("server.ts não pode aplicar ERROR_CSP incondicionalmente às respostas normais");
}

const ownershipMigration = read("supabase/migrations/20260818093519_5e1aeded-54c4-456d-9c26-e7da5463940e.sql");
for (const expected of [
  "CREATE OR REPLACE FUNCTION public.prevent_owner_change()",
  "CREATE OR REPLACE FUNCTION public.enforce_same_owner_refs()",
  "SECURITY DEFINER SET search_path = public",
  "DROP TRIGGER IF EXISTS tasks_refs_guard ON public.tasks;",
  "DROP TRIGGER IF EXISTS topics_refs_guard ON public.topics;",
  "DROP TRIGGER IF EXISTS exams_refs_guard ON public.exams;",
  "DROP TRIGGER IF EXISTS grades_refs_guard ON public.grades;",
  "DROP TRIGGER IF EXISTS schedules_refs_guard ON public.subject_schedules;",
  "DROP TRIGGER IF EXISTS plan_refs_guard ON public.plan_sessions;",
  "DROP TRIGGER IF EXISTS reviews_refs_guard ON public.reviews;",
  "DROP TRIGGER IF EXISTS goals_refs_guard ON public.goals;",
  "DROP TRIGGER IF EXISTS events_refs_guard ON public.calendar_events;",
  "DROP TRIGGER IF EXISTS checkins_refs_guard ON public.daily_checkins;",
  "DROP TRIGGER IF EXISTS attempts_refs_guard ON public.quiz_attempts;",
  "DROP TRIGGER IF EXISTS answers_refs_guard ON public.quiz_answers;",
]) {
  if (!ownershipMigration.includes(expected)) failures.push(`Migration de ownership perdeu proteção esperada: ${expected}`);
}

const securityMigrations = [
  {
    path: "supabase/migrations/20260926074000_rate_limit_service_identity.sql",
    required: [
      "SECURITY DEFINER",
      "SET search_path = public",
      "REVOKE ALL ON FUNCTION public.consume_usage_limit(UUID, TEXT, INT, INT)",
      "GRANT EXECUTE ON FUNCTION public.consume_usage_limit(UUID, TEXT, INT, INT)",
      "TO service_role;",
    ],
  },
  {
    path: "supabase/migrations/20260926083000_remove_recovery_enumeration_timing.sql",
    required: [
      "SECURITY DEFINER",
      "SET search_path = pg_catalog, public, extensions",
      "REVOKE ALL ON FUNCTION public.can_request_password_recovery(TEXT)",
      "GRANT EXECUTE ON FUNCTION public.can_request_password_recovery(TEXT)\n  TO service_role",
    ],
    forbidden: ["auth.users"],
  },
  {
    path: "supabase/migrations/20260926073000_profile_validation_and_retention.sql",
    required: [
      "SECURITY DEFINER",
      "SET search_path = pg_catalog, public, auth",
      "REVOKE ALL ON FUNCTION public.delete_own_data()",
      "GRANT EXECUTE ON FUNCTION public.delete_own_data() TO authenticated",
    ],
  },
  {
    path: "supabase/migrations/20260927024000_harden_new_user_profile_name.sql",
    required: [
      "SECURITY DEFINER",
      "SET search_path = pg_catalog, public",
      "candidate := left(candidate, 120);",
    ],
  },
  {
    path: "supabase/migrations/20261029232900_delete_recovery_hash_on_account_deletion.sql",
    required: [
      "INSERT INTO public.password_recovery_attempts (email_hash)",
      "SECURITY DEFINER",
      "SET search_path = pg_catalog, public, extensions",
      "REVOKE ALL ON FUNCTION public.can_request_password_recovery(TEXT)",
      "GRANT EXECUTE ON FUNCTION public.can_request_password_recovery(TEXT)",
      "IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;",
      "normalized_email IS NOT NULL AND normalized_email <> ''",
      "DELETE FROM public.password_recovery_attempts",
      "email_hash = encode(digest(normalized_email, 'sha256'), 'hex')",
      "REVOKE ALL ON FUNCTION public.delete_own_data() FROM PUBLIC, anon",
      "GRANT EXECUTE ON FUNCTION public.delete_own_data() TO authenticated",
    ],
    forbidden: [
      "ADD COLUMN IF NOT EXISTS user_id uuid",
      "SELECT account.id",
      "INSERT INTO public.password_recovery_attempts (email_hash, user_id)",
      "TRUNCATE public.password_recovery_attempts",
      "DROP TABLE public.password_recovery_attempts",
      "'exists', matched_user_id",
      "'exists', false",
      "'exists', matched_user_id IS NOT NULL",
    ],
  },
  {
    path: "supabase/migrations/20261031050000_revoke_public_trigger_function_execution.sql",
    required: [
      "FROM pg_trigger AS t",
      "p.prorettype = 'trigger'::regtype",
      "REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated",
      "has_function_privilege('anon', p.oid, 'EXECUTE')",
      "has_function_privilege('authenticated', p.oid, 'EXECUTE')",
    ],
  },
  {
    path: "supabase/migrations/20260927020000_goal_integrity.sql",
    required: [
      "ALTER TABLE public.goals",
      "ALTER COLUMN metric SET DEFAULT 'horas_estudo'",
      "ALTER COLUMN period SET DEFAULT 'semanal'",
    ],
  },
];
for (const guard of securityMigrations) {
  const source = read(guard.path);
  for (const expected of guard.required) {
    if (!source.includes(expected)) failures.push(`${guard.path} perdeu hardening esperado: ${expected}`);
  }
  for (const forbidden of guard.forbidden ?? []) {
    if (source.includes(forbidden)) failures.push(`${guard.path} contém referência proibida: ${forbidden}`);
  }
}

const recoveryCleanupMigration = read("supabase/migrations/20261029232900_delete_recovery_hash_on_account_deletion.sql");
const recoveryRpcStart = recoveryCleanupMigration.indexOf("CREATE OR REPLACE FUNCTION public.can_request_password_recovery");
const recoveryRpcEnd = recoveryCleanupMigration.indexOf("$ordys$;", recoveryRpcStart);
const recoveryRpcSource = recoveryRpcStart >= 0 && recoveryRpcEnd > recoveryRpcStart
  ? recoveryCleanupMigration.slice(recoveryRpcStart, recoveryRpcEnd)
  : "";
const recentLimitPosition = recoveryRpcSource.indexOf("IF recent_count >= 3");
const dailyLimitPosition = recoveryRpcSource.indexOf("IF daily_count >= 10");
const recoveryAttemptInsertPosition = recoveryRpcSource.indexOf("INSERT INTO public.password_recovery_attempts (email_hash)");
if (
  !recoveryRpcSource ||
  recoveryRpcSource.includes("FROM auth.users") ||
  recoveryRpcSource.includes("matched_user_id") ||
  recentLimitPosition < 0 ||
  dailyLimitPosition < 0 ||
  recoveryAttemptInsertPosition < 0 ||
  !(recentLimitPosition < recoveryAttemptInsertPosition &&
    dailyLimitPosition < recoveryAttemptInsertPosition)
) {
  failures.push("Recovery RPC deve limitar por hash sem consultar auth.users nem revelar se a conta existe.");
}
const deleteOwnDataStart = recoveryCleanupMigration.indexOf("CREATE OR REPLACE FUNCTION public.delete_own_data()");
const deleteOwnDataEnd = recoveryCleanupMigration.indexOf("$ordys$;", deleteOwnDataStart);
const deleteOwnDataSource = deleteOwnDataStart >= 0 && deleteOwnDataEnd > deleteOwnDataStart
  ? recoveryCleanupMigration.slice(deleteOwnDataStart, deleteOwnDataEnd)
  : "";
if (
  !deleteOwnDataSource.includes("auth.uid()") ||
  !deleteOwnDataSource.includes("email_hash = encode(digest(normalized_email, 'sha256'), 'hex')")
) {
  failures.push("Exclusão de conta deve remover o hash da solicitação de recuperação do endereço atual do próprio usuário.");
}

requireIncludes("src/routes/agenda.tsx", [
  "function openMonthItem(item: Item, day: Date)",
  "onClick={() => openMonthItem(it, day)}",
]);

requireIncludes("src/routes/agenda.tsx", [
  "const targetWeek = startOfWeek(target);",
  "const weekOffset = Math.round((targetWeek.getTime() - baseWeek.getTime()) / (7 * 86400000));",
]);

const agendaSource = read("src/routes/agenda.tsx");
const mobileMonthStart = agendaSource.indexOf('monthDays.filter((day) => day.getMonth() === monthStart.getMonth()');
const mobileMonthEnd = agendaSource.indexOf('{active === "Semana" ?', mobileMonthStart);
if (mobileMonthStart >= 0 && mobileMonthEnd > mobileMonthStart) {
  const mobileMonth = agendaSource.slice(mobileMonthStart, mobileMonthEnd);
  if (mobileMonth.includes("onClick={() => openItem(it, i)}")) {
    failures.push("agenda.tsx usa índice i fora de escopo na lista mobile do mês");
  }
  if (!mobileMonth.includes("onClick={() => openMonthItem(it, day)}")) {
    failures.push("agenda.tsx deve abrir o dia correto ao tocar em atividade na visão mensal mobile");
  }
}
if (agendaSource.includes('onClick={() => openSubject(e.subject_id)}') || agendaSource.includes('onClick={() => openSubject(t.subject_id)}')) {
  failures.push("agenda.tsx mantém ações que ficam sem efeito quando a atividade não possui disciplina");
}

requireIncludes("src/routes/agenda.tsx", [
  "useProfile,",
  "const { data: profile } = useProfile();",
]);

requireIncludes("src/components/ordys/quick-capture.tsx", [
  "const parsedWhen = when ? new Date(when) : null;",
  'if (kind === "tarefa" && numericValue !== null && (numericValue < 0 || numericValue > 1440))',
  'if (kind === "sessao" && numericValue !== null && (numericValue < 5 || numericValue > 1440))',
  'if (kind === "nota" && numericValue !== null && numericValue < 0)',
]);

requireIncludes("src/components/ordys/form.tsx", [
  'const control =\n  "w-full min-h-11 rounded-md border border-border bg-secondary/40',
]);
requireIncludes("src/components/ordys/form.tsx", [
  'className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground sm:size-8"',
]);


requireIncludes("src/routes/assistente.tsx", [
  "isLoading: profileLoading, error: profileError",
  "const profileFailed = Boolean(profileError) && !profile;",
  "Validando sua conta e carregando seu perfil. Tente novamente em instantes.",
  "if (!configuration || applyingConfig || configuration.questions.length || profileLoading || profileFailed || !aiEligibility.allowed) return;",
  "!profileLoading && !profileFailed && !aiEligibility.allowed",
  "disabled={isDemo || aiUnavailable}",
]);
requireIncludes("src/routes/simulado.tsx", [
  "className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12px] transition-colors",
]);

requireIncludes("src/routes/simulado.tsx", [
  "const quizInProgress = questions.length > 0 && !finished;",
  "const [activeQuiz, setActiveQuiz] = useState<{",
  "<Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={loading || quizInProgress}>",
  "<Select value={count} onChange={(e) => setCount(e.target.value)} disabled={loading || quizInProgress}>",
  "disabled={isDemo || !ORDYS_PLUS_AI_ENABLED || !subjectId || loading || quizInProgress}",
  "subject_id: activeQuiz.subjectId,",
  "difficulty: activeQuiz.difficulty,",
  "const { data: topicRows, error: topicsError } = await supabase",
  "topic_id: (topicRows ?? []).find((topic) => topic.title === q.topic)?.id ?? null,",
]);
requireIncludes("src/routes/perfil.tsx", [
  'className="grid size-11 shrink-0 place-items-center rounded-full"',
  'className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-primary" : "bg-secondary"}`}',
  'billingOverview.subscription.status === "suspended"',
  'billingOverview.subscription.status === "active" && !billingOverview.subscription.hasAccess',
  '["pending", "active", "past_due", "suspended"].includes(billingOverview.subscription?.status ?? "")',
]);

requireIncludes("src/routes/excluir-conta.tsx", [
  'supabase.functions.invoke("ordys-delete-account", { body: {} })',
  "if (isDemo || isDemoMode())",
  "if (accountDeleted) {",
  "setAccountDeletedNeedsRestart(true);",
  "Tentar encerrar sessão",
]);

requireIncludes("src/routes/disciplinas.tsx", [
  "const primarySchedule = existingSchedules[0];",
  "Horários adicionais desta disciplina são preservados ao editar.",
  "await remove(\"subject_schedules\", existingSchedules[0]!.id);",
]);

requireIncludes("src/routes/disciplinas.tsx", [
  'className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-1.5',
  'className={`-mb-px min-h-11 shrink-0 border-b px-3 py-2',
]);
requireIncludes("src/routes/estudos.tsx", [
  'className={`min-h-11 rounded-lg border px-3 py-1.5',
]);


requireIncludes("src/server.ts", [
  'headers.set("Content-Security-Policy", ERROR_CSP)',
  'headers.set("X-Content-Type-Options", "nosniff")',
  'headers.set("X-Frame-Options", "DENY")',
  'headers.set("Referrer-Policy", "strict-origin-when-cross-origin")',
  'headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")',
  'headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")',
  'headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups")',
]);
requireIncludes("src/start.ts", [
  'function requestHasPrivateAuth(request: Request)',
  'headers.set("X-Permitted-Cross-Domain-Policies", "none")',
  'headers.set("Cache-Control", "private, no-store")',
  'headers.append("Vary", "Cookie")',
  'headers.append("Vary", "Authorization")',
  'requestMiddleware: [securityHeadersMiddleware, errorMiddleware, csrfMiddleware]',
]);

requireIncludes("src/start.ts", [
  'headers.set("X-Content-Type-Options", "nosniff")',
  'if (isProduction) {',
  'headers.set("X-Frame-Options", "DENY");',
  'headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")',
  'headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")',
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "`script-src 'self' 'unsafe-inline'${isProduction ? '' : \" 'unsafe-eval'\"}`",
  'headers.set("Content-Security-Policy", CSP)',
]);
requireIncludes("src/routes/perfil.tsx", [
  "O nome deve ter no máximo 120 caracteres.",
  "Informe um fuso horário válido.",
  "Informe uma data de nascimento entre 01/01/1900 e hoje.",
  "const cleanProfile = {",
  "const maxLengths: Record<string, number>",
  "Excluir conta e dados",
  "Integração desconectada.",
]);

requireIncludes("src/routes/perfil.tsx", [
  'import { calculateAgeInTimeZone } from "@/lib/ai-eligibility";',
  "const derivedAge = calculateAgeInTimeZone(form.birth_date, form.timezone);",
]);

requireIncludes("src/lib/native-notifications.ts", [
  'export const nativeNotificationsDisabled =',
  "// Do not trigger a permission prompt at app startup.",
  "getNativeNotificationPermission",
]);
const nativeNotificationsSource = read("src/lib/native-notifications.ts");
if (
  !nativeNotificationsSource.includes('import.meta.env.VITE_ORDYS_DISABLE_NATIVE_NOTIFICATIONS === "1"') &&
  !nativeNotificationsSource.includes('import.meta.env["VITE_ORDYS_DISABLE_NATIVE_NOTIFICATIONS"] === "1"')
) {
  failures.push("native-notifications.ts deve respeitar o flag de desativação para builds direct-install");
}
requireIncludes("vite.mobile.config.ts", [
  'const disableNativeNotifications =',
  'process.env["VITE_ORDYS_DISABLE_NATIVE_NOTIFICATIONS"] !== "0"',
  'JSON.stringify(disableNativeNotifications ? "1" : "0")',
]);
requireIncludes("scripts/configure-ordys-notification-manifest.py", [
  'profile not in {"sideload", "play"}',
  'notification_permissions = {',
  '"POST_NOTIFICATIONS"',
  '"RECEIVE_BOOT_COMPLETED"',
  '"WAKE_LOCK"',
  'exact_alarm_permissions = {"SCHEDULE_EXACT_ALARM", "USE_EXACT_ALARM"}',
  'if profile == "play":',
  'elif removal not in text:',
  'tools:node="remove"',
]);
requireIncludes("src/routes/perfil.tsx", [
  "isNativeAndroid() && nativeNotificationsDisabled",
  "Notificações programadas indisponíveis",
  "getNativeNotificationPermission",
  "Notificações do dispositivo",
  "a permissão só é solicitada quando você toca em Ativar",
]);
requireIncludes("src/lib/native-notifications.ts", [
  "const NOTIFICATION_IDS = { exam: 100000, task: 200000, study: 300000, class: 400000, summary: 500000 };",
  "return prefix + ((hash >>> 0) % 90000);",
  "NOTIFICATION_IDS.summary, `summary-day:",
  "NOTIFICATION_IDS.summary, `summary-week:",
  "NOTIFICATION_IDS.summary, `summary-month:",
]);
requireIncludes("src/lib/native-notifications.ts", [
  "!Number.isFinite(params.at.getTime())",
  "if (!Number.isFinite(examDate.getTime())) return [];",
  "if (!Number.isFinite(due.getTime())) return [];",
  "!parsedTime ||",
  "!Number.isInteger(parsedTime.hour)",
  "!Number.isInteger(parsedTime.minute)",
  "parsedTime.hour < 0",
  "parsedTime.hour > 23",
  "parsedTime.minute < 0",
  "parsedTime.minute > 59",
]);
requireIncludes("src/lib/ordys-engine.ts", [
  "export function parseTimeOfDay(value: string | null | undefined)",
  "if (hourText === undefined || minuteText === undefined) return null;",
  "if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;",
]);

requireIncludes("src/lib/native-notifications.ts", [
  '.order("session_date").order("start_time").limit(120)',
  '.order("weekday").order("start_time").limit(100)',
  'if (session.status !== "planejada" || !session.start_time) return [];',
]);

requireIncludes("src/lib/native-notifications.ts", [
  '{ days: 3, label: "em 3 dias" }',
  '{ days: 1, label: "amanhã" }',
  '{ days: 0, label: "hoje" }',
  'const label = daysBefore === 0 ? "prazo hoje" : "prazo amanhã";',
  'if (days === 0)',
  'examDate.getTime() - 60 * 60 * 1000',
  'daily_summary: boolean;',
  'weekly_summary: boolean;',
  'monthly_summary: boolean;',
  'Resumo diário',
  'Resumo semanal',
  'Resumo mensal',
]);


requireIncludes("src/lib/ordys-db.ts", [
  '.eq("user_id", userId)',
  'const { user_id: _ignoredUserId, ...safeValues } = values;',
  'onConflict: "user_id"',
]);

requireIncludes("src/lib/ordys-engine.test.ts", [
  "returns null for invalid deadline dates",
  "expect(daysUntil(\"not-a-date\")).toBeNull()",
]);
requireIncludes("src/lib/ordys-engine.test.ts", [
  "ignores invalid grade rows in summaries and subject averages",
  "const invalid = { ...grade, id: \"grade-invalid\", max_score: 0, weight: 0 };",
]);

const engineTests = read("src/lib/ordys-engine.test.ts");
for (const expected of [
  "buildNotificationRules",
  "creates the daily academic summary",
  "does not create summary notifications",
  "vi.useFakeTimers()",
]) {
  if (!engineTests.includes(expected)) failures.push(`Testes do engine de notificações não contêm: ${expected}`);
}

const engineSource = read("src/lib/ordys-engine.ts");
if (engineSource.includes("supabase.from(")) {
  failures.push("src/lib/ordys-engine.ts não deve acessar supabase.from() diretamente; use dataClient()");
}
requireIncludes("src/lib/ordys-engine.ts", [
  'import { getActiveLocalProfileId, isDemoMode } from "@/lib/demo-mode";',
  "Automatic review generation can run after the user switches local profiles.",
  "if (isDemoMode() && getActiveLocalProfileId() !== userId) return 0;",
]);

requireIncludes("src/lib/ordys-engine.ts", [
  "function dataClient()",
  '.eq("user_id", input.userId)',
  '.from("notifications")',
  "daily_summary",
  "weekly_summary",
  "monthly_summary",
  "summary-day:",
  "summary-week:",
  "summary-month:",
]);

requireIncludes(".gitignore", [
  "*.jks",
  "*.jks.sha256",
]);

requireIncludes("supabase/config.toml", [
  'project_id = "yqljcoukgpqdoxiispyn"',
]);

requireIncludes(".github/workflows/deploy-ordys-assistant.yml", [
  'https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID/config/auth',
  "scripts/verify-supabase-auth-config.mjs",
  "supabase db query --linked --yes --output json --file scripts/queries/auth-trigger-readiness.sql",
  "No known or email_confirmed_at-related trigger was found on auth.users.",
  '[.. | objects | select(has("trigger_name"))] as $triggers',
  'all($triggers[];',
  '.trigger_name == "ordys_auto_confirm_email_trigger"',
  '.function_schema == "public"',
  '.function_name == "ordys_auto_confirm_email"',
  "unexpected auth.users trigger references email_confirmed_at. Refusing to deploy until the trigger/function is inspected.",
  "email_confirmation_delivery_verified:",
  "configured_project_id=",
  "SUPABASE_PROJECT_ID does not match the project pinned in supabase/config.toml.",
  "group: ordys-supabase-production",
  "supabase migration list",
  "supabase db lint --linked --level error",
  "supabase db push --linked --dry-run",
  "supabase --yes db push --linked",
  'supabase --yes secrets set "ORDYS_PUBLIC_APP_URL=$ORDYS_PUBLIC_APP_URL"',
  "supabase --yes functions deploy ordys-assistant",
  "supabase --yes functions deploy ordys-video-transcribe",
  "supabase --yes functions deploy ordys-password-recovery",
  "supabase --yes functions deploy ordys-delete-account",
]);

requireIncludes(".github/workflows/verify-ordys.yml", [
  "deno check supabase/functions/ordys-assistant/index.ts",
  "deno check supabase/functions/ordys-video-transcribe/index.ts",
  "deno check supabase/functions/ordys-password-recovery/index.ts",
  "deno check supabase/functions/ordys-delete-account/index.ts",
]);

requireIncludes(".github/workflows/preflight-ordys-production.yml", [
  "workflow_dispatch:",
  "permissions:",
  "contents: read",
  "supabase migration list --linked",
  "supabase db lint --linked --level error",
  "supabase db push --linked --dry-run",
  'https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID/config/auth',
  "scripts/verify-supabase-auth-config.mjs",
  "supabase db query --linked --yes --output json --file scripts/queries/auth-trigger-readiness.sql",
  "No known or email_confirmed_at-related trigger was found on auth.users.",
  "A trigger on auth.users may set or otherwise reference email_confirmed_at.",
  "supabase secrets list --project-ref \"$SUPABASE_PROJECT_ID\"",
  "OPENAI_API_KEY",
  "No migrations or Edge Functions were deployed and no secrets were changed.",
]);
const deployWorkflowSource = read(".github/workflows/deploy-ordys-assistant.yml");
const productionPreflightSource = read(".github/workflows/preflight-ordys-production.yml");
for (const [source, name] of [
  [deployWorkflowSource, "deploy"],
  [productionPreflightSource, "preflight"],
]) {
  if (/missing\+?=\(?[^\n]*ORDYS_PUBLIC_APP_URL/.test(source)) {
    failures.push(`Workflow ${name} não pode exigir domínio web para o fluxo Android nativo.`);
  }
  if (!source.includes('if [ -n "${ORDYS_PUBLIC_APP_URL:-}" ]; then')) {
    failures.push(`Workflow ${name} deve validar ORDYS_PUBLIC_APP_URL somente quando informado.`);
  }
}
requireIncludes(".github/workflows/deploy-ordys-assistant.yml", [
  "Native deep-link recovery remains available",
  "browser-based recovery stays closed until the official site origin is configured",
]);
requireIncludes(".github/workflows/preflight-ordys-production.yml", [
  "Native-only mode: web recovery remains closed until the official site origin is configured.",
]);
requireIncludes("scripts/verify-supabase-auth-config.mjs", [
  'const NATIVE_AUTH_REDIRECT = "app.ordys.academy://auth/callback";',
  "config.mailer_autoconfirm !== false",
  "minimumPasswordLength < 8",
  "config.password_hibp_enabled !== true",
  "config.external_google_secret",
  "config.mailer_secure_email_change_enabled !== true",
  "config.smtp_pass",
  "smtpPartiallyConfigured",
  "Custom SMTP is partially configured or invalid.",
  "Custom SMTP is not configured. This may be expected for a Lovable Cloud-managed backend",
  "No public web origin is configured",
  "Secret values were not displayed",
]);
requireFile("tests/supabase-auth-config.test.ts");
requireFile("tests/password-recovery-rpc.integration.test.ts");
requireFile("tests/auth-trigger-readiness.test.ts");
requireFile("tests/ordys-assistant-error-logging.test.ts");
requireFile("tests/android-notification-manifest.test.py");
requireIncludes("tests/android-notification-manifest.test.py", [
  "test_sideload_profile",
  "test_play_profile",
  "POST_NOTIFICATIONS",
  "RECEIVE_BOOT_COMPLETED",
  "WAKE_LOCK",
  "SCHEDULE_EXACT_ALARM",
  "USE_EXACT_ALARM",
]);
requireIncludes(".github/workflows/verify-ordys.yml", [
  "Verify Android notification manifest profiles",
  "python3 tests/android-notification-manifest.test.py",
  "Validate Android build script syntax",
  "bash -n scripts/build-ordys-codespace.sh scripts/ensure-ordys-android.sh",
]);
requireFile("scripts/queries/auth-trigger-readiness.sql");

const authTriggerQuery = read("scripts/queries/auth-trigger-readiness.sql");
if (!/^\s*(?:--[^\n]*\n\s*)*SELECT\b/i.test(authTriggerQuery)) {
  failures.push("Auth trigger metadata query must begin with SELECT.");
}
if (/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|DO|CALL|COPY|LOCK)\b/i.test(authTriggerQuery)) {
  failures.push("Auth trigger metadata query must not contain database write or control statements.");
}
if (!authTriggerQuery.includes("pg_catalog.pg_trigger") || !authTriggerQuery.includes("ordys_auto_confirm_email_trigger") || !authTriggerQuery.includes("p.prosrc ILIKE '%email_confirmed_at%'")) {
  failures.push("Auth trigger metadata query must detect the known auto-confirm trigger and renamed functions referencing email_confirmed_at.");
}

requireIncludes("tests/password-recovery-redirect.test.ts", [
  "accepts the exact native callback without a public web origin",
  'recoveryRequest(),',
  '"app.ordys.academy://auth/callback",',
  '""',
]);

const productionPreflight = read(".github/workflows/preflight-ordys-production.yml");
for (const [pattern, description] of [
  [/^\s*(?:run:\s*)?supabase\s+(?:--yes\s+)?db\s+push\b(?![^\n]*--dry-run)/m, "db push sem --dry-run"],
  [/^\s*(?:run:\s*)?supabase\s+(?:--yes\s+)?functions\s+deploy\b/m, "deploy de Edge Function"],
  [/^\s*(?:run:\s*)?supabase\s+(?:--yes\s+)?secrets\s+set\b/m, "alteração de secrets"],
  [/^\s*(?:run:\s*)?supabase\s+(?:--yes\s+)?secrets\s+unset\b/m, "remoção de secrets"],
]) {
  if (pattern.test(productionPreflight)) {
    failures.push("Preflight de produção deve permanecer somente leitura; comando proibido: " + description);
  }
}

requireIncludes(".github/workflows/deploy-ordys-assistant.yml", [
  "supabase secrets list --project-ref \"$SUPABASE_PROJECT_ID\"",
  "OPENAI_API_KEY",
  "Required OpenAI runtime secret is configured; its value was not read.",
  "supabase --yes db push --linked",
]);

const goalDefaultsMigrationGuard = read("supabase/migrations/20260927020000_goal_integrity.sql");
for (const expected of [
  "ALTER COLUMN metric SET DEFAULT 'horas_estudo'",
  "ALTER COLUMN period SET DEFAULT 'semanal'",
]) {
  if (!goalDefaultsMigrationGuard.includes(expected)) {
    failures.push("Migration de metas perdeu um valor padrão permitido: " + expected);
  }
}

requireIncludes("supabase/migrations/20260927014500_focus_plan_ownership.sql", [
  "VALIDATE CONSTRAINT focus_sessions_plan_session_fk",
]);

const focusSqlDelimiterMigrationGuard = read("supabase/migrations/20260927014000_focus_plan_reference_integrity.sql");
if (!/^[ \t]*DO \$\$/m.test(focusSqlDelimiterMigrationGuard) || !/END \$\$;/.test(focusSqlDelimiterMigrationGuard)) {
  failures.push("Migration de integridade das sessões de foco precisa ter delimitadores DO $$ ... END $$ válidos.");
}
if (/^[ \t]*DO \$(?:\r?\n)/m.test(focusSqlDelimiterMigrationGuard)) {
  failures.push("Migration de integridade das sessões de foco possui delimitador DO incompleto.");
}

requireIncludes("supabase/migrations/20260927023000_profile_full_name_limit.sql", [
  "VALIDATE CONSTRAINT profiles_full_name_nonblank",
]);
requireIncludes("supabase/migrations/20260927110000_fix_profile_stage_constraint.sql", [
  "pg_get_constraintdef(oid)",
  "NOT ILIKE '%fundamental%'",
  "VALIDATE CONSTRAINT profiles_stage_allowed",
]);

requireIncludes("supabase/migrations/20260927120000_validate_profile_academic_ranges.sql", [
  "VALIDATE CONSTRAINT profiles_attendance_target_range",
  "VALIDATE CONSTRAINT profiles_daily_load_limit_range",
  "VALIDATE CONSTRAINT profiles_grade_pass_range",
  "VALIDATE CONSTRAINT profiles_grade_scale_max_range",
  "VALIDATE CONSTRAINT profiles_weekly_study_target_range",
]);

requireIncludes("supabase/migrations/20260927130000_validate_grade_integrity_constraints.sql", [
  "SELECT count(*)",
  "WHERE score > max_score",
  "WHERE weight <= 0",
  "RAISE EXCEPTION",
  "VALIDATE CONSTRAINT grades_score_not_above_max",
  "VALIDATE CONSTRAINT grades_weight_positive",
  "No data was changed.",
]);

requireIncludes("supabase/migrations/20261029233000_remove_untracked_auto_confirm_email.sql", [
  "DROP TRIGGER IF EXISTS ordys_auto_confirm_email_trigger ON auth.users;",
  "DROP FUNCTION IF EXISTS public.ordys_auto_confirm_email();",
  "ordinary Gmail address",
]);

requireIncludes(".github/workflows/verify-ordys.yml", [
  "group: ordys-supabase-integration-${{ github.ref }}",
  "cancel-in-progress: false",
]);
const deploymentWorkflow = read(".github/workflows/deploy-ordys-assistant.yml");
const singleRunSteps = [
  "Verify required Edge Function secret names",
  "Preflight Supabase migration state",
  "Apply Supabase database migrations",
  "Verify AI content report schema before deploying report Edge Function",
  "Deploy Ordys Assistant Edge Function",
  "Deploy ORDYS AI Content Report Edge Function",
  "Deploy Ordys Video Transcription Edge Function",
  "Deploy Ordys Password Recovery Edge Function",
  "Deploy Ordys Delete Account Edge Function",
];
for (const stepName of singleRunSteps) {
  const matches = deploymentWorkflow.split(`- name: ${stepName}`).length - 1;
  if (matches !== 1) {
    failures.push(`Deploy de produção deve conter exatamente uma etapa "${stepName}", encontrou ${matches}.`);
  }
}
if (!deploymentWorkflow.includes("deno check supabase/functions/ordys-ai-report/index.ts") ||
  !deploymentWorkflow.includes("supabase --yes functions deploy ordys-ai-report --project-ref") ||
  !deploymentWorkflow.includes("id: ai_report_schema") ||
  !deploymentWorkflow.includes('report_migration_version="20261031030000"') ||
  !deploymentWorkflow.includes("steps.ai_report_schema.outputs.ready == 'true'")) {
  failures.push("Deploy de produção deve validar o schema antes de publicar a Edge Function ordys-ai-report.");
}
for (const expected of [
  "email_confirmation_delivery_verified:",
  "EMAIL_CONFIRMATION_DELIVERY_VERIFIED",
  "default: false",
  "held_migrations=0",
  "while IFS= read -r migration_file",
  "migration_version=\"${migration_name%%_*}\"",
  "find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort",
  "Holding the email-confirmation migration and",
  "later migration(s) until Gmail delivery is verified",
  "Supabase columns are LOCAL | REMOTE | TIME; awk field $2 is REMOTE.",
  "'$2 ~ version { found=1 } END { print found ? \"yes\" : \"no\" }'",
]) {
  if (!deploymentWorkflow.includes(expected)) {
    failures.push("Deploy de produção perdeu a proteção de confirmação de e-mail: " + expected);
  }
}

requireIncludes("src/routes/desempenho.tsx", [
  "if (!key || !Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0",
  "if (Number.isNaN(startedAt.getTime()) || !Number.isFinite(minutes) || minutes < 0) continue;",
  "const value = Number(item.actual_minutes ?? item.planned_minutes);",
  "if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0",
]);

requireIncludes("src/routes/auth.tsx", [
  'className="absolute top-1/2 right-2 grid size-11',
  'className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-2',
  'className="mt-4 min-h-11 w-full rounded-md px-2 text-center',
]);
requireIncludes("src/routes/redefinir-senha.tsx", [
  'className="mb-5 inline-flex min-h-11',
  'className="absolute top-1/2 right-2 grid size-11',
]);
requireFile("docs/LEGAL-PRIVACY-RELEASE-CHECKLIST.md");
requireIncludes("docs/LEGAL-PRIVACY-RELEASE-CHECKLIST.md", [
  "Não invente nome empresarial, CPF/CNPJ",
  "E-mail direto para privacidade",
  "ensino fundamental",
  "consentimento específico e destacado",
  "contém a base técnica de assinatura recorrente com Asaas, integrada por meio do PR #131",
  "billing_enabled=false",
  "price_cents=NULL",
  "não existe cobrança ativa nem contratação do Ordys Plus disponível em produção.",
  "A distribuição por sideloading direto de um APK pelo próprio usuário não está incluída nessa etapa inicial",
  "Essa verificação de desenvolvedor é diferente do Google Play Protect",
  "autorização de compra precisa ser validada no servidor",
  "sem vínculo com o ID da conta e sem consulta a `auth.users`",
  "sem novas solicitações, essa limpeza oportunista não é executada por agendamento",
]);

requireFile("docs/PRODUCTION-READINESS-SETUP.md");
requireIncludes("docs/PRODUCTION-READINESS-SETUP.md", [
  "Configurar Google OAuth para o aplicativo",
  "https://yqljcoukgpqdoxiispyn.supabase.co/auth/v1/callback",
  "app.ordys.academy://auth/callback",
  "Não cadastre ali o esquema",
  "Minimum password length = 6",
  "ajuste o valor para **8**",
]);

requireIncludes("src/routes/privacidade.tsx", [
  "títulos de até 12 conteúdos cadastrados nessa disciplina",
  "respostas corretas e informadas, explicações e resultado",
  'className="inline-flex min-h-11 items-center gap-1.5 rounded-md',
]);
requireIncludes("src/routes/excluir-conta.tsx", [
  'className="inline-flex min-h-11 items-center gap-1.5 rounded-md',
]);

const accountDeletionRouteSource = read("src/routes/excluir-conta.tsx");
if (accountDeletionRouteSource.includes("window.confirm(")) {
  failures.push("excluir-conta.tsx deve usar confirmação dentro do app, compatível com WebView Android");
}
requireIncludes("src/routes/excluir-conta.tsx", [
  'import { Button, ConfirmDialog } from "@/components/ordys/form";',
  "deleteDialogStep === 1",
  "deleteDialogStep === 2",
]);

for (const path of [
  "src/routes/excluir-conta.tsx",
  "src/routes/desempenho.tsx",
  "src/routes/disciplinas.tsx",
  "src/routes/perfil.tsx",
]) {
  if (read(path).includes("window.confirm(")) {
    failures.push(`${path} não pode depender de window.confirm(); use modal interno compatível com WebView Android`);
  }
}
requireIncludes("src/routes/perfil.tsx", [
  'import { Button, ConfirmDialog, Field, Select, TextInput } from "@/components/ordys/form";',
  "cancelBillingDialogOpen",
  'navigate({ to: "/excluir-conta" })',
]);

const routeSources = [
  "src/routes/__root.tsx",
  "src/routes/agenda.tsx",
  "src/routes/assistente.tsx",
  "src/routes/auth.tsx",
  "src/routes/desempenho.tsx",
  "src/routes/disciplinas.tsx",
  "src/routes/estudos.tsx",
  "src/routes/excluir-conta.tsx",
  "src/routes/index.tsx",
  "src/routes/perfil.tsx",
  "src/routes/privacidade.tsx",
  "src/routes/redefinir-senha.tsx",
  "src/routes/simulado.tsx",
  "src/routes/tarefas.tsx",
];
const routeTitles = new Map();
for (const path of routeSources) {
  const content = read(path);
  for (const nativeDialog of ["window.confirm(", "window.alert(", "window.prompt("]) {
    if (content.includes(nativeDialog)) {
      failures.push(`${path} não pode usar ${nativeDialog} em fluxos WebView; use os componentes internos do Ordys`);
    }
  }
  if (path !== "src/routes/__root.tsx" && !/\bhead\s*:\s*\(\s*\)\s*=>/.test(content)) {
    failures.push(`${path} precisa declarar head() com metadados próprios`);
  }
  for (const match of content.matchAll(/\btitle:\s*"([^"]+)"/g)) {
    const title = match[1];
    if (title && !title.includes("Nenhuma ") && !title.includes("Nada com ") && !title.includes("Você ainda")) {
      if (routeTitles.has(title)) {
        failures.push(`Título de rota duplicado: "${title}" em ${path} e ${routeTitles.get(title)}`);
      } else {
        routeTitles.set(title, path);
      }
    }
  }
  const imported = [];
  for (const match of content.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["'];/g)) {
    for (const piece of match[1].split(",")) {
      const name = piece.trim().replace(/\bas\s+type\b/, "").replace(/\bas\b.*/, "").trim();
      if (name && name !== "type") imported.push(name);
    }
  }
  const duplicates = [...new Set(imported.filter((name, index) => imported.indexOf(name) !== index))];
  if (duplicates.length) {
    failures.push(`${path} contém bindings importados duplicados: ${duplicates.join(", ")}`);
  }
}

const routeTree = read("src/routeTree.gen.ts");
for (const route of ["/", "/agenda", "/assistente", "/auth", "/excluir-conta", "/privacidade", "/redefinir-senha", "/desempenho", "/disciplinas", "/estudos", "/perfil", "/simulado", "/tarefas"]) {
  if (!routeTree.includes(`path: '${route}'`) && route !== "/") {
    failures.push(`routeTree.gen.ts não registra a rota ${route}`);
  }
}
if (!routeTree.includes("const rootRouteChildren")) {
  failures.push("routeTree.gen.ts não contém rootRouteChildren");
}

const rootRoute = read("src/routes/__root.tsx");
for (const bad of ["Go home", "Page not found"]) {
  if (rootRoute.includes(bad)) failures.push(`Texto de fallback ainda em inglês: ${bad}`);
}

requireIncludes("src/routes/agenda.tsx", [
  "onClick={() => openItem(it, i)}",
  "onClick={() => openMonthItem(it, day)}",
]);

const shellUiSource = read("src/components/ordys/shell.tsx");
for (const expected of [
  'pt-[calc(0.625rem+env(safe-area-inset-top))]',
  'pb-[calc(6rem+env(safe-area-inset-bottom))]',
  'fixed inset-x-3 top-[calc(4rem+env(safe-area-inset-top))]',
  'grid size-11 shrink-0 place-items-center rounded-lg',
]) {
  if (!shellUiSource.includes(expected)) {
    failures.push(`Shell perdeu proteção/uso mobile esperado: ${expected}`);
  }
}

const sharedFormSource = read("src/components/ordys/form.tsx");
if (!sharedFormSource.includes("inline-flex min-h-11 shrink-0") || !sharedFormSource.includes("sm:min-h-9")) {
  failures.push("Button compartilhado deve ter alvo de toque mobile de 44px e permanecer compacto no desktop");
}

const modalSource = read("src/components/ordys/form.tsx");
if (!modalSource.includes('pt-[calc(1.5rem+env(safe-area-inset-top))]')) {
  failures.push("Modal perdeu espaçamento seguro para a barra de status");
}
if (!modalSource.includes('pb-[calc(1.5rem+env(safe-area-inset-bottom))]')) {
  failures.push("Modal perdeu espaçamento seguro para a área de gestos");
}

const authUiSource = read("src/routes/auth.tsx");
for (const expected of [
  'min-h-11 rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
  'size-11 -translate-y-1/2 place-items-center',
]) {
  if (!authUiSource.includes(expected)) {
    failures.push(`Auth perdeu alvo de toque mobile esperado: ${expected}`);
  }
}

const tasksUiSource = read("src/routes/tarefas.tsx");
if (!tasksUiSource.includes('className="mt-0 grid size-10 shrink-0 place-items-center rounded-md"')) {
  failures.push("Tarefas perdeu área de toque mobile adequada para concluir uma tarefa");
}

requireIncludes("src/components/ordys/quick-capture.tsx", [
  'className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary',
]);
requireIncludes("src/components/ordys/shell.tsx", [
  'className="relative grid size-11 shrink-0 place-items-center rounded-lg',
  'className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground',
]);
requireIncludes("src/components/ordys/shell.tsx", [
  "async function markRead(id: string)",
  "async function markAllRead()",
  "async function dismiss(id: string)",
  "void markAllRead().catch",
  "void markRead(n.id).catch",
  "void dismiss(n.id).catch",
]);

const assistantPanelsSource = read("src/components/ordys/assistant-panels.tsx");
requireIncludes("src/routes/assistente.tsx", [
  'className="group flex min-h-11 min-w-0 items-center gap-3 rounded-lg border border-border bg-background',
]);
requireIncludes("src/components/ordys/assistant-panels.tsx", [
  'className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-2.5 py-2',
]);
if (!assistantPanelsSource.includes('w-full max-w-full min-w-0 overflow-hidden')) {
  failures.push("Prévia do mapa mental perdeu contenção responsiva");
}

const modalUiSource = read("src/components/ordys/form.tsx");
for (const expected of [
  'event.key === "Escape"',
  'document.body.style.overflow = "hidden"',
  'dialogRef.current?.focus()',
  'aria-labelledby={`${dialogId}-title`}',
  'aria-describedby={subtitle ? `${dialogId}-description` : undefined}',
]) {
  if (!modalUiSource.includes(expected)) {
    failures.push(`Modal perdeu comportamento de acessibilidade esperado: ${expected}`);
  }
}

const devcontainerSource = read(".devcontainer/devcontainer.json");
requireIncludes(".devcontainer/devcontainer.json", [
  "ghcr.io/cirruslabs/android-sdk:36@sha256:f9b3ea9ed2b5fc9522adae82c7b4622ab7aa54207ef532c8e615a347dca08f31",
  '"version": "24"',
  '"npmVersion": "11"',
  "scripts/ensure-ordys-android.sh",
]);
requireIncludes(".devcontainer/devcontainer.json", [
  '"postCreateCommand": "apt-get update && apt-get install -y --no-install-recommends imagemagick',
  "nohup bash scripts/ensure-ordys-android.sh",
]);

if (devcontainerSource.includes('"image": "ghcr.io/cirruslabs/android-sdk:36"')) {
  failures.push("devcontainer.json não deve usar a tag mutável do Android SDK sem digest");
}

const mobileEntry = read("mobile/entry.tsx");
if (/\[role=["']dialog["']\][^{]*\{[^}]*display:\s*none/i.test(mobileEntry)) {
  failures.push("mobile/entry.tsx ainda oculta globalmente elementos [role=dialog]");
}

requireIncludes("src/components/ordys/quick-capture.tsx", [
  'min-h-11 rounded-md border px-2.5 py-2 text-[12px] transition-colors',
]);

for (const forbidden of [
  'from "@/components/ui/sheet"',
  'SheetTrigger',
  'SheetContent',
  'aria-label="Abrir navegação"',
]) {
  if (shell.includes(forbidden)) {
    failures.push(`shell.tsx não pode reintroduzir navegação mobile expansível: ${forbidden}`);
  }
}
for (const required of [
  'aria-label="Navegação principal"',
  '{ to: "/", label: "Início"',
  '{ to: "/disciplinas", label: "Disciplinas"',
  '{ to: "/agenda", label: "Calendário"',
  '{ to: "/tarefas", label: "Tarefas"',
  '{ to: "/estudos", label: "Estudos"',
  '{ to: "/simulado", label: "Simulados"',
  '{ to: "/desempenho", label: "Desempenho"',
  'title="Configurações"',
]) {
  if (!shell.includes(required)) {
    failures.push(`shell.tsx perdeu elemento essencial da navegação compacta: ${required}`);
  }
}

const errorPage = read("src/lib/error-page.ts");
for (const bad of ["This page didn't load", "Something went wrong", "Try again", "Go home"]) {
  if (errorPage.includes(bad)) failures.push(`Fallback de erro do servidor ainda contém texto em inglês: ${bad}`);
}
for (const required of ['lang="pt-BR"', 'href="/icon-192.png"', "Tentar novamente", "Voltar ao início"]) {
  if (!errorPage.includes(required)) failures.push(`Fallback de erro do servidor não contém: ${required}`);
}
if (/\bon(?:click|load|error|submit|change|input|focus|blur|keydown|keyup|keypress)\s*=/i.test(errorPage)) {
  failures.push("Fallback de erro do servidor não pode conter handlers JavaScript inline");
}

requireFile("supabase/migrations/20260927023000_profile_full_name_limit.sql");
const profileNameTriggerMigration = read("supabase/migrations/20260927024000_harden_new_user_profile_name.sql");
for (const expected of [
  "CREATE OR REPLACE FUNCTION public.handle_new_user()",
  "candidate := btrim",
  "candidate := left(candidate, 120);",
  "NULLIF(candidate, '')",
]) {
  if (!profileNameTriggerMigration.includes(expected)) failures.push(`Trigger de cadastro não contém hardening esperado: ${expected}`);
}

const profileNameMigration = read("supabase/migrations/20260927023000_profile_full_name_limit.sql");
for (const expected of ["profiles_full_name_nonblank", "BETWEEN 1 AND 120", "NOT VALID"]) {
  if (!profileNameMigration.includes(expected)) failures.push(`Migration de nome do perfil não contém: ${expected}`);
}

requireFile("supabase/migrations/20260926083000_remove_recovery_enumeration_timing.sql");
requireFile("supabase/migrations/20260927011000_profile_academic_ranges.sql");

const profileRangeMigration = read("supabase/migrations/20260927011000_profile_academic_ranges.sql");
if (!profileRangeMigration.includes("IF NOT EXISTS (")) {
  failures.push("Migration de perfil deve ser segura para reexecução durante reconciliação de produção");
}
if (!profileRangeMigration.includes("conrelid = 'public.profiles'::regclass")) {
  failures.push("Migration de perfil deve identificar constraints existentes antes de recriá-las");
}

for (const expected of [
  "profiles_grade_scale_max_range",
  "profiles_grade_pass_range",
  "profiles_attendance_target_range",
  "profiles_weekly_study_target_range",
  "profiles_daily_load_limit_range",
  "NOT VALID",
]) {
  if (!profileRangeMigration.includes(expected)) {
    failures.push(`Migration de perfil não contém a validação esperada: ${expected}`);
  }
}

requireFile("supabase/migrations/20260927013000_academic_data_integrity.sql");
requireFile("supabase/migrations/20260927014000_focus_plan_reference_integrity.sql");
requireFile("supabase/migrations/20260927014500_focus_plan_ownership.sql");
requireFile("supabase/migrations/20260927020000_goal_integrity.sql");
requireFile("supabase/migrations/20260927110000_fix_profile_stage_constraint.sql");

const academicIntegrityMigration = read("supabase/migrations/20260927013000_academic_data_integrity.sql");
for (const expected of [
  "DROP CONSTRAINT IF EXISTS grades_score_not_above_max",
  "DROP CONSTRAINT IF EXISTS grades_weight_positive",
  "NOT VALID",
]) {
  if (!academicIntegrityMigration.includes(expected)) failures.push(`Integridade acadêmica não está protegida contra replay: ${expected}`);
}


for (const expected of [
  "IF NOT EXISTS (",
  "focus_plan_session_fk",
  "focus_sessions_plan_session_fk",
  "DROP TRIGGER IF EXISTS focus_refs_guard",
]) {
  if (!focusSqlDelimiterMigrationGuard.includes(expected)) failures.push(`Migration de referência do foco não está segura para replay: ${expected}`);
}

const focusOwnershipMigration = read("supabase/migrations/20260927014500_focus_plan_ownership.sql");
for (const expected of [
  "DROP CONSTRAINT IF EXISTS focus_plan_session_fk",
  "DROP CONSTRAINT IF EXISTS focus_sessions_plan_session_fk",
  "ADD CONSTRAINT focus_sessions_plan_session_fk",
  "DROP TRIGGER IF EXISTS focus_refs_guard",
]) {
  if (!focusOwnershipMigration.includes(expected)) failures.push(`Migration de ownership do foco não contém hardening esperado: ${expected}`);
}

const goalIntegrityMigration = read("supabase/migrations/20260927020000_goal_integrity.sql");
if (!goalIntegrityMigration.includes("metric SET DEFAULT 'horas_estudo'") ||
    !goalIntegrityMigration.includes("period SET DEFAULT 'semanal'")) {
  failures.push("Defaults de goals não estão alinhados com o formulário atual");
}

const profileStageMigration = read("supabase/migrations/20260927110000_fix_profile_stage_constraint.sql");
for (const expected of [
  "profiles_stage_allowed",
  "conrelid = 'public.profiles'::regclass",
  "NOT VALID",
]) {
  if (!profileStageMigration.includes(expected)) failures.push(`Migration de stage não contém hardening esperado: ${expected}`);
}

const recoveryMigration = read("supabase/migrations/20260926083000_remove_recovery_enumeration_timing.sql");
if (recoveryMigration.includes("auth.users")) {
  failures.push("Migration de recovery não deve consultar auth.users para decidir o envio");
}
if (!recoveryMigration.includes("GRANT EXECUTE ON FUNCTION public.can_request_password_recovery(TEXT)")) {
  failures.push("Migration de recovery precisa manter o RPC interno restrito");
}

const recoveryRoute = read("src/routes/redefinir-senha.tsx");
requireIncludes("src/routes/redefinir-senha.tsx", [
  'supabase.functions.invoke(',
  '"ordys-password-recovery"',
  "redirectTo,",
  "ORDYS_NATIVE_AUTH_REDIRECT_URI",
  'status !== "completed"',
]);
if (recoveryRoute.includes("supabase.auth.resetPasswordForEmail(cleanEmail")) {
  failures.push("A rota de recuperação deve passar pelo rate limit server-side de ordys-password-recovery");
}

const recoveryFunction = read("supabase/functions/ordys-password-recovery/index.ts");
for (const expected of [
  "const MAX_REQUEST_BYTES = 16 * 1024;",
  'const contentLength = Number(request.headers.get("Content-Length") ?? 0);',
  'const requestText = await readRequestBodyWithLimit(request, MAX_REQUEST_BYTES);',
  'requestText === null',
  "let body: Record<string, unknown>;",
  "try {",
  "body = jsonObject(JSON.parse(requestText));",
  'return response({ status: "failed", error: "Corpo JSON inválido." }, 400);',
]) {
  if (!recoveryFunction.includes(expected)) failures.push(`Recuperação de senha não contém limite de corpo esperado: ${expected}`);
}
for (const expected of [
  "const MAX_EMAIL_CHARS = 320;",
  "if (email.length > MAX_EMAIL_CHARS)",
  "await canRequestRecovery(supabaseUrl, serviceRoleKey, email)",
  'if (guard["reason"] === "rate_limited")',
  "await sendRecoveryEmail(supabaseUrl, publishableKey, email, redirectTo);",
]) {
  if (!recoveryFunction.includes(expected)) failures.push(`Recuperação de senha não contém limite esperado: ${expected}`);
}
if (recoveryFunction.includes("if (guard.exists === true)")) {
  failures.push("Recuperação de senha não pode condicionar o envio à existência da conta");
}
if (!recoveryFunction.includes("await sendRecoveryEmail(supabaseUrl, publishableKey, email, redirectTo);")) {
  failures.push("Recuperação de senha server-side deve permanecer consistente com o redirect validado");
}
if (!recoveryFunction.includes("redirect_to: redirectTo")) {
  failures.push("Recuperação de senha server-side deve transmitir o redirectTo ao Supabase Auth");
}
requireIncludes("supabase/functions/ordys-password-recovery/index.ts", [
  'import { validateRecoveryRedirect } from "../_shared/validate-recovery-redirect.ts";',
  'Deno.env.get("ORDYS_PUBLIC_APP_URL")',
  "validateRecoveryRedirect(request, redirectTo, publicAppUrl)",
]);
requireIncludes("supabase/functions/_shared/validate-recovery-redirect.ts", [
  'const NATIVE_RECOVERY_REDIRECT = "app.ordys.academy://auth/callback";',
  'const configuredOrigin = normalizeOrigin(configuredPublicAppUrl);',
  "configuredOrigin !== requestOrigin",
  'candidate.protocol === "http:" && LOCAL_HTTP_HOSTS.has(candidate.hostname)',
  "if (!requestOrigin || candidate.origin !== requestOrigin) return false;",
]);
requireFile("tests/password-recovery-redirect.test.ts");
requireFile("tests/android-signing-password-handling.test.ts");
if (!recoveryFunction.includes("const serviceRoleKey")) {
  failures.push("Recuperação de senha precisa manter o rate limit em caminho servidor-only");
}

const supabaseConfig = read("supabase/config.toml");
for (const expected of [
  "[functions.ordys-password-recovery]\nverify_jwt = false",
  "[functions.ordys-assistant]\nverify_jwt = true",
  "[functions.ordys-ai-report]\nverify_jwt = true",
  "[functions.ordys-video-transcribe]\nverify_jwt = true",
  "[functions.ordys-delete-account]\nverify_jwt = true",
  "[functions.ordys-billing-checkout]\nverify_jwt = true",
  "[functions.ordys-billing-status]\nverify_jwt = true",
  "[functions.ordys-billing-manage]\nverify_jwt = true",
  "[functions.ordys-billing-webhook]\nverify_jwt = false",
  "[functions.ordys-billing-return]\nverify_jwt = false",
]) {
  if (!supabaseConfig.includes(expected)) failures.push(`supabase/config.toml não contém: ${expected.replaceAll("\n", " ")}`);
}

requireIncludes("supabase/functions/ordys-billing-webhook/index.ts", [
  'Deno.env.get("ASAAS_WEBHOOK_TOKEN")',
  'request.headers.get("asaas-access-token")',
  "expectedToken.length < 32",
  "constantTimeEqual(expectedToken, receivedToken)",
]);
requireFile("supabase/functions/_shared/request-body.ts");
const boundedRequestBodyRoutes = [
  ["supabase/functions/ordys-billing-webhook/index.ts", "readRequestBodyWithLimit(request, 1_048_576)", "if (text === null)"],
  ["supabase/functions/ordys-video-transcribe/index.ts", "readRequestBodyWithLimit(request, MAX_REQUEST_BYTES)", "if (requestText === null)"],
  ["supabase/functions/ordys-assistant/index.ts", "readRequestBodyWithLimit(request, MAX_REQUEST_BYTES)", "if (requestText === null)"],
  ["supabase/functions/ordys-ai-report/index.ts", "readRequestBodyWithLimit(request, AI_CONTENT_REPORT_LIMITS.requestBytes)", "if (requestText === null)"],
  ["supabase/functions/ordys-password-recovery/index.ts", "readRequestBodyWithLimit(request, MAX_REQUEST_BYTES)", "if (requestText === null)"],
  ["supabase/functions/ordys-billing-checkout/index.ts", "readRequestBodyWithLimit(request, MAX_CHECKOUT_REQUEST_BYTES)", "if (text === null)"],
  ["supabase/functions/ordys-billing-manage/index.ts", "readRequestBodyWithLimit(request, MAX_MANAGE_REQUEST_BYTES)", "if (text === null)"],
  ["src/routes/api/ordys-assistant.ts", "readRequestBodyWithLimit(request, MAX_REQUEST_BYTES)", "if (requestText === null)"],
];
for (const [path, boundedRead, overflowCheck] of boundedRequestBodyRoutes) {
  const source = read(path);
  if (!source.includes(boundedRead) || !source.includes(overflowCheck)) {
    failures.push(path + " deve rejeitar o corpo excedente com readRequestBodyWithLimit.");
  }
  if (/\brequest(?:\.clone\(\))?\.(?:text|json|formData|arrayBuffer|blob)\s*\(/.test(source)) {
    failures.push(
      path + " não pode consumir o corpo diretamente; use readRequestBodyWithLimit.",
    );
  }
}

const publicSupabaseConfig = read("src/integrations/supabase/public-config.ts");
requireIncludes("src/integrations/supabase/public-config.ts", [
  'import.meta.env["VITE_SUPABASE_URL"]',
  'import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]',
  "sb_publishable_",
]);
for (const forbidden of ["sb_secret_", "service_role", "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (publicSupabaseConfig.includes(forbidden)) {
    failures.push(`public-config.ts não pode conter segredo Supabase: ${forbidden}`);
  }
}
if (/["']eyJ[A-Za-z0-9_-]{20,}/.test(publicSupabaseConfig)) {
  failures.push("public-config.ts não pode conter uma chave Supabase legada em formato JWT");
}
const browserSupabaseClient = read("src/integrations/supabase/client.ts");
if (!/from\s+["']\.\/public-config["']/.test(browserSupabaseClient)) {
  failures.push("client.ts deve usar a configuração pública versionada para bundles independentes");
}
for (const forbidden of ["SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY"]) {
  if (browserSupabaseClient.includes(forbidden)) {
    failures.push(`client.ts não pode conter segredo/service-role do Supabase: ${forbidden}`);
  }
}

const serverClient = read("src/integrations/supabase/client.server.ts");
if (serverClient.includes("VITE_SUPABASE_SERVICE_ROLE_KEY")) {
  failures.push("A chave service role do Supabase não pode usar variável VITE_ no servidor");
}
if (serverClient.includes("import.meta.env")) {
  failures.push("client.server.ts não deve depender de import.meta.env para secrets de servidor");
}
for (const expected of [
  "function resolveSupabaseSecretKey()",
  "process.env['SUPABASE_SECRET_KEYS']",
]) {
  if (!serverClient.includes(expected)) failures.push(`client.server.ts não contém fallback seguro esperado: ${expected}`);
}

const assistantFunction = read("supabase/functions/ordys-assistant/index.ts");
const assistantClient = read("src/lib/ordys-assistant-client.ts");
for (const expected of [
  'import { canUseOrdysAi } from "@/lib/ai-eligibility";',
  'const { data: profile, error: profileError } = await supabase',
  '.select("birth_date,timezone")',
  'const aiEligibility = canUseOrdysAi(profile?.birth_date, profile?.timezone);',
  'if (!aiEligibility.allowed) throw new Error(aiEligibility.reason);',
]) {
  if (!assistantClient.includes(expected)) failures.push(`Cliente do Assistente não contém gate de idade antes da IA: ${expected}`);
}
for (const expected of [
  'import { dateKey } from "@/lib/ordys-engine";',
  '.gte("session_date", dateKey(new Date()))',
]) {
  if (!assistantClient.includes(expected)) failures.push("Cliente do Assistente não contém correção esperada para data local: " + expected);
}

if (
  !assistantClient.includes("async function loadOrdysContext(") ||
  !assistantClient.includes("userId: string,") ||
  !assistantClient.includes("selectedScopes: readonly OrdysAcademicContextScope[]") ||
  !assistantClient.includes("const sections = getOrdysContextSections(selectedScopes);")
) {
  failures.push("Cliente do Assistente deve receber userId e escopos explícitos para consultar somente o contexto autorizado");
}
if (!assistantClient.includes("if (!selectedScopes.length) return baseMessage;")) {
  failures.push("Cliente do Assistente deve omitir todo o contexto acadêmico quando nenhuma categoria for selecionada");
}
for (const expected of [
  "getOrdysContextSections",
  "normalizeOrdysContextScopes(input.academicContext)",
  "contextQuery(supabase.from(\"grades\")",
  "contextQuery(supabase.from(\"attendance_records\")",
  "contextQuery(supabase.from(\"quiz_attempts\")",
]) {
  if (!assistantClient.includes(expected)) failures.push("Cliente do Assistente não mantém a minimização por escopo: " + expected);
}
if (!assistantClient.includes("const contextQueryFailed = queryResults.some((result) => Boolean(result.error));")) {
  failures.push("Cliente do Assistente deve detectar falhas nas consultas do contexto acadêmico");
}
if (!assistantClient.includes("LIMITAÇÃO DO CONTEXTO: uma ou mais categorias selecionadas")) {
  failures.push("Cliente do Assistente deve sinalizar contexto acadêmico incompleto ao modelo");
}
const assistantOwnerFilterCount = (assistantClient.match(/\.eq\("user_id", userId\)/g) ?? []).length;
if (assistantOwnerFilterCount < 13) {
  failures.push("Cliente do Assistente perdeu filtros explícitos de proprietário no contexto acadêmico");
}
if (!assistantClient.includes('.from("profiles").select("stage,timezone,grade_scale_max,grade_pass,attendance_target,weekly_study_target_minutes,daily_load_limit_minutes").eq("id", userId)')) {
  failures.push("Cliente do Assistente deve consultar somente campos acadêmicos do perfil do usuário autenticado");
}
if (assistantClient.includes("profile.full_name") || assistantClient.includes('.select("full_name')) {
  failures.push("Nome completo e identificadores pessoais não podem integrar o contexto enviado à IA");
}

for (const expected of [
  'dataUrl: kind === "video" ? undefined : dataUrl',
  "frames,",
]) {
  if (!assistantClient.includes(expected)) failures.push(`Cliente do Assistente não contém otimização esperada: ${expected}`);
}

for (const expected of [
  "Dados da conta nesta mensagem",
  "academicContext: submittedAcademicContext",
  "setAcademicContextScopes([])",
  "Por padrão, seus registros acadêmicos salvos não são incluídos no contexto enviado ao Assistente.",
]) {
  if (!read("src/routes/assistente.tsx").includes(expected)) {
    failures.push("Tela do Assistente não contém controle explícito de contexto por mensagem: " + expected);
  }
}
if (!read("tests/ordys-assistant-context.test.ts").includes("sends no account context unless a scope is explicitly selected")) {
  failures.push("Falta teste garantindo contexto acadêmico desativado por padrão");
}

const aiEligibility = read("src/lib/ai-eligibility.ts");
for (const expected of [
  "export const ORDYS_AI_MIN_AGE = 18;",
  "export function calculateAge(",
  "export function canUseOrdysAi(",
  "Confirme sua data de nascimento e fuso horário no Perfil para liberar os recursos de IA.",
  "Os recursos de IA que usam a OpenAI estão disponíveis apenas para contas com 18 anos ou mais.",
]) {
  if (!aiEligibility.includes(expected)) failures.push(`Regra central de idade da IA não contém: ${expected}`);
}

const aiEligibilityTests = read("src/lib/ai-eligibility.test.ts");
for (const expected of [
  "requires a birth date and a profile time zone",
  "allows exactly the minimum age using the profile time zone",
  "blocks users below the minimum age",
  "uses the profile time zone at the exact birthday boundary",
  "fails closed for invalid dates and IANA time zones",
]) {
  if (!aiEligibilityTests.includes(expected)) failures.push(`Testes de elegibilidade da IA não contêm: ${expected}`);
}

for (const expected of [
  "function resolveSupabasePublishableKey()",
  'const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")?.trim();',
  'return (Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY"))?.trim() || "";',
]) {
  if (!assistantFunction.includes(expected)) failures.push(`Assistente perdeu suporte seguro às chaves publicáveis Supabase: ${expected}`);
}

const assistantApiFallback = read("src/routes/api/ordys-assistant.ts");
for (const expected of [
  "const MAX_REQUEST_BYTES = 14 * 1024 * 1024;",
  "function publishableKey()",
  'const raw = env("SUPABASE_PUBLISHABLE_KEYS");',
  "const requestText = await readRequestBodyWithLimit(request, MAX_REQUEST_BYTES);",
  "requestText === null",
  "responseId.length > 160",
  "let body: Record<string, unknown>;",
  "body = JSON.parse(requestText) as Record<string, unknown>;",
  'return json({ status: "failed", error: "Corpo JSON inválido." }, 400);',
]) {
  if (!assistantApiFallback.includes(expected)) failures.push(`Fallback HTTP do Assistente perdeu proteção esperada: ${expected}`);
}

const privacyAiDisclosure = read("src/routes/privacidade.tsx");
for (const expected of [
  "Por padrão, os registros acadêmicos salvos na sua conta não são consultados para compor o contexto da mensagem nem anexados ao conteúdo enviado à OpenAI.",
  "Somente as categorias marcadas são consultadas e acrescentadas àquela solicitação.",
  "Perfil e matérias",
  "Agenda",
  "Desempenho",
  "Estudos",
  "Simulados",

  "Se nenhuma categoria for marcada, os registros acadêmicos salvos não são enviados ao Assistente.",
  "Quando você anexa um vídeo, o aplicativo extrai até seis quadros representativos",
  "envia esses quadros à OpenAI para análise visual.",
  "Quando a função separada de transcrição estiver habilitada",
  "o arquivo de vídeo completo também pode ser encaminhado à OpenAI para tentar transcrever seu áudio.",

  "os recursos que enviam dados à OpenAI ficam disponíveis apenas para contas com 18 anos ou mais",
]) {
  if (!privacyAiDisclosure.includes(expected)) failures.push(`Política de privacidade não descreve o contexto de IA usado pelo Assistente: ${expected}`);
}

for (const expected of [
  'import { calculateAgeInTimeZone, isOrdysPlusEligible } from "../_shared/ordys-billing.ts";',
  "async function assertAiEligible(request: Request, userId: string)",
  "profiles?select=birth_date,timezone&id=eq.",
  'const timezone = typeof row?.["timezone"] === "string" ? row["timezone"] : null;',
  "calculateAgeInTimeZone(birthDate, timezone)",
  'if (age === null || age < 18)',
  "await assertAiEligible(request, user.id);",
]) {
  if (!assistantFunction.includes(expected)) failures.push(`Assistente não contém gate de idade por fuso esperado: ${expected}`);
}
if ((assistantFunction.match(/function calculateAge\(/g) ?? []).length !== 0) {
  failures.push("Assistente deve reutilizar o cálculo de idade por fuso compartilhado, sem implementação local");
}
if ((assistantFunction.match(/async function assertAiEligible\(/g) ?? []).length !== 1) {
  failures.push("Assistente deve manter uma única implementação de assertAiEligible");
}
for (const expected of [
  "const MAX_REQUEST_BYTES = 14 * 1024 * 1024;",
  "const rawDataUrl = typeof obj[\"dataUrl\"] === \"string\" ? obj[\"dataUrl\"].trim() : \"\";",
  'if ((kind === "image" || kind === "file") && rawDataUrl.length > MAX_ATTACHMENT_CHARS)',
  'return { kind, name, mimeType, dataUrl: kind === "video" ? "" : rawDataUrl, frames, durationSeconds };',
  'const contentLength = Number(request.headers.get("Content-Length") ?? 0);',
  'const requestText = await readRequestBodyWithLimit(request, MAX_REQUEST_BYTES);',
  'requestText === null',
  "let body: Record<string, unknown>;",
  "body = jsonObject(JSON.parse(requestText));",
]) {
  if (!assistantFunction.includes(expected)) failures.push(`Assistente não contém limite de corpo esperado: ${expected}`);
}
const videoAiFunction = read("supabase/functions/ordys-video-transcribe/index.ts");
for (const [sourceName, source] of [
  ["regra central de elegibilidade do cliente", aiEligibility],
  ["helper compartilhado do servidor", read("supabase/functions/_shared/ordys-billing.ts")],
]) {
  for (const expected of [
    "const year = Number(birthDate.slice(0, 4));",
    "const month = Number(birthDate.slice(5, 7));",
    "const day = Number(birthDate.slice(8, 10));",
  ]) {
    if (!source.includes(expected)) {
      failures.push(`${sourceName} deve analisar a data de nascimento com fatias numéricas seguras: ${expected}`);
    }
  }
}
for (const expected of [
  'import { calculateAgeInTimeZone, getUserAgeProfile, isOrdysPlusEligible } from "../_shared/ordys-billing.ts";',
  "async function assertAiEligible(request: Request, userId: string)",
  "getUserAgeProfile(",
  'request.headers.get("Authorization") ?? ""',
  "calculateAgeInTimeZone(ageProfile.birthDate, ageProfile.timezone)",
  'if (age === null || age < 18)',
  "await assertAiEligible(request, userId);",
]) {
  if (!videoAiFunction.includes(expected)) failures.push(`Transcrição de vídeo não contém gate de idade por fuso esperado: ${expected}`);
}
if ((videoAiFunction.match(/function calculateAge\(/g) ?? []).length !== 0) {
  failures.push("Transcrição de vídeo deve reutilizar o cálculo de idade por fuso compartilhado, sem implementação local");
}
if ((videoAiFunction.match(/async function assertAiEligible\(/g) ?? []).length !== 1) {
  failures.push("Transcrição de vídeo deve manter uma única implementação de assertAiEligible");
}

const assistantPartialApplyGuard = [
  'status: applied.length ? "partial" : "failed"',
  "A configuração foi aplicada parcialmente.",
  'if (result.status === "partial")',
  "setStatus(result.error ??",
];
for (const expected of assistantPartialApplyGuard) {
  if (!assistantFunction.includes(expected) && !read("src/routes/assistente.tsx").includes(expected)) {
    failures.push(`Fluxo de configuração não contém tratamento de aplicação parcial: ${expected}`);
  }
}
if (read("src/routes/assistente.tsx").includes("if (!configuration || configuration.questions.length === 0) setStatus(\"\");")) {
  failures.push("Assistente não deve limpar silenciosamente a mensagem de erro após falha na configuração");
}

const assistantConfigurationPreflightGuard = [
  "function assertConfigurationPlanSafe(plan: ReturnType<typeof normalizePlan>)",
  "const allowedStages = new Set([\"fundamental\", \"medio\", \"superior\", \"pos\", \"outro\"]);",
  "assertConfigurationPlanSafe(plan);",
  "action.endTime <= action.startTime",
  "new Intl.DateTimeFormat(\"pt-BR\", { timeZone: action.timezone }).format();",
];
for (const expected of assistantConfigurationPreflightGuard) {
  if (!assistantFunction.includes(expected)) failures.push(`Assistente não contém preflight de configuração esperado: ${expected}`);
}

const assistantConfigOwnerGuard = [
  'async function findSubject(request: Request, name: string, userId: string)',
  'subjects?select=id,name&user_id=eq.',
  'const existing = await findSubject(request, name, userId);',
  'subjects?id=eq.${queryValue(subject.id)}&user_id=eq.${queryValue(userId)}',
  "subject_schedules?select=id&user_id=eq.",
  "tasks?select=id&user_id=eq.",
  "exams?select=id&user_id=eq.",
];
for (const expected of assistantConfigOwnerGuard) {
  if (!assistantFunction.includes(expected)) failures.push(`Configuração do Assistente perdeu escopo explícito de proprietário: ${expected}`);
}

const assistantIdempotencyGuard = [
  "const dueFilter = action.dueAt",
  "tasks?select=id&user_id=eq.",
  "exams?select=id&user_id=eq.",
  "&title=eq.",
  "if (Array.isArray(existing) && existing.length) continue;",
];
for (const expected of assistantIdempotencyGuard) {
  if (!assistantFunction.includes(expected)) failures.push(`Assistente não contém proteção de idempotência esperada: ${expected}`);
}

requireIncludes("supabase/functions/ordys-assistant/index.ts", [
  "body: JSON.stringify({ ...body, store: false })",
]);

for (const expected of [
  "const SUPPORTED_FILE_MIME = new Set([",
  'if (kind === "image")',
  'if (kind === "file")',
  'const extensionAllowed = /\\.(pdf|txt|md|csv|json|doc|docx|ppt|pptx|xls|xlsx)$/i.test(name);',
  'Number.isFinite(obj["durationSeconds"])',
]) {
  if (!assistantFunction.includes(expected)) failures.push(`Assistente não contém validação esperada: ${expected}`);
}

const deleteAccountRoute = read("src/routes/excluir-conta.tsx");
for (const expected of [
  "if (isDemo || isDemoMode())",
  "getActiveLocalProfileId()",
  "deleteLocalProfile(profileId)",
  "stopDemoMode();",
]) {
  if (!deleteAccountRoute.includes(expected)) failures.push(`Exclusão de conta não trata corretamente o modo local: ${expected}`);
}
if (deleteAccountRoute.includes('supabase.functions.invoke("ordys-delete-account"') &&
    !deleteAccountRoute.includes("if (isDemo || isDemoMode())")) {
  failures.push("Exclusão de conta não pode enviar perfil local para a Edge Function de produção");
}

const privacyRoute = read("src/routes/privacidade.tsx");
for (const expected of [
  "podem ser processados pela OpenAI",
  "O processamento ocorre somente quando você aciona o recurso de IA.",

  "A conexão pode ser removida na área de Integrações do Perfil.",
  "Esses hashes permanecem pseudônimos e não são vinculados ao ID da conta",
  "o hash correspondente ao endereço de e-mail atual",
  "Essa limpeza é oportunista, não uma tarefa agendada.",
  "Na distribuição direta por APK",
  "canal de contato próprio e acessível",
  "última atualização: 31 de outubro de 2026",
  "Quando a geração de simulados estiver habilitada e for acionada",
]) {
  if (!privacyRoute.includes(expected)) failures.push(`Política de privacidade não contém divulgação esperada: ${expected}`);
}
if (privacyRoute.includes("credenciais guardadas são removidas")) {
  failures.push("Política de privacidade não deve afirmar remoção de credenciais sem implementação correspondente");
}

requireIncludes("src/routes/auth.tsx", [
  "O nome deve ter no máximo 120 caracteres.",
  "O e-mail deve ter no máximo 320 caracteres.",
  "if (cleanEmail.length > 320)",
  "const cleanName = fullName.trim();",
  "data: { full_name: cleanName }",
]);

const resetRoute = read("src/routes/redefinir-senha.tsx");
for (const expected of [
  "if (cleanEmail.length > 320)",
  "maxLength={320}",
]) {
  if (!resetRoute.includes(expected)) failures.push(`Redefinição de senha não contém limite esperado: ${expected}`);
}

const profileRoute = read("src/routes/perfil.tsx");
for (const expected of [
  "const gradeScaleMax = Number(form.grade_scale_max);",
  "const gradePass = Number(form.grade_pass);",
  "Number.isFinite",
  'new Intl.DateTimeFormat("pt-BR", { timeZone: cleanProfile.timezone }).format();',
  "timezone: cleanProfile.timezone",
  "gradePass > gradeScaleMax",
  "dailyLoadLimit > 1440",
  'remove("calendar_connections", id)',
  "await syncNativeAcademicNotifications();",
]) {
  if (!profileRoute.includes(expected)) failures.push(`Perfil não contém validação esperada: ${expected}`);
}
if (profileRoute.includes('supabase.from("calendar_connections").delete()')) {
  failures.push("Perfil não deve remover integrações por id sem filtro explícito de proprietário");
}

const vitestConfig = read("vitest.config.ts");
for (const expected of [
  'import tsconfigPaths from "vite-tsconfig-paths";',
  "plugins: [tsconfigPaths()]",
  'include: ["tests/**/*.test.ts", "src/**/*.test.ts"]',
]) {
  if (!vitestConfig.includes(expected)) failures.push(`Vitest não contém configuração esperada: ${expected}`);
}

const disciplineRoute = read("src/routes/disciplinas.tsx");
for (const expected of [
  "Informe o nome da disciplina.",
  "O fim da aula deve ser depois do início.",
  "const mastery = Number(topicForm.mastery || 0);",
  "O domínio deve estar entre 0 e 100.",
  "const maxScore = Number(gradeForm.max_score || scale);",
  "score > maxScore",
]) {
  if (!disciplineRoute.includes(expected)) failures.push(`Disciplinas não contém validação esperada: ${expected}`);
}

const performanceRoute = read("src/routes/desempenho.tsx");
for (const expected of [
  "const target = Number(form.target);",
  "const maxTarget = metric === \"media\" ? scale : metric === \"frequencia\" ? 100 : 100000;",
  "A meta de média deve ficar entre 0 e",
  "A meta de frequência deve ficar entre 0% e 100%.",
  "O alvo da meta deve estar entre zero e 100.000.",
  'metric === "tarefas" && !Number.isInteger(target)',
  "const weekStart = startOfWeek(now);",
  "weekEnd.setHours(23, 59, 59, 999);",
  "const key = dateKey(startedAt).slice(0, 7);",
  'yAxisId="grade"',
  'yAxisId="hours"',
]) {
  if (!performanceRoute.includes(expected)) failures.push(`Desempenho não contém validação esperada: ${expected}`);
}

const dashboardRoute = read("src/routes/index.tsx");
for (const expected of [
  "const weekStart = startOfWeek(now);",
  "weekEnd.setHours(23, 59, 59, 999);",
  "const weekRange = { from: weekStart, to: weekEnd };",
]) {
  if (!dashboardRoute.includes(expected)) failures.push("Dashboard não contém correção esperada para o resumo semanal: " + expected);
}

const studiesRoute = read("src/routes/estudos.tsx");
for (const expected of [
  "const todayCheckin = checkins.find((c) => c.checkin_date === todayKey) ?? null;",
  'if (todayCheckin) {',
  'update("daily_checkins", todayCheckin.id, payload)',
  "const automaticReviewSignature = [",
  "const automaticReviewSignatureRef = useRef<string | null>(null);",
  "const automaticReviewGeneratingRef = useRef(false);",
  "void ensureAutomaticReviews({ userId, topics, exams, reviews })",
  "automaticReviewSignatureRef.current = automaticReviewSignature;",
  "automaticReviewGeneratingRef.current = false;",
  "const [saving, setSaving] = useState(false);",
  "const sessionStarted = startedAt.current !== null;",
  "disabled={sessionStarted}",
  "async function saveCheckin() {",
  "Number.isInteger(studiedMinutes)",
  "studiedMinutes > 1440",
  "setSaving(true);",
  'toast.error(error instanceof Error ? error.message : "Não foi possível salvar o check-in.")',
  "const weekStart = startOfWeek(new Date());",
  "weekEnd.setHours(23, 59, 59, 999);",
]) {
  if (!studiesRoute.includes(expected)) failures.push(`Estudos não contém correção esperada: ${expected}`);
}

const quizEdgeFunction = read("supabase/functions/ordys-assistant/index.ts");
for (const expected of [
  "async function generateQuizForUser(request: Request, userId: string, body: Record<string, unknown>)",
  'await enforceUsageLimit(request, userId, "quiz_generate", 12, 36);',
  "await assertAiEligible(request, user.id);",
  'if (action === "quiz") {',
  "const generated = await callOpenAI({",
  'name: "ordys_quiz"',
]) {
  if (!quizEdgeFunction.includes(expected)) failures.push("Simulados não usam o fluxo seguro compartilhado: " + expected);
}
const simuladoRoute = read("src/routes/simulado.tsx");
if (simuladoRoute.includes("useServerFn") || simuladoRoute.includes("@/lib/quiz.functions")) {
  failures.push("Web e Android devem usar o mesmo cliente seguro de simulados");
}
for (const expected of [
  "const { isDemo } = useAuth();",
  "Simulados com IA exigem uma conta ORDYS.",
  "disabled={isDemo || !ORDYS_PLUS_AI_ENABLED || !subjectId || loading || quizInProgress}",
  "const [saving, setSaving] = useState(false);",
  "let attemptId: string | null = null;",
  'const { error: answersError } = await supabase.from("quiz_answers").insert(rows as never);',
  "if (answersError) throw new Error(answersError.message);",
  '.from("quiz_attempts")',
  '.eq("user_id", userId);',
  "disabled={saving || Object.keys(answers).length !== questions.length}",
]) {
  if (!simuladoRoute.includes(expected)) failures.push(`Simulado não contém proteção/salvamento esperado: ${expected}`);
}

const assistantRoute = read("src/routes/assistente.tsx");
for (const expected of [
  'import { useProfile } from "@/lib/ordys-db";',
  'import { canUseOrdysAi } from "@/lib/ai-eligibility";',
  "const { data: profile, isLoading: profileLoading, error: profileError } = useProfile();",
  "const aiEligibility = canUseOrdysAi(profile?.birth_date, profile?.timezone);",
  "Recursos de IA temporariamente indisponíveis",
  "disabled={isDemo || aiUnavailable}",
]) {
  if (!assistantRoute.includes(expected)) failures.push(`Tela do Assistente não contém gate de idade esperado: ${expected}`);
}
for (const expected of [
  "const { isDemo } = useAuth();",
  "O Assistente com IA exige uma conta ORDYS.",
  "disabled={isDemo || aiUnavailable || busy || preparingFiles}",
]) {
  if (!assistantRoute.includes(expected)) failures.push(`Assistente não contém proteção de modo demo: ${expected}`);
}

const demoMode = read("src/lib/demo-mode.ts");
for (const expected of [
  "const targetExists = profiles.some((p) => p.id === profileId);",
  "window.localStorage.removeItem(\`ordys_local_db_v3:\${profileId}\`);",
  "export function deleteLocalProfile(profileId: string)",
]) {
  if (!demoMode.includes(expected)) failures.push("Modo demo não contém proteção esperada: " + expected);
}

const engine = read("src/lib/ordys-engine.ts");
for (const expected of [
  "const todayKey = dateKey(today);",
  "if (topic.last_review === todayKey) continue;",
  "const existingAutomatic = new Set(",
  "const dueOn = dateKey(due < today ? today : due);",
  "if (existingAutomatic.has(\`${topic.id}:${dueOn}\`)) continue;",
]) {
  if (!engine.includes(expected)) failures.push(`Engine de revisões não contém proteção esperada: ${expected}`);
}

for (const expected of [
  "grades_score_not_above_max",
  "grades_weight_positive",
  "NOT VALID",
]) {
  if (!academicIntegrityMigration.includes(expected)) {
    failures.push(`Migration de integridade acadêmica não contém: ${expected}`);
  }
}

for (const expected of [
  "DROP CONSTRAINT IF EXISTS profiles_stage_allowed",
  "CHECK (stage IN ('fundamental','medio','superior','pos','outro'))",
]) {
  if (!profileStageMigration.includes(expected)) {
    failures.push(`Migration de etapa do perfil não contém: ${expected}`);
  }
}

const baseSchemaMigration = read("supabase/migrations/20260903193429_bbbd75d7-520e-4135-bc3e-41658fd7aac3.sql");
for (const expected of [
  "topics_mastery_range",
  "tasks_status_allowed",
  "grades_score_range",
  "grades_max_range",
  "grades_weight_range",
  "attendance_status_allowed",
  "schedules_time_order",
  "focus_actual_range",
  "quiz_correct_range",
  "checkins_focus_range",
]) {
  if (!baseSchemaMigration.includes(expected)) {
    failures.push(`Schema acadêmico base não contém: ${expected}`);
  }
}

const focusPlanMigration = read("supabase/migrations/20260927014000_focus_plan_reference_integrity.sql");
for (const expected of [
  "focus_plan_session_fk",
  "REFERENCES public.plan_sessions(id)",
  "'plan_session_id','plan_sessions'",
]) {
  if (!focusPlanMigration.includes(expected)) {
    failures.push(`Migration de integridade das sessões de foco não contém: ${expected}`);
  }
}

requireIncludes("supabase/functions/ordys-assistant/index.ts", [
  "let body: Record<string, unknown>;",
  'return response({ status: "failed", error: "Corpo JSON inválido." }, 400);',
]);
if ((assistantFunction.match(/JSON\.parse\(requestText\)/g) ?? []).length !== 1) {
  failures.push("Assistente deve realizar uma única análise do JSON de entrada");
}

const videoFunction = read("supabase/functions/ordys-video-transcribe/index.ts");
requireIncludes("supabase/functions/ordys-video-transcribe/index.ts", [
  'import { calculateAgeInTimeZone, getUserAgeProfile, isOrdysPlusEligible } from "../_shared/ordys-billing.ts";',
  "getUserAgeProfile(",
  "calculateAgeInTimeZone(ageProfile.birthDate, ageProfile.timezone)",
  "let body: Record<string, unknown>;",
  'return response({ status: "failed", error: "Corpo JSON inválido." }, 400);',
]);
if ((videoFunction.match(/await assertAiEligible\(request, userId\);/g) ?? []).length !== 1) {
  failures.push("Transcrição de vídeo deve validar elegibilidade de IA uma única vez por solicitação");
}
if (assistantFunction.includes('throw new Error(body.slice(0, 600)') || assistantFunction.includes('throw new Error(body.slice(0, 400)')) {
  failures.push("Erros brutos do Supabase não podem ser devolvidos ao cliente pelo Assistente");
}
if (videoFunction.includes('throw new Error(body.slice(0, 400)')) {
  failures.push("Erros brutos do Supabase não podem ser devolvidos ao cliente pela transcrição");
}

for (const expected of [
  "async function assertAiEligible(request: Request, userId: string)",
  "getUserAgeProfile(",
  'request.headers.get("Authorization") ?? ""',
  "calculateAgeInTimeZone(ageProfile.birthDate, ageProfile.timezone)",
  'if (age === null || age < 18)',
  "await assertAiEligible(request, userId);",
]) {
  if (!videoFunction.includes(expected)) failures.push(`Transcrição de vídeo não contém gate de idade por fuso esperado: ${expected}`);
}
requireIncludes("tests/video-transcribe-edge.test.ts", [
  "blocks transcription for a verified account under 18 before usage accounting or OpenAI",
  "fails closed when the authenticated profile has no valid time zone",
  "select=birth_date%2Ctimezone",
]);

for (const expected of [
  'const MAX_DATA_URL_CHARS = 34 * 1024 * 1024;',
  'const MAX_REQUEST_BYTES = 36 * 1024 * 1024;',
  'const contentLength = Number(request.headers.get("Content-Length") ?? 0);',
  'const requestText = await readRequestBodyWithLimit(request, MAX_REQUEST_BYTES);',
  'requestText === null',
  'if (dataUrl.length > MAX_DATA_URL_CHARS)',
  'const mimeType = (match[1] || "").toLowerCase();',
  'if (!Object.hasOwn(SUPPORTED_VIDEO_TRANSCRIPTION_FORMATS, mimeType))',
  'if (!dataUrl.includes(";base64,"))',
  'const headerMatch = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,/);',
  'const declaredDataUrlMime = (headerMatch?.[1] || "").toLowerCase();',
  'if (!supportedExtension || declaredMime !== declaredDataUrlMime || actualExtension !== supportedExtension)',
  'const { bytes, mimeType } = decodeDataUrl(dataUrl);',
  'const file = new File([bytes], filename, { type: mimeType });',
  'await consumeUsageLimit(request, userId, "video-transcription", 5, 20);',
  'const binary = atob(payload);',
]) {
  if (!videoFunction.includes(expected)) failures.push(`Transcrição de vídeo não valida o conteúdo antes do decode: ${expected}`);
}
if (
  !videoFunction.includes('const SUPPORTED_VIDEO_TRANSCRIPTION_FORMATS: Record<string, string> = {') ||
  !videoFunction.includes('"video/mp4": "mp4"') ||
  !videoFunction.includes('"video/webm": "webm"')
) {
  failures.push("Transcrição de vídeo deve manter allowlist explícita e restrita a MP4/WebM");
}
const decodePosition = videoFunction.indexOf("const { bytes, mimeType } = decodeDataUrl(dataUrl);");
const usageLimitPosition = videoFunction.indexOf('await consumeUsageLimit(request, userId, "video-transcription", 5, 20);');
if (decodePosition < 0 || usageLimitPosition < decodePosition) {
  failures.push("Transcrição de vídeo deve validar e decodificar o formato antes de consumir a cota");
}

for (const expected of [
  "focus_sessions_plan_session_fk",
  "'plan_session_id','plan_sessions'",
]) {
  if (!focusOwnershipMigration.includes(expected)) failures.push(`Migration de ownership do foco não contém: ${expected}`);
}

requireIncludes("src/routes/index.tsx", [
  'const notificationSyncRef = useRef("")',
  "notificationSyncSignature",
  "focus,",
  "prefs: prefs ?? null",
  'notificationSyncRef.current === notificationSyncSignature',
]);

const nativeNotifications = read("src/lib/native-notifications.ts");
requireIncludes("src/lib/native-notifications.ts", [
  "const [prefsResult, examsResult, tasksResult, planResult, schedulesResult, focusResult, subjectsResult]",
  "const queryErrors = [",
  "Never delete already scheduled reminders when a transient data query fails.",
  'if (queryErrors.length) {',
]);

if (!nativeNotifications.includes('const daysUntilSunday = (0 - at.getDay() + 7) % 7;')) {
  failures.push("Notificações semanais devem agendar o próximo domingo, não apenas o domingo atual");
}
if (!nativeNotifications.includes('const summaryWeekStart = startOfWeek(at);')) {
  failures.push("Resumo semanal deve usar a data da ocorrência agendada para deduplicação");
}
if (!nativeNotifications.includes('const summaryMonthStart = new Date(at.getFullYear(), at.getMonth(), 1);')) {
  failures.push("Resumo mensal deve usar o mês da ocorrência agendada para deduplicação");
}

const notificationSchemaLines = nativeNotifications.split("\n").map((line) => line.trim());
const notificationSchemaIndex = notificationSchemaLines.indexOf("notifications: [{");
const expectedNotificationSchemaLines = [
  "notifications: [{",
  "id: params.id,",
  "title: params.title,",
  "body: params.body,",
  "// Exactness belongs to LocalNotificationSchema, not its Schedule.",
  "// Keep reminders inexact to avoid exact-alarm access on Android.",
  "isExactNotification: false,",
  "schedule: {",
  "at: params.at,",
  "allowWhileIdle: true,",
  "},",
  'channelId: "ordys-general",',
];
if (
  notificationSchemaIndex < 0 ||
  expectedNotificationSchemaLines.some(
    (line, index) => notificationSchemaLines[notificationSchemaIndex + index] !== line,
  )
) {
  failures.push("Notificações nativas devem definir isExactNotification no nível de LocalNotificationSchema, fora de Schedule.");
}
const demoSupabase = read("src/lib/demo-supabase.ts");
for (const expected of [
  'daily_summary: boolean;',
  'weekly_summary: boolean;',
  'monthly_summary: boolean;',
  '"Resumo diário"',
  '"Resumo semanal"',
  '"Resumo mensal"',
]) {
  if (!nativeNotifications.includes(expected) && !nativeNotifications.includes(expected.replaceAll('"', ""))) {
    failures.push("Notificações nativas não contêm resumo esperado: " + expected);
  }
}
if (!demoSupabase.includes("monthly_summary: false,")) {
  failures.push("Modo demo deve manter monthly_summary desativado por padrão, alinhado ao banco.");
}


if (!nativeNotifications.includes("classes: boolean;")) {
  failures.push("native-notifications.ts deve tipar a preferência de aulas");
}


for (const expected of [
  'import { dateKey, ordysWeekdayToJsDay, parseTimeOfDay } from "@/lib/ordys-engine";',
  '.gte("session_date", dateKey(new Date()))',
]) {
  if (!nativeNotifications.includes(expected)) failures.push("Notificações nativas não contêm correção esperada para data local: " + expected);
}

const packageJson = JSON.parse(read("package.json"));
const supabaseClientSource = read("src/integrations/supabase/client.ts");
if (supabaseClientSource.includes("brokeredPreviewStorage") || supabaseClientSource.includes("previewAuthStorage")) {
  failures.push("Supabase client não pode usar o broker de autenticação do Lovable em builds de entrega");
}
if (packageJson.dependencies?.["@lovable.dev/cloud-auth-js"]) {
  failures.push("package.json não pode conter @lovable.dev/cloud-auth-js como dependência de runtime");
}
if (authRoute.includes('lovable.auth') || authRoute.includes('@lovable.dev/cloud-auth-js')) {
  failures.push("auth.tsx não pode depender do Lovable para autenticação");
}
const nativeAuth = read("src/lib/native-auth.ts");
requireIncludes("src/lib/native-auth.ts", [
  'import { App } from "@capacitor/app";',
  'import { Browser } from "@capacitor/browser";',
  'export const ORDYS_NATIVE_AUTH_REDIRECT_URI = "app.ordys.academy://auth/callback";',
  'App.addListener("appUrlOpen"',
  'App.getLaunchUrl()',
  'supabase.auth.exchangeCodeForSession(code)',
  'supabase.auth.setSession(',
  'skipBrowserRedirect: true',
  'await Browser.open({ url: data.url });',
  'let nativeAuthInitPromise: Promise<void> | null = null;',
  'initializeNativeAuthOnce().catch(async (error: unknown) =>',
  'await handle.remove()',
]);
requireIncludes("src/lib/native-auth.ts", [
  'parsed.protocol !== "app.ordys.academy:"',
  'parsed.hostname !== "auth"',
  'parsed.pathname !== "/callback"',
  "const RECENT_AUTH_CALLBACK_WINDOW_MS = 30_000;",
  "lastHandledAuthCallbackUrl === url",
  "if (nativeCallbackInFlight) return true;",
  "const recoveryFlow = tokenType",
  'if (tokenType && tokenType !== "recovery") clearNativeRecoveryPending();',
]);
requireIncludes("src/lib/native-auth.ts", [
  'let callbackPurpose: NativeAuthEventDetail["purpose"] = "signin";',
  'callbackPurpose = recoveryFlow ? "recovery" : "signin";',
  'if (callbackPurpose === "recovery") clearNativeRecoveryPending();',
  "O link de autenticação está incompleto. Solicite um novo e-mail ou tente novamente.",
  "callbackPurpose,",
]);
requireIncludes("src/hooks/use-auth.ts", [
  "let authStateChanged = false;",
  "authStateChanged = true;",
  "Do not erase a valid session already delivered by onAuthStateChange.",
  "if (!authStateChanged)",
  "if (timeoutId !== undefined) window.clearTimeout(timeoutId);",
  'import { getDemoUser, isDemoMode, stopDemoMode } from "@/lib/demo-mode";',
  "if (isDemoMode()) stopDemoMode();",
  "setGuest(result.data.session ? false : isDemoMode());",
]);
requireIncludes("src/lib/ordys-assistant-client.ts", [
  'import { Capacitor } from "@capacitor/core";',
  "O Assistente Ordys não respondeu pelo serviço seguro.",
  "function readFunctionResult(data: unknown, error: unknown)",
  "if (error || !data || typeof data !== \"object\") return null;",
  "if (Capacitor.isNativePlatform()) throw nativeAssistantFailure();",
]);
requireIncludes("src/lib/native-auth.ts", [
  'queryParams: { prompt: "select_account" }',
  'skipBrowserRedirect: true',
]);
requireIncludes("src/lib/ordys-assistant-client.ts", [
  'export async function generateOrdysQuiz(input: {',
  'supabase.functions.invoke("ordys-assistant", {',
  'body: { action: "quiz", ...input }',
  'O serviço não retornou a quantidade de questões solicitada.',
]);
requireIncludes("src/routes/simulado.tsx", [
  'import { generateOrdysQuiz, type OrdysQuizQuestion } from "@/lib/ordys-assistant-client";',
  "const generatedQuestions = await generateOrdysQuiz(quizInput);",
]);
requireIncludes("src/lib/ordys-ai-access.ts", [
  "ORDYS_PLUS_AI_ENABLED",
  "ORDYS_FREE_ASSIST_HOURLY_LIMIT",
  "ORDYS_FREE_ASSIST_DAILY_LIMIT",
]);
requireIncludes("supabase/functions/_shared/ordys-ai-access.ts", [
  "export const ORDYS_PLUS_AI_ENABLED = false;",
  "export const ORDYS_FREE_ASSIST_HOURLY_LIMIT = 2;",
  "export const ORDYS_FREE_ASSIST_DAILY_LIMIT = 5;",
]);
requireIncludes("supabase/functions/ordys-assistant/index.ts", [
  "ORDYS_PLUS_AI_ENABLED",
  'if (action === "quiz") {',
  'if (action === "apply-config") {',
  "ORDYS_FREE_ASSIST_HOURLY_LIMIT",
  "ORDYS_FREE_ASSIST_DAILY_LIMIT",
  'if (mode !== "assist" && !plusEligible)',
  'action === "poll"',
  'action === "cancel"',
]);
requireIncludes("supabase/functions/ordys-video-transcribe/index.ts", [
  "ORDYS_PLUS_AI_ENABLED",
  "if (!ORDYS_PLUS_AI_ENABLED)",
  "ORDYS_PLUS_LOCK_MESSAGE",
]);
if (existsSync("src/lib/quiz.functions.ts")) {
  failures.push("A implementação web antiga de simulados não pode manter um provedor de IA separado");
}
requireIncludes("src/lib/ordys-assistant-client.ts", [
  "ORDYS_PLUS_AI_ENABLED",
  'if (attachment.kind !== "video" || !attachment.dataUrl)',
  'if (!ORDYS_PLUS_AI_ENABLED)',
  "isOrdysVideoAudioTranscriptionSupported(attachment)",
  "videoNotesBlock",
  "não infira falas ou sons",
]);
requireIncludes("src/lib/ordys-video-transcription.ts", [
  'const SUPPORTED_VIDEO_AUDIO_FORMATS: Record<string, string> = {',
  '"video/mp4": "mp4"',
  '"video/webm": "webm"',
  'return actualExtension === expectedExtension;',
]);
requireIncludes("tests/ordys-video-transcription.test.ts", [
  "Ordys video audio-transcription format gate",
  "accepts MP4 and WebM only when MIME metadata and filename extension agree",
  "keeps other browser-supported video containers visual-only",
  "rejects MIME and file-extension mismatches",
]);
requireIncludes("src/routes/assistente.tsx", [
  "ORDYS_PLUS_LOCK_SHORT_MESSAGE",
  "requiresPlus: true",
  "disabled={isDemo || aiUnavailable || locked}",
]);
requireIncludes("src/routes/simulado.tsx", [
  "ORDYS_PLUS_AI_ENABLED",
  "disabled={isDemo || !ORDYS_PLUS_AI_ENABLED",
  "ORDYS_PLUS_LOCK_SHORT_MESSAGE",
]);
requireIncludes("supabase/functions/ordys-assistant/index.ts", [
  'const ASSIST_MODEL = "gpt-6-luna";',
  'const RESEARCH_MODEL = "gpt-6-luna";',
  'const DEEP_RESEARCH_MODEL = "gpt-6.1-sol";',
  'reasoning: { effort: "high" },',
  "function buildQuizSchema(questionCount: number)",
  "async function generateQuizForUser(request: Request, userId: string, body: Record<string, unknown>)",
  'await enforceUsageLimit(request, userId, "quiz_generate", 12, 36);',
  'if (action === "quiz") {',
  'return await generateQuizForUser(request, user.id, body);',
  "new Set(options).size !== 4",
  "!options.includes(correctAnswer)",
]);
requireIncludes("supabase/functions/ordys-assistant/index.ts", [
  "async function cancelOpenAIResponse(responseId: string)",
  'if (action === "cancel")',
  "await hasOwnedAssistantJob(request, user.id, responseId)",
  'status === "cancelled"',
  'status === "incomplete"',
  'status === "expired"',
  'status === "not_found"',
]);

requireIncludes("supabase/functions/ordys-assistant/index.ts", [
  "await registerAssistantJob(request, user.id, responseId);",
  "await cancelOpenAIResponse(responseId);",
  "Do not leave an untracked background response consuming resources",
]);
requireIncludes("src/lib/ordys-assistant-client.ts", [
  "export async function cancelOrdysResearch(responseId: string): Promise<OrdysAssistantResult>",
  'const body = { action: "cancel", responseId };',
]);
requireIncludes("src/routes/assistente.tsx", [
  "cancelOrdysResearch,",
  "await cancelOrdysResearch(responseId);",
  "não foi possível confirmar o cancelamento",
]);
requireIncludes("scripts/prepare-ordys-launcher-assets.sh", [
  "corner_alpha",
  "alpha_coverage",
  "ORDYS launcher foreground corner is not transparent",
  "FOREGROUND_RAW_OUTPUT",
  "-trim +repage",
  "-resize 211x211",
  "-background none",
]);
requireIncludes(".github/workflows/verify-ordys.yml", [
  "Verify transparent Android launcher foreground",
  "bash scripts/prepare-ordys-launcher-assets.sh",
  "Validate ORDYS Assistant Edge Function",
  "deno check supabase/functions/ordys-assistant/index.ts",
]);

requireIncludes("mobile/entry.tsx", [
  'import { initializeNativeAuth, NATIVE_AUTH_EVENT, type NativeAuthEventDetail } from "../src/lib/native-auth";',
  'import { toast } from "sonner";',
  "void initializeNativeAuth().catch",
  "const currentPath = router.state.location.pathname;",
  'router.navigate({ to: "/redefinir-senha" })',
  'router.navigate({ to: "/" })',
  'router.navigate({ to: "/auth" })',
  'toast.error(detail.message ?? "Não foi possível concluir o acesso com Google.")',
]);
requireIncludes("src/routes/auth.tsx", [
  'startGoogleSignIn,',
  'await startGoogleSignIn(authRedirect("/"));',
  'if (detail.purpose === "recovery")',
  'Recuperação cancelada. Você pode solicitar um novo link.',
  'Não foi possível concluir a recuperação. Solicite um novo link.',
]);
if (!read(".github/workflows/build-ordys-android.yml").includes('android:scheme="app.ordys.academy"')) {
  failures.push("workflow Android deve registrar o deep link nativo de autenticação");
}
if (!packageJson.dependencies?.["@capacitor/app"] || packageJson.dependencies["@capacitor/app"] !== "8.1.2") {
  failures.push("package.json deve fixar @capacitor/app em 8.1.2");
}
if (!packageJson.dependencies?.["@capacitor/browser"] || packageJson.dependencies["@capacitor/browser"] !== "8.0.5") {
  failures.push("package.json deve fixar @capacitor/browser em 8.0.5");
}


const runtimeDependencies = packageJson.dependencies ?? {};
if (runtimeDependencies.zod !== "4.6.7") {
  failures.push("package.json deve fixar zod na versão corrigida 4.6.7");
}
const bunLockText = read("bun.lock");
for (const lockedPackage of [
  "@tanstack/react-start@1.168.60",
  "@tanstack/router-plugin@1.168.42",
  "@tanstack/start-plugin-core@1.171.49",
  "@tanstack/start-server-core@1.169.39",
  "zod@4.6.7",
]) {
  if (!bunLockText.includes(lockedPackage)) {
    failures.push(`bun.lock deve conter a dependência corrigida: ${lockedPackage}`);
  }
}
for (const [name, expected] of [
  ["@tanstack/react-router", "1.170.41"],
  ["@tanstack/react-start", "1.168.60"],
  ["@tanstack/router-plugin", "1.168.42"],
]) {
  if (runtimeDependencies[name] !== expected) {
    failures.push(`package.json deve fixar ${name} em ${expected}`);
  }
}
const capacitor = read("capacitor.config.ts");
requireIncludes("capacitor.config.ts", [
  "appId: 'app.ordys.academy'",
  "appName: 'Ordys Academy'",
  "webDir: 'mobile-dist/client'",
  "allowMixedContent: false",
]);
if (capacitor.includes("bundledWebRuntime")) {
  failures.push("capacitor.config.ts não deve usar bundledWebRuntime, opção removida no Capacitor 7+");
}
if (/server\s*:\s*\{[\s\S]*url\s*:/i.test(capacitor)) {
  failures.push("capacitor.config.ts não pode configurar server.url para a versão de produção");
}

const workflowDirectory = ".github/workflows";
try {
  const workflowFiles = readdirSync(workflowDirectory).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  const obsoleteWorkflowNames = new Set([
    "build-ordys-apk.yml",
    "build-ordys-apk-v2.yml",
    "ordys-runner-probe.yml",
    "validate-web.yml",
  ]);
  for (const name of workflowFiles) {
    if (obsoleteWorkflowNames.has(name)) {
      failures.push(`Workflow redundante/diagnóstico ainda presente: ${name}`);
    }
  }
  for (const name of [
    "build-ordys-android.yml",
    "verify-ordys.yml",
    "deploy-ordys-assistant.yml",
    "preflight-ordys-production.yml",
  ]) {
    if (!workflowFiles.includes(name)) {
      failures.push(`Workflow obrigatório ausente: ${name}`);
    }
  }
} catch (error) {
  failures.push("Não foi possível verificar o conjunto de workflows do repositório: " + (error instanceof Error ? error.message : String(error)));
}

const verifyWebWorkflow = read(".github/workflows/verify-ordys.yml");
const codespaceBuild = read("scripts/build-ordys-codespace.sh");
requireIncludes("scripts/build-ordys-codespace.sh", [
  "export -n KEYSTORE_B64 STORE_PASSWORD KEY_ALIAS KEY_PASSWORD EXPECTED_CERT",
  "unset ORDYS_UPLOAD_KEYSTORE_B64 ORDYS_STORE_PASSWORD ORDYS_KEY_ALIAS ORDYS_KEY_PASSWORD ORDYS_EXPECTED_CERT_SHA256",
]);
requireFile("mobile/branding/ordys-launcher-official-symbol.png");
requireIncludes("scripts/prepare-ordys-launcher-assets.sh", [
  "ordys-launcher-official-symbol.png",
  "-fuzz 16%",
  "-draw 'color 0,0 floodfill'",
  "-background '#0A1128'",
  "-alpha remove",
  "channels",
  "legacy_dimensions",
]);
requireIncludes(".github/workflows/build-ordys-android.yml", [
  "bash scripts/prepare-ordys-launcher-assets.sh",
  'convert "$LEGACY_ICON_SOURCE"',
]);
requireIncludes(".github/workflows/build-ordys-android-sideload.yml", [
  "bash ../scripts/prepare-ordys-launcher-assets.sh",
  'convert "$LEGACY_ICON_SOURCE"',
]);
requireIncludes("scripts/build-ordys-codespace.sh", [
  "bash scripts/prepare-ordys-launcher-assets.sh",
  'convert "$LEGACY_ICON_SOURCE"',
]);

requireIncludes("scripts/build-ordys-codespace.sh", [
  "rm -rf android",
  "npx cap add android",
  'ICON_SOURCE="mobile/branding/ordys-launcher-official-symbol.png"',
  '"$APKSIGNER" verify --verbose --print-certs "$APK"',
  'jarsigner -verify -strict "$AAB"',
  "release-cert-sha256.txt",
  'KEYSTORE_B64="${ORDYS_UPLOAD_KEYSTORE_B64:-}"',
  'STORE_PASSWORD="${ORDYS_STORE_PASSWORD:-}"',
  'KEY_ALIAS="${ORDYS_KEY_ALIAS:-}"',
  'KEY_PASSWORD="${ORDYS_KEY_PASSWORD:-}"',
  'EXPECTED_CERT="${ORDYS_EXPECTED_CERT_SHA256:-}"',
  'unset ORDYS_UPLOAD_KEYSTORE_B64 ORDYS_STORE_PASSWORD ORDYS_KEY_ALIAS ORDYS_KEY_PASSWORD ORDYS_EXPECTED_CERT_SHA256',
  'ORDYS_STORE_PASSWORD="$STORE_PASSWORD" \\',
  'ORDYS_KEY_ALIAS="$KEY_ALIAS" \\',
  'ORDYS_KEY_PASSWORD="$KEY_PASSWORD" \\',
  "Refusing to generate or report a deliverable APK.",
]);
for (const secret of [
  "ORDYS_UPLOAD_KEYSTORE_B64",
  "ORDYS_STORE_PASSWORD",
  "ORDYS_KEY_ALIAS",
  "ORDYS_KEY_PASSWORD",
  "ORDYS_EXPECTED_CERT_SHA256",
]) {
  if (new RegExp(`^export ${secret}=`, "m").test(codespaceBuild)) {
    failures.push(`Codespaces release script must not export signing secret ${secret}.`);
  }
}
for (const forbidden of [
  "assembleDebug",
  "ordys-academy-debug.apk",
  "signingConfigs.debug",
  "matchingFallbacks = ['release', 'debug']",
]) {
  if (codespaceBuild.includes(forbidden)) {
    failures.push(`build-codespace.sh não pode conter fallback de debug: ${forbidden}`);
  }
}

requireIncludes("scripts/build-ordys-codespace.sh", [
  "clean assembleRelease",
  "bundleRelease",
  "ordys-upload-key.jks",
  "ordys-academy-release.apk",
]);
requireIncludes("scripts/build-ordys-codespace.sh", [
  'VITE_ORDYS_DISABLE_NATIVE_NOTIFICATIONS=1 npx vite build --config vite.mobile.config.ts',
  'VITE_ORDYS_DISABLE_NATIVE_NOTIFICATIONS=0 npx vite build --config vite.mobile.config.ts',
  "test -d node_modules/@capacitor/local-notifications",
  "python3 scripts/configure-ordys-notification-manifest.py sideload android/app/src/main/AndroidManifest.xml",
  "python3 scripts/configure-ordys-notification-manifest.py play android/app/src/main/AndroidManifest.xml",
  "npx cap copy android",
  "Google Play merged release manifest was not generated.",
  'APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"',
  'AAB="$ROOT/android/app/build/outputs/bundle/release/app-release.aab"',
  'AAB_CERT="$(keytool -printcert -jarfile "$AAB" | awk -f "$ROOT/scripts/extract-android-cert-sha256.awk")"',
  'test "$AAB_CERT" = "$KEY_CERT"',
]);
if (codespaceBuild.includes("rm -rf node_modules/@capacitor/local-notifications")) {
  failures.push("Build Codespaces não pode remover o plugin nativo antes de gerar o AAB Play.");
}
requireIncludes("scripts/ensure-ordys-android.sh", [
  'AAB="dist-android/ordys-academy-play.aab"',
  'sha256sum --status -c "$APK.sha256"',
  'sha256sum --status -c "$AAB.sha256"',
  'test -s "$AAB"',
  'test -s "$AAB.sha256"',
]);

requireIncludes("scripts/extract-android-cert-sha256.awk", [
  "Certificate fingerprints",
  "SHA256",
  "length(fingerprint) != 64",
]);
for (const [path, source] of [
  ["scripts/create-android-release-keystore.sh", read("scripts/create-android-release-keystore.sh")],
  ["scripts/configure-android-release-signing.sh", read("scripts/configure-android-release-signing.sh")],
  ["scripts/build-ordys-codespace.sh", read("scripts/build-ordys-codespace.sh")],
  [".github/workflows/build-ordys-android.yml", read(".github/workflows/build-ordys-android.yml")],
  [".github/workflows/build-ordys-android-sideload.yml", read(".github/workflows/build-ordys-android-sideload.yml")],
]) {
  if (!source.includes("extract-android-cert-sha256.awk")) {
    failures.push(path + " deve usar o parser centralizado do fingerprint SHA-256");
  }
}

requireIncludes("scripts/create-android-release-keystore.sh", [
  "export -n OUT ALIAS STORE_PASSWORD KEY_PASSWORD KEYSTORE_B64",
  "unset ORDYS_KEYSTORE_PATH ORDYS_KEY_ALIAS ORDYS_UPLOAD_KEYSTORE_B64 ORDYS_STORE_PASSWORD ORDYS_KEY_PASSWORD ORDYS_EXPECTED_CERT_SHA256",
  'ORDYS_STORE_PASSWORD="$STORE_PASSWORD" \\',
  'ORDYS_KEY_PASSWORD="$KEY_PASSWORD" \\',
]);

const fingerprintFixture = [
  "Alias name: ordys-upload",
  "Creation date: Oct 29, 2026",
  "Certificate fingerprints:",
  "         SHA1: 11:22:33:44",
  "         SHA256: A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90",
  "Signature algorithm name: SHA256withRSA",
].join("\n");
const expectedFingerprint = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
try {
  const actualFingerprint = execFileSync(
    "awk",
    ["-f", "scripts/extract-android-cert-sha256.awk"],
    { input: fingerprintFixture, encoding: "utf8" },
  ).trim();
  if (actualFingerprint !== expectedFingerprint) {
    failures.push("Parser de fingerprint SHA-256 retornou um valor incorreto");
  }
} catch (error) {
  failures.push("Parser de fingerprint SHA-256 falhou no caso válido: " + (error instanceof Error ? error.message : String(error)));
}

try {
  execFileSync(
    "awk",
    ["-f", "scripts/extract-android-cert-sha256.awk"],
    { input: "Certificate fingerprints:\nSHA1: 11:22:33:44\nSignature algorithm name: SHA256withRSA\n", encoding: "utf8" },
  );
  failures.push("Parser de fingerprint deve falhar quando o SHA-256 estiver ausente");
} catch {
  // Expected: missing fingerprints must fail closed.
}

const androidWorkflow = read(".github/workflows/build-ordys-android.yml");
const androidSideloadWorkflow = read(".github/workflows/build-ordys-android-sideload.yml");

requireIncludes(".github/workflows/build-ordys-android.yml", [
  'VITE_ORDYS_DISABLE_NATIVE_NOTIFICATIONS: "1"',
  'VITE_ORDYS_DISABLE_NATIVE_NOTIFICATIONS: "0"',
  "Keep native notifications plugin available for Google Play AAB only",
  "Build Google Play client with native notifications enabled",
  "python3 scripts/configure-ordys-notification-manifest.py sideload android/app/src/main/AndroidManifest.xml",
  "python3 scripts/configure-ordys-notification-manifest.py play android/app/src/main/AndroidManifest.xml",
  "npx cap copy android",
  "Verify Google Play merged notification manifest",
  "merged_manifest",
  "merged_manifests",
  "Google Play merged release manifest was not generated.",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.WAKE_LOCK",
  "Reassert direct APK removal of scheduled-notification permissions",
  "Direct-install APK unexpectedly includes scheduled notification permission",
]);
requireIncludes(".github/workflows/build-ordys-android-sideload.yml", [
  'VITE_ORDYS_DISABLE_NATIVE_NOTIFICATIONS: "1"',
  "python3 ../scripts/configure-ordys-notification-manifest.py sideload app/src/main/AndroidManifest.xml",
  "python3 scripts/configure-ordys-notification-manifest.py sideload android/app/src/main/AndroidManifest.xml",
  "Direct-install APK unexpectedly includes scheduled notification permission",
]);
requireIncludes(".github/workflows/build-ordys-android-sideload.yml", [
  "export -n KEYSTORE_B64 STORE_PASSWORD KEY_ALIAS KEY_PASSWORD",
  'ORDYS_STORE_PASSWORD="$STORE_PASSWORD" keytool',
  'ORDYS_STORE_PASSWORD="$STORE_PASSWORD" ORDYS_KEY_PASSWORD="$KEY_PASSWORD" jarsigner',
  "unset STORE_PASSWORD KEY_PASSWORD KEY_ALIAS",
  "signingConfigs {",
]);
requireIncludes(".github/workflows/build-ordys-android.yml", [
  "export -n KEYSTORE_B64 STORE_PASSWORD KEY_ALIAS KEY_PASSWORD",
  'ORDYS_STORE_PASSWORD="$STORE_PASSWORD" keytool',
  'ORDYS_STORE_PASSWORD="$STORE_PASSWORD" ORDYS_KEY_PASSWORD="$KEY_PASSWORD" jarsigner',
  "unset STORE_PASSWORD KEY_PASSWORD KEY_ALIAS",
]);
requireIncludes(".github/workflows/build-ordys-android-sideload.yml", [
  "export -n STORE_PASSWORD KEY_ALIAS",
  "unset ORDYS_STORE_PASSWORD ORDYS_KEY_ALIAS",
  'ORDYS_STORE_PASSWORD="$STORE_PASSWORD" keytool',
]);
requireIncludes(".github/workflows/build-ordys-android.yml", [
  "export -n STORE_PASSWORD KEY_ALIAS",
  "unset ORDYS_STORE_PASSWORD ORDYS_KEY_ALIAS",
  'ORDYS_STORE_PASSWORD="$STORE_PASSWORD" keytool',
]);
requireIncludes(".github/workflows/build-ordys-android.yml", [
  "ORDYS_UPLOAD_KEYSTORE_B64_PRESENT: ${{ secrets.ORDYS_UPLOAD_KEYSTORE_B64 != '' }}",
  "ORDYS_STORE_PASSWORD_PRESENT: ${{ secrets.ORDYS_STORE_PASSWORD != '' }}",
  "ORDYS_KEY_ALIAS_PRESENT: ${{ secrets.ORDYS_KEY_ALIAS != '' }}",
  "ORDYS_KEY_PASSWORD_PRESENT: ${{ secrets.ORDYS_KEY_PASSWORD != '' }}",
  "ORDYS_UPLOAD_KEYSTORE_B64: ${{ secrets.ORDYS_UPLOAD_KEYSTORE_B64 }}",
]);
requireIncludes(".github/workflows/build-ordys-android-sideload.yml", [
  "ORDYS_UPLOAD_KEYSTORE_B64_PRESENT: ${{ secrets.ORDYS_UPLOAD_KEYSTORE_B64 != '' }}",
  "ORDYS_STORE_PASSWORD_PRESENT: ${{ secrets.ORDYS_STORE_PASSWORD != '' }}",
  "ORDYS_KEY_ALIAS_PRESENT: ${{ secrets.ORDYS_KEY_ALIAS != '' }}",
  "ORDYS_KEY_PASSWORD_PRESENT: ${{ secrets.ORDYS_KEY_PASSWORD != '' }}",
]);
requireIncludes(".github/workflows/build-ordys-android-sideload.yml", [
  "Build release APK",
  "Publish verified release artifacts",
  "app-release.apk",
  "app-release.apk.sha256",
  "ORDYS_STORE_PASSWORD: ${{ secrets.ORDYS_STORE_PASSWORD }}",
  "ORDYS_KEY_ALIAS: ${{ secrets.ORDYS_KEY_ALIAS }}",
  "ORDYS_KEY_PASSWORD: ${{ secrets.ORDYS_KEY_PASSWORD }}",
]);
requireFile("tests/android-sideload-signing-env.test.ts");
requireFile("tests/android-codespace-release-verification.test.ts");
requireFile("tests/codespace-signing-environment.test.ts");
requireFile("tests/android-release-checksum-artifacts.test.ts");
requireFile("tests/edge-function-error-logging.test.ts");
requireFile("tests/server-error-logging.test.ts");
requireFile("tests/google-auth-timeout.test.ts");
requireFile("tests/ordys-billing-webhook-body-limit.test.ts");
const directApkWorkflow = read(".github/workflows/build-ordys-android-sideload.yml");
const directApkStepStart = directApkWorkflow.indexOf("      - name: Build release APK");
const directApkStepEnd = directApkWorkflow.indexOf("      - name: Verify final distribution artifacts", directApkStepStart);
if (directApkStepStart < 0 || directApkStepEnd <= directApkStepStart) {
  failures.push("Workflow de APK direto deve ter uma etapa de build Gradle identificável e delimitada.");
} else {
  const directApkStep = directApkWorkflow.slice(directApkStepStart, directApkStepEnd);
  for (const secret of ["ORDYS_STORE_PASSWORD", "ORDYS_KEY_ALIAS", "ORDYS_KEY_PASSWORD"]) {
    if (!directApkStep.includes(`${secret}: \${{ secrets.${secret} }}`)) {
      failures.push(`Build do APK direto deve repassar ${secret} ao processo Gradle na própria etapa.`);
    }
  }
}
const sideloadWorkflowSource = read(".github/workflows/build-ordys-android-sideload.yml");
if (sideloadWorkflowSource.includes("bundleRelease") || sideloadWorkflowSource.includes("app-release.aab")) {
  failures.push("O workflow de instalação direta não pode publicar AAB para Google Play.");
}
if (androidWorkflow.includes("rm -rf node_modules/@capacitor/local-notifications")) {
  failures.push("O workflow combinado não pode remover o plugin nativo antes de construir o AAB Play.");
}
const apkBuildIndex = androidWorkflow.indexOf("./gradlew --no-daemon -Pandroid.injected.testOnly=false assembleRelease");
const playClientIndex = androidWorkflow.indexOf("Build Google Play client with native notifications enabled");
const playAabIndex = androidWorkflow.indexOf("./gradlew --no-daemon bundleRelease");
if (apkBuildIndex < 0 || playClientIndex <= apkBuildIndex || playAabIndex <= playClientIndex) {
  failures.push("O APK direto deve ser construído antes da recompilação do cliente Play e do AAB.");
}

for (const [workflowPath, workflowSource] of [
  [".github/workflows/build-ordys-android.yml", androidWorkflow],
  [".github/workflows/build-ordys-android-sideload.yml", androidSideloadWorkflow],
]) {
  for (const secret of [
    "ORDYS_UPLOAD_KEYSTORE_B64",
    "ORDYS_STORE_PASSWORD",
    "ORDYS_KEY_ALIAS",
    "ORDYS_KEY_PASSWORD",
    "ORDYS_EXPECTED_CERT_SHA256",
  ]) {
    if (!workflowSource.includes("secrets." + secret)) {
      failures.push(workflowPath + " deve exigir o secret de assinatura " + secret);
    }
  }
  if (!workflowSource.includes('android:path="/callback"')) {
    failures.push(workflowPath + " deve usar callback OAuth com path exato /callback");
  }
}

if (!/uses:\s*actions\/checkout@v7\.0\.1[\s\S]*?persist-credentials:\s*false/.test(verifyWebWorkflow)) {
  failures.push("verify-ordys.yml deve usar checkout v7.0.1 com credenciais não persistidas");
}
if (!/uses:\s*actions\/checkout@v7\.0\.1[\s\S]*?persist-credentials:\s*false/.test(androidWorkflow)) {
  failures.push("workflow Android deve usar checkout v7.0.1 com credenciais não persistidas");
}

const frozenBunInstall = "bun install --frozen-lockfile --ignore-scripts";
requireFile("bun.lock");
requireIncludes("bunfig.toml", [
  'linker = "hoisted"',
  "minimumReleaseAge = 86400",
]);
if (packageJson.packageManager !== "bun@1.4.4") {
  failures.push("package.json deve fixar o gerenciador Bun em 1.4.4");
}
for (const [name, version] of [
  ["@capacitor/cli", "8.5.2"],
  ["@capacitor/android", "8.5.2"],
]) {
  if (packageJson.devDependencies?.[name] !== version) {
    failures.push(`package.json deve fixar ${name} em ${version} nas devDependencies`);
  }
}
if (packageJson.dependencies?.["@capacitor/core"] !== "8.5.2") {
  failures.push("package.json deve manter @capacitor/core em 8.5.2");
}
if (packageJson.devDependencies?.vite !== "^8.2.4") {
  failures.push("package.json deve exigir Vite corrigido em >=8.2.4 dentro da série 8.x");
}
for (const [name, version] of [
  ["js-yaml", "4.3.2"],
  ["nanoid", "3.3.18"],
  ["source-map-js", "1.2.2"],
]) {
  if (packageJson.overrides?.[name] !== version) {
    failures.push(`package.json deve fixar ${name} em ${version} para corrigir advisories conhecidos`);
  }
}

const dependencyBuildSources = [
  [".github/workflows/verify-ordys.yml", verifyWebWorkflow],
  [".github/workflows/build-ordys-android.yml", androidWorkflow],
  [".github/workflows/build-ordys-android-sideload.yml", androidSideloadWorkflow],
  ["scripts/build-ordys-codespace.sh", codespaceBuild],
];
for (const [path, source] of dependencyBuildSources) {
  if (!source.includes(frozenBunInstall)) {
    failures.push(`${path} deve instalar a partir de bun.lock com --frozen-lockfile e --ignore-scripts`);
  }
  if (!source.includes("npm run verify:deps")) {
    failures.push(`${path} deve executar a auditoria IOC da árvore instalada antes dos lifecycle scripts`);
  }
  if (!source.includes("npm rebuild --foreground-scripts")) {
    failures.push(`${path} deve executar lifecycle scripts somente após a auditoria IOC`);
  }
  const installIndex = source.indexOf(frozenBunInstall);
  const iocIndex = source.indexOf("npm run verify:deps");
  const rebuildIndex = source.indexOf("npm rebuild --foreground-scripts");
  if (installIndex < 0 || iocIndex < 0 || rebuildIndex < 0 || !(installIndex < iocIndex && iocIndex < rebuildIndex)) {
    failures.push(`${path} deve instalar, auditar IOCs e só depois executar lifecycle scripts`);
  }
  if (!source.includes("bun audit --prod --audit-level=high")) {
    failures.push(`${path} deve auditar dependências de produção pelo bun.lock`);
  }
}

for (const [path, source] of dependencyBuildSources.slice(0, 3)) {
  if (!source.includes("uses: oven-sh/setup-bun@v2.2.0") || !source.includes("bun-version-file: package.json")) {
    failures.push(`${path} deve instalar a versão Bun declarada em package.json`);
  }
}
if (!codespaceBuild.includes('npm install --global --no-audit --no-fund "bun@$BUN_VERSION"')) {
  failures.push("Codespaces deve instalar Bun pela versão declarada em package.json quando necessário");
}
if (!codespaceBuild.includes('if [ "$(bun --version)" != "$BUN_VERSION" ]; then')) {
  failures.push("Codespaces deve confirmar que a versão instalada de Bun corresponde a packageManager");
}

const productionSecretsSetup = read("scripts/configure-production-secrets.sh");
requireIncludes("scripts/configure-production-secrets.sh", [
  'readonly REPO="igniteprosperety-collab/ordys-academy.app"',
  'readonly PROJECT_ID="yqljcoukgpqdoxiispyn"',
  'gh auth status --hostname github.com',
  "gh api \"repos/$REPO\" --jq '.permissions.admin'",
  'https://api.supabase.com/v1/projects/$PROJECT_ID',
  'https://api.supabase.com/v1/projects/$PROJECT_ID/config/auth',
  "Grant the fine-grained token permission auth_config_read for this project (OAuth integrations use the auth:read scope)",
  "Auth configuration read permission verified; no Auth settings were changed.",
  "remove_existing_web_origin=false",
  'gh secret delete ORDYS_PUBLIC_APP_URL --repo "$REPO"',
  'read -r -p "Remove only this old web-origin secret for Android-only mode? [y/N] " remove_answer',
  'gh secret set SUPABASE_ACCESS_TOKEN --repo "$REPO"',
  'gh secret set SUPABASE_PROJECT_ID --repo "$REPO"',
  'gh secret set SUPABASE_DB_PASSWORD --repo "$REPO"',
  'read -r -p "Official public HTTPS origin for browser recovery (optional; press Enter for Android-only): " ORDYS_PUBLIC_APP_URL',
  'if [[ -n "$ORDYS_PUBLIC_APP_URL" ]]; then',
  'gh secret set ORDYS_PUBLIC_APP_URL --repo "$REPO"',
  "web_origin_configured=false",
  'web_origin_configured=true',
  'if [[ "$web_origin_configured" == "true" ]]; then',
]);
if (/^\s*set\s+-[^\n]*x/m.test(productionSecretsSetup)) {
  failures.push("Helper de secrets de produção não pode habilitar shell tracing");
}
if (/echo\s+["'].*(?:SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD)/.test(productionSecretsSetup)) {
  failures.push("Helper de secrets de produção não pode imprimir credenciais");
}
const androidSigningSetup = read("scripts/configure-android-release-signing.sh");
requireIncludes("scripts/configure-android-release-signing.sh", [
  "export -n KEYSTORE_PATH STORE_PASSWORD KEY_ALIAS KEY_PASSWORD KEYSTORE_B64 FINGERPRINT",
  'KEYSTORE_PATH="${ORDYS_KEYSTORE_PATH:-}"',
  'STORE_PASSWORD="${ORDYS_STORE_PASSWORD:-}"',
  'KEY_ALIAS="${ORDYS_KEY_ALIAS:-}"',
  'KEY_PASSWORD="${ORDYS_KEY_PASSWORD:-}"',
  'unset ORDYS_KEYSTORE_PATH ORDYS_STORE_PASSWORD ORDYS_KEY_ALIAS ORDYS_KEY_PASSWORD',
  'readonly REPO="igniteprosperety-collab/ordys-academy.app"',
  'gh auth status --hostname github.com',
  "gh repo view \"$REPO\" --json nameWithOwner --jq '.nameWithOwner'",
  "gh api \"repos/$REPO\" --jq '.permissions.admin'",
  'if [[ "$actual_repo" != "$REPO" ]]; then',
  'if [[ "$is_admin" != "true" ]]; then',
  'gh secret set ORDYS_UPLOAD_KEYSTORE_B64 --repo "$REPO"',
  'gh secret set ORDYS_STORE_PASSWORD --repo "$REPO"',
  'gh secret set ORDYS_KEY_ALIAS --repo "$REPO"',
  'gh secret set ORDYS_KEY_PASSWORD --repo "$REPO"',
  'gh secret set ORDYS_EXPECTED_CERT_SHA256 --repo "$REPO"',
]);
if (/gh repo view --json nameWithOwner -q/.test(androidSigningSetup)) {
  failures.push("Helper de assinatura Android não pode enviar secrets ao repositório corrente sem validar o destino oficial.");
}
if (/echo\s+["'].*(?:ORDYS_STORE_PASSWORD|ORDYS_KEY_PASSWORD|ORDYS_UPLOAD_KEYSTORE_B64)/.test(androidSigningSetup)) {
  failures.push("Helper de assinatura Android não pode imprimir senhas nem conteúdo do keystore.");
}
try {
  execFileSync("bash", ["-n", "scripts/configure-android-release-signing.sh"], { stdio: "pipe" });
} catch (error) {
  failures.push("Helper de assinatura Android contém sintaxe Bash inválida: " + (error instanceof Error ? error.message : String(error)));
}

const authConfigStart = productionSecretsSetup.indexOf("if ! auth_config=");
if (authConfigStart >= 0) {
  const authConfigLines = productionSecretsSetup.slice(authConfigStart).split("\n");
  const headerLine = authConfigLines.find((line) => line.includes("printf 'header = "));
  const curlLine = authConfigLines.find((line) => line.includes("curl --config - --fail --silent --show-error"));
  const backslash = String.fromCharCode(92);
  const headerBackslashes = headerLine ? [...headerLine].filter((character) => character === backslash).length : 0;
  if (!headerLine || headerBackslashes !== 1) {
    failures.push("Helper Supabase deve escrever um único newline no curl config de Auth");
  }
  if (!curlLine || !curlLine.trimEnd().endsWith(backslash)) {
    failures.push("Chamada curl da configuração Auth precisa continuar corretamente para a URL do projeto");
  }
}

try {
  execFileSync("bash", ["-n", "scripts/configure-production-secrets.sh"], { stdio: "pipe" });
} catch (error) {
  failures.push("Helper de secrets de produção contém sintaxe Bash inválida: " + (error instanceof Error ? error.message : String(error)));
}

const deployWorkflow = read(".github/workflows/deploy-ordys-assistant.yml");
requireIncludes(".github/workflows/deploy-ordys-assistant.yml", [
  'ORDYS_PUBLIC_APP_URL: ${{ secrets.ORDYS_PUBLIC_APP_URL }}',
  'supabase --yes secrets set "ORDYS_PUBLIC_APP_URL=$ORDYS_PUBLIC_APP_URL"',
  "persist-credentials: false",
  "uses: actions/checkout@v7.0.1",
  "deno-version: 2.9.7",
  "Run ORDYS static security verification",
  "uses: supabase/setup-cli@v3.0.1",
  "uses: denoland/setup-deno@v2.0.5",
  "version: 2.118.0",
  "supabase db lint --linked --level error",
  "supabase db push --linked --dry-run",
]);

requireIncludes(".github/workflows/build-ordys-android.yml", [
  "storeFile file('ordys-upload-key.jks')",
  "signingConfig signingConfigs.release",
]);

requireIncludes(".github/workflows/build-ordys-android.yml", [
  'android:usesCleartextTraffic="false"',
  "public/icon-512.png",
  "public/icon-512-maskable.png",
  "mobile/branding/ordys-launcher-official-symbol.png",
  "package: name='app.ordys.academy'",
  "Unit tests",
  "Lint",
  "Production web build",
  "assembleRelease",
  "bundleRelease",
  "Prepare Android signing",
  "Configure Android signing",
  "Record release certificate fingerprint",
  "release-cert-sha256.txt",
  "app-release.apk.sha256",
  "app-release.aab.sha256",
  'android:allowBackup="false"',
  'android:fullBackupContent="@xml/backup_rules"',
  'android:dataExtractionRules="@xml/data_extraction_rules"',
  '<exclude domain="root" path="." />',
  'android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove"',
  'Signer #1 certificate SHA-256 digest:',
  'test "$APK_CERT" = "$KEY_CERT"',
  'AAB_CERT="$(awk -f scripts/extract-android-cert-sha256.awk /tmp/ordys-aab-cert.txt)"',
  'test "$AAB_CERT" = "$KEY_CERT"',
  'test "$AAB_CERT" = "$EXPECTED_CERT"',
  "ordys-academy-release-apk",
]);
const androidTriggerBlock = androidWorkflow.split("\njobs:")[0];
if (!androidTriggerBlock.includes("workflow_dispatch:")) {
  failures.push("workflow Android deve permanecer manual para preservar a cota de compilação gratuita");
}
if (/^\s{2}(push|pull_request):/m.test(androidTriggerBlock)) {
  failures.push("workflow Android não deve consumir Actions automaticamente em pushes ou pull requests");
}

if (!/runs-on:\s*ubuntu-24\.04/.test(androidWorkflow)) {
  failures.push("workflow Android deve usar runner Ubuntu pinado");
}
if (/permissions:\s*\n\s*write-all/i.test(androidWorkflow)) {
  failures.push("workflow Android não pode usar permissões write-all");
}
if (!androidWorkflow.includes("app = re.search(r'<application\\b[^>]*>', s)")) {
  failures.push("Workflow Android deve usar um matcher válido para o elemento <application>");
}
if (androidWorkflow.includes("app = re.search(r'<application\\\\b[^>]*>', s)")) {
  failures.push("Workflow Android contém um regex de <application> com barra invertida duplicada");
}
if (!androidWorkflow.includes("re.finditer(r'<activity\\b[\\s\\S]*?</activity>', s)")) {
  failures.push("Workflow Android deve usar matcher válido para encontrar a activity de lançamento");
}
if (androidWorkflow.includes("re.finditer(r'<activity\\\\b")) {
  failures.push("Workflow Android contém regex duplicada ao localizar a activity de lançamento");
}
if (!androidWorkflow.includes("Refusing to publish an untrusted/debug-signed APK.")) {
  failures.push("workflow Android deve recusar qualquer publicação sem assinatura de release");
}
for (const forbidden of [
  "assembleDebug",
  "ordys-academy-installable-debug-apk",
  "signingConfigs.debug",
  "direct-install",
]) {
  if (androidWorkflow.includes(forbidden)) {
    failures.push(`workflow Android não pode publicar o artefato legado: ${forbidden}`);
  }
}

if (!verifyWebWorkflow.includes("Mobile client build")) {
  failures.push("verify-ordys.yml deve manter cobertura de build do cliente mobile");
}
if (!verifyWebWorkflow.includes("npx vite build --config vite.mobile.config.ts")) {
  failures.push("verify-ordys.yml deve executar o build do cliente mobile");
}
if (!androidWorkflow.includes("Unit tests") || !androidWorkflow.includes("Lint") || !androidWorkflow.includes("Production web build")) {
  failures.push("workflow Android deve funcionar como gate único de qualidade do main");
}

if (!androidWorkflow.includes("uses: actions/setup-node@v7.0.0")) {
  failures.push("workflow Android deve usar actions/setup-node@v7.0.0");
}
if (!verifyWebWorkflow.includes("uses: actions/setup-node@v7.0.0")) {
  failures.push("verify-ordys.yml deve usar actions/setup-node@v7.0.0");
}
for (const expected of [
  "uses: actions/setup-java@v6.0.1",
  "uses: actions/upload-artifact@v7.0.1",
]) {
  if (!androidWorkflow.includes(expected)) {
    failures.push(`workflow Android perdeu runtime de action fixado: ${expected}`);
  }
}

const transcriptionFunction = read("supabase/functions/ordys-video-transcribe/index.ts");
if (!transcriptionFunction.includes('form.append("model", "gpt-transcribe");')) {
  failures.push("Video transcription must use the current gpt-transcribe model.");
}
if (transcriptionFunction.includes("gpt-4o-transcribe")) {
  failures.push("Video transcription must not use the deprecated gpt-4o-transcribe model.");
}

const serverEntry = read("src/server.ts");
if (
  !serverEntry.includes('const isProduction = process.env.NODE_ENV === "production" || import.meta.env.PROD;') &&
  !serverEntry.includes('const isProduction = process.env["NODE_ENV"] === "production" || import.meta.env.PROD;')
) {
  failures.push("server.ts deve determinar o ambiente de produção por NODE_ENV ou import.meta.env.PROD.");
}
requireIncludes("src/server.ts", [
  'if (isProduction) {',
  'headers.set("X-Frame-Options", "DENY");',
  'headers.set("X-Permitted-Cross-Domain-Policies", "none")',
  'headers.set("Cache-Control", "no-store")',
  'headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups")',
  'return applySecurityHeaders(new Response(renderErrorPage(), {',
]);

const trackedEnv = (() => {
  try {
    return execFileSync("git", ["ls-files", "--error-unmatch", ".env"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
})();

if (trackedEnv) failures.push("O arquivo .env não pode ser versionado");

requireIncludes("src/routes/__root.tsx", [
  'className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary',
  'className="inline-flex min-h-11 items-center justify-center rounded-md border border-input',
]);

const appButtonFiles = [
  "src/routes/__root.tsx",
  "src/routes/agenda.tsx",
  "src/routes/assistente.tsx",
  "src/routes/auth.tsx",
  "src/routes/desempenho.tsx",
  "src/routes/disciplinas.tsx",
  "src/routes/estudos.tsx",
  "src/routes/excluir-conta.tsx",
  "src/routes/index.tsx",
  "src/routes/perfil.tsx",
  "src/routes/privacidade.tsx",
  "src/routes/redefinir-senha.tsx",
  "src/routes/simulado.tsx",
  "src/routes/tarefas.tsx",
  "src/components/ordys/ai-content-report-button.tsx",
  "src/components/ordys/assistant-panels.tsx",
  "src/components/ordys/brand-lockup.tsx",
  "src/components/ordys/color-selector.tsx",
  "src/components/ordys/form.tsx",
  "src/components/ordys/primitives.tsx",
  "src/components/ordys/quick-capture.tsx",
  "src/components/ordys/shell.tsx",
];

for (const path of appButtonFiles) {
  const source = read(path);
  let cursor = 0;
  while ((cursor = source.indexOf("<button", cursor)) >= 0) {
    const end = source.indexOf(">", cursor);
    if (end < 0) break;
    const openingTag = source.slice(cursor, end + 1);
    if (!/\btype\s*=/.test(openingTag)) {
      failures.push(`${path}: todo <button> deve declarar type explicitamente`);
      break;
    }
    cursor = end + 1;
  }
}



requireFile("supabase/functions/_shared/ai-content-report.ts");
requireIncludes(".github/workflows/validate-github-workflows.yml", [
  "pull_request:",
  '".github/workflows/**"',
  "run: actionlint",
]);
requireFile("supabase/functions/ordys-ai-report/index.ts");
requireIncludes(".github/workflows/verify-ordys.yml", [
  "group: ordys-supabase-integration-${{ github.ref }}",
  "cancel-in-progress: false",
]);
requireFile("supabase/migrations/20261031030000_ai_content_reports.sql");
requireFile("tests/ai-content-report.test.ts");

requireFile("docs/AI-CONTENT-REPORTING.md");
requireIncludes("supabase/functions/_shared/ai-content-report.ts", [
  'contentChars: 20_000',
  'detailsChars: 600',
  '"personal_data"',
  "parseAiContentReport",
]);
requireIncludes("supabase/functions/ordys-ai-report/index.ts", [
  '"/auth/v1/user"',
  '"/rest/v1/rpc/insert_ai_content_report"',
  'AI_CONTENT_REPORT_LIMITS.requestBytes',
  'return response({ status: "received" });',
  'Authorization: authorization',
]);
requireIncludes("supabase/migrations/20261031030000_ai_content_reports.sql", [
  "CREATE TABLE public.ai_content_reports",
  "REFERENCES auth.users(id) ON DELETE CASCADE",
  "ALTER TABLE public.ai_content_reports ENABLE ROW LEVEL SECURITY",
  "REVOKE ALL ON public.ai_content_reports FROM PUBLIC, anon, authenticated",
  "GRANT SELECT, INSERT ON public.ai_content_reports TO service_role",
  "pg_advisory_xact_lock",
  "reports_in_window >= 10",
  "GRANT EXECUTE ON FUNCTION public.insert_ai_content_report",
]);
requireIncludes("src/components/ordys/ai-content-report-button.tsx", [
  'supabase.functions.invoke("ordys-ai-report"',
  "Sinalizar conteúdo gerado por IA",
  "O restante da conversa e seus anexos não serão incluídos no relato.",
  "Enviar relato",
]);
requireIncludes("src/routes/assistente.tsx", [
  'AiContentReportButton source="assistant"',
]);
requireIncludes("src/routes/simulado.tsx", [
  'label="Sinalizar questão"',
  'source="quiz"',
]);
requireIncludes("src/routes/privacidade.tsx", [
  "Sinalizar conteúdo",
  "Somente o conteúdo de IA selecionado",
  "Os relatos de conteúdo de IA também são excluídos quando a conta correspondente é excluída.",
]);
requireIncludes("supabase/config.toml", [
  "[functions.ordys-ai-report]",
  "verify_jwt = true",
]);


const billingMigration = "supabase/migrations/20261031010000_ordys_plus_billing_foundation.sql";
requireFile(billingMigration);
requireIncludes(billingMigration, [
  "CREATE TABLE IF NOT EXISTS public.ordys_billing_settings",
  "CREATE TABLE IF NOT EXISTS public.ordys_billing_plans",
  "CREATE TABLE IF NOT EXISTS public.ordys_billing_checkout_attempts",
  "CREATE TABLE IF NOT EXISTS public.ordys_billing_subscriptions",
  "CREATE TABLE IF NOT EXISTS public.ordys_billing_payments",
  "CREATE TABLE IF NOT EXISTS public.ordys_billing_webhook_events",
  "COALESCE(\n      (SELECT settings.billing_enabled FROM public.ordys_billing_settings AS settings WHERE settings.id = 1),\n      FALSE\n    )",
  "WHERE status IN ('creating', 'pending', 'paid')",
  "RETURN FALSE;",
  "subscription.current_period_end IS NOT NULL AND subscription.grace_until > now()",
  "WHEN current_period_end IS NOT NULL THEN GREATEST(current_period_end, now()) + INTERVAL '3 days'",
  "'PAYMENT_REPROVED_BY_RISK_ANALYSIS'",
  "'PAYMENT_REFUND_IN_PROGRESS'",
  "attempt.provider_customer_id = v_customer_id",
  "attempt.status IN ('creating', 'pending', 'paid', 'linked')",
  "attempt.status = 'paid'",
  "v_external_reference IS NULL AND v_customer_id IS NOT NULL",
  "v_customer_candidate_count = 1",
  "v_customer_candidate_count > 1",
  "error_code = 'ambiguous_customer_association'",
  "CASE WHEN status = 'suspended' THEN 'suspended' ELSE 'cancelled' END",
  "status IN ('cancelled', 'suspended') THEN status ELSE 'active' END",
  "status IN ('cancelled', 'suspended')",
  "status NOT IN ('cancelled', 'suspended')",
  "ambiguous_customer_association",
  "subscription_checkout_unmatched",
  "payment_subscription_unmatched",
  "confirmed_payment_unmatched",
  "subscription_customer_mismatch",
  "payment_customer_mismatch",
  "v_customer_id <> v_attempt.provider_customer_id",
  "checkout_paid_after_closed",
  "attempt.external_reference = v_external_reference",
  "NULLIF(v_payment ->> 'customer', '') <> v_billing_subscription.provider_customer_id",
  "NULLIF(v_subscription ->> 'billingType', '') IS DISTINCT FROM 'CREDIT_CARD'",
  "NULLIF(v_payment ->> 'billingType', '') IS DISTINCT FROM 'CREDIT_CARD'",
  "ON CONFLICT (provider_event_id) DO NOTHING",
  "ON CONFLICT (provider_payment_id) DO NOTHING",
  "SET status = 'linked', updated_at = now()",
  "CASE WHEN status = 'linked' THEN 'linked' ELSE 'paid' END",
  "AND status IN ('creating', 'pending')",
]);
requireIncludes("supabase/functions/_shared/ordys-billing.ts", [
  "export async function validateBillingUser(request: Request)",
  "export async function serviceRest(path: string",
  "export async function assertBillingEnabled()",
  "export async function isOrdysPlusEligible(userId: string)",
  "export class AsaasApiError extends Error",
  "export function checkoutAttemptDisposition(status: string, expiresAt: string",
  "result.status === 404",
  "alreadyDeleted: true",
  "export function constantTimeEqual(a: string, b: string)",
  "ASAAS_ENVIRONMENT",
  "ASAAS_API_KEY",
  "SUPABASE_SECRET_KEYS",
]);
requireIncludes("supabase/functions/ordys-billing-checkout/index.ts", [
  "await assertBillingEnabled();",
  "await getUserBirthDate(user.id, user.authorization)",
  "age < 18",
  'billingTypes: ["CREDIT_CARD"]',
  'chargeTypes: ["RECURRENT"]',
  "minutesToExpire: 60",
  "externalReference",
  "provider_checkout_id",
  "checkoutAttemptDisposition(",
  "disposition === \"cancel_remote\"",
  "checkout_cancellation_processing",
  "status=in.(creating,pending,linked)",
  "providerRequestStarted = true",
  "AsaasApiError",
  "/checkouts",
  "checkoutSession/show?id=",
  "ordys-billing-return",
  "checkoutUrl",
  "&status=eq.creating",
  "Number.isFinite(periodEnd) && periodEnd > 0",
]);
requireIncludes("supabase/functions/ordys-billing-checkout/index.ts", [
  "&status=eq.paid&order=created_at.desc",
  "Não inicie outro pagamento.",
]);
requireIncludes("supabase/functions/ordys-billing-return/index.ts", [
  'request.method !== "GET"',
  "O redirecionamento, sozinho, não libera o acesso.",
]);
const asaasWebhookPath = "supabase/functions/ordys-billing-webhook/index.ts";
const asaasWebhook = requireFile(asaasWebhookPath);
requireIncludes(asaasWebhookPath, asaasWebhook, [
  'request.headers.get("asaas-access-token")',
  "constantTimeEqual(expectedToken, receivedToken)",
  "expectedToken.length < 32",
  "expectedToken.length > 255",
  "rpc/ordys_receive_asaas_billing_webhook",
  "serviceRestWithDeadline",
  "WEBHOOK_RECEIPT_DATABASE_DEADLINE_MS",
]);
if (
  asaasWebhook.includes("rpc/ordys_process_asaas_billing_webhook") ||
  asaasWebhook.includes("rpc/process_ordys_asaas_billing_event")
) {
  throw new Error(
    "Asaas HTTP webhook must acknowledge only a committed durable receipt; financial processing belongs to the scheduled worker",
  );
}

const durableWebhookMigration = "supabase/migrations/20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql";
requireIncludes(durableWebhookMigration, read(durableWebhookMigration), [
  "CREATE OR REPLACE FUNCTION public.ordys_receive_asaas_billing_webhook(p_event JSONB)",
  "CREATE OR REPLACE FUNCTION public.ordys_process_asaas_billing_webhook(p_event_id TEXT)",
  "public.ordys_apply_asaas_billing_event(v_inbox.event_payload)",
  "FOR UPDATE",
  "ordys:asaas-inbox-admission",
]);

requireIncludes("supabase/functions/_shared/ordys-billing-webhook-result.ts", [
  '"ambiguous_customer_association"',
  '"subscription_checkout_unmatched"',
  '"payment_subscription_unmatched"',
  '"confirmed_payment_unmatched"',
  '"subscription_customer_mismatch"',
  '"payment_customer_mismatch"',
]);
requireIncludes("supabase/functions/ordys-delete-account/index.ts", [
  "cancelOrdysBillingBeforeAccountDeletion(userId, {",
  "getBillingSchemaStatus",
  "serviceRest",
  "asaasRequest",
  "error instanceof BillingCancellationPendingError",
  'code: "checkout_cancellation_processing"',
  "Nenhum dado foi apagado.",
]);
requireIncludes("supabase/functions/_shared/ordys-delete-account-billing.ts", [
  'if (schemaStatus === "absent") return;',
  'if (schemaStatus !== "ready")',
  'if (subscription["status"] === "cancelled") continue;',
  "checkoutCancellationRequested = true",
  "new BillingCancellationPendingError(",
  "/checkouts/",
  "/subscriptions/",
  "Nenhum dado foi apagado.",
]);
requireIncludes("supabase/migrations/20261029232950_ordys_billing_schema_status.sql", [
  "ordys_billing_schema_status",
  "THEN 'absent'",
  "THEN 'ready'",
  "ELSE 'partial'",
  "REVOKE ALL ON FUNCTION public.ordys_billing_schema_status()",
  "GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()",
  "TO service_role;",
]);

const deleteAccountFunction = read("supabase/functions/ordys-delete-account/index.ts");
if (deleteAccountFunction.includes('JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() })')) {
  failures.push("Exclusão de conta não pode marcar checkout como cancelado antes do webhook do Asaas");
}
requireIncludes("tests/ordys-billing-shared.test.ts", [
  "calculates the exact age before and on the birthday",
  "handles leap-day birthdays without accepting an invalid date",
  "rejects different strings and different lengths",
  "returns plain object values and rejects arrays or primitives",
  "always returns JSON without cache and includes the billing CORS headers",
]);
requireIncludes("tests/ordys-billing-security.test.ts", [
  "proteção das tabelas e funções financeiras do Ordys",
  "isolamento de cobrança para usuários autenticados",
  "não permite SELECT autenticado direto em public.%s",
  "não permite INSERT autenticado direto em public.%s",
  "mantém somente os RPCs de consulta segura disponíveis ao titular",
  "não expõe o RPC privilegiado %s para authenticated",
  "get_my_ordys_billing_status",
]);
requireIncludes("tests/ordys-billing-checkout.test.ts", [
  "reuses a pending checkout while its local expiry is still in the future",
  "requires remote cancellation after a pending checkout reaches local expiry",
  "blocks an unresolved %s attempt",
  "allows retry after the terminal state %s is recorded",
  "blocks a pending attempt with a missing or invalid expiry timestamp",
]);
requireIncludes("docs/BILLING-ASAS.md", [
  "sendType = SEQUENTIALLY",
  "Não usar `NON_SEQUENTIALLY` nessa integração.",
  "Como o exemplo oficial do payload de Checkout não apresenta `externalReference`",
]);
requireIncludes("tests/ordys-billing-webhook.integration.test.ts", [
  "máquina de estados dos webhooks Asaas do Ordys",
  "Simulate non-sequential delivery",
  "associa assinatura sem externalReference quando CHECKOUT_PAID é entregue sequencialmente",
  "SUBSCRIPTION_CREATED",
  "CHECKOUT_PAID",
  "PAYMENT_CONFIRMED",
  "PAYMENT_OVERDUE",
  "SUBSCRIPTION_DELETED",
  "PAYMENT_REFUNDED",
  "recusa conciliar assinatura quando o mesmo cliente corresponde a dois Checkouts pagos",
  "ambiguous_customer_association",
]);
requireIncludes("supabase/functions/ordys-billing-manage/index.ts", [
  'body.action !== "cancel"',
  'method: "DELETE"',
  'status: subscription.status === "suspended" ? "suspended" : "cancelled"',
  "accessUntil",
]);
requireIncludes("supabase/functions/ordys-billing-status/index.ts", [
  "ordys_billing_settings",
  "ordys_billing_plans",
  "ordys_billing_subscriptions",
  "price_cents=gt.0",
  "Number.isFinite(periodEnd) && periodEnd > 0",
  "const hasAccess = (",
  "const billingEnabled = settings?.[0]?.billing_enabled === true;",
  "billingEnabled\n        ? serviceRest(",
  "enabled: billingEnabled",
  "hasAccess",
]);
requireIncludes("supabase/functions/ordys-assistant/index.ts", [
  'import { isOrdysPlusEligible } from "../_shared/ordys-billing.ts";',
  "const plusEligible = ORDYS_PLUS_AI_ENABLED",
  'if (action === "quiz") {',
  'if (!plusEligible) {',
  'return response({ status: "failed", error: ORDYS_PLUS_LOCK_MESSAGE }, 402);',
  'return await generateQuizForUser(request, user.id, body);',
  'if (mode !== "assist" && !plusEligible)',
  "const [hourlyLimit, dailyLimit] = plusEligible",
]);
requireIncludes("supabase/functions/ordys-video-transcribe/index.ts", [
  'import { isOrdysPlusEligible } from "../_shared/ordys-billing.ts";',
  "const plusEligible = await isOrdysPlusEligible(userId);",
]);

requireIncludes("src/routes/perfil.tsx", [
  '"Assinatura"]',
  'supabase.functions.invoke("ordys-billing-status"',
  'supabase.functions.invoke("ordys-billing-checkout"',
  'supabase.functions.invoke("ordys-billing-manage"',
  "Ordys Plus",
  "Cancelar assinatura",
  "Novas contratações temporariamente pausadas",
  "async function billingErrorMessage(error: unknown, fallback: string)",
  "context instanceof Response",
  "await context.clone().json()",
  "setBillingError(await billingErrorMessage(error",
  "toast.error(await billingErrorMessage(error",
  "billingOverview?.subscription?.status === \"suspended\"",
  "Cobranças futuras interrompidas. A suspensão do acesso por estorno ou contestação permanece até análise.",
  "const accessUntil = typeof data?.accessUntil === \"string\" ? Date.parse(data.accessUntil) : 0;",
  "Não há um período pago com acesso ativo.",
  "Quem já possui um período pago mantém o acesso até a data final",
  "Cobrança recorrente no cartão, processada pelo Asaas.",
  "A primeira cobrança está programada para 24 horas após a abertura do checkout",
  "o acesso ao Plus é liberado após a confirmação do pagamento pelo Asaas",
]);
requireIncludes(".github/workflows/verify-ordys.yml", [
  "deno check supabase/functions/ordys-billing-checkout/index.ts",
  "deno check supabase/functions/ordys-billing-status/index.ts",
  "deno check supabase/functions/ordys-billing-manage/index.ts",
  "deno check supabase/functions/ordys-billing-webhook/index.ts",
  "deno check supabase/functions/ordys-billing-return/index.ts",
]);

const billingMigrationSource = read(billingMigration);
function readSqlFunction(name) {
  const start = billingMigrationSource.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) return "";
  const end = billingMigrationSource.indexOf("$;", start);
  return end < 0 ? "" : billingMigrationSource.slice(start, end);
}
for (const functionName of ["get_my_ordys_billing_status()", "is_ordys_plus_eligible(p_user_id UUID)"]) {
  if (readSqlFunction(functionName).includes("billing_enabled")) {
    failures.push(`${functionName}: pausar novas contratações não pode retirar acesso já pago`);
  }
}
const billingStatusSource = read("supabase/functions/ordys-billing-status/index.ts");
if (billingStatusSource.includes("const hasAccess = billingEnabled &&")) {
  failures.push("Status da assinatura não pode atrelar acesso pago à disponibilidade de novas contratações");
}

const sensitiveManualWorkflows = [
  [".github/workflows/preflight-ordys-production.yml", "preflight:"],
  [".github/workflows/deploy-ordys-assistant.yml", "deploy:"],
  [".github/workflows/build-ordys-android.yml", "build-android:"],
  [".github/workflows/build-ordys-android-sideload.yml", "build-direct-install-release:"],
];
for (const [path, jobName] of sensitiveManualWorkflows) {
  const source = read(path);
  const jobStart = source.indexOf(`  ${jobName}`);
  const runsOn = source.indexOf("\n    runs-on:", jobStart);
  const mainOnlyGuard = source.indexOf(
    "if: github.repository == 'igniteprosperety-collab/ordys-academy.app' && github.ref == 'refs/heads/main'",
    jobStart,
  );
  if (jobStart < 0 || mainOnlyGuard < jobStart || runsOn < 0 || mainOnlyGuard > runsOn) {
    failures.push(`${path}: job ${jobName} deve ser restrito ao repositório oficial e à branch main antes de executar com secrets`);
  }
}

const productionPreflightWorkflow = read(".github/workflows/preflight-ordys-production.yml");
const managedCloudGuardPosition = productionPreflightWorkflow.indexOf(
  "- name: Reject unsupported Supabase CLI preflight for built-in Lovable Cloud",
);
const productionSecretsCheckPosition = productionPreflightWorkflow.indexOf(
  "- name: Check production connection inputs",
);
const productionSupabaseLinkPosition = productionPreflightWorkflow.indexOf(
  "supabase link --project-ref",
);
if (
  managedCloudGuardPosition < 0 ||
  productionSecretsCheckPosition < 0 ||
  productionSupabaseLinkPosition < 0 ||
  managedCloudGuardPosition > productionSecretsCheckPosition ||
  managedCloudGuardPosition > productionSupabaseLinkPosition ||
  !productionPreflightWorkflow.includes('"$configured_project_id" == "yqljcoukgpqdoxiispyn"') ||
  !productionPreflightWorkflow.includes("Supabase CLI/Management API preflight is not a supported route")
) {
  failures.push("Preflight de produção deve rejeitar o Supabase CLI para o Lovable Cloud antes de validar secrets ou tentar conectar o banco gerenciado");
}

const billingDeployWorkflow = read(".github/workflows/deploy-ordys-assistant.yml");
const backupInputPosition = billingDeployWorkflow.indexOf("production_backup_verified:");
const backupGatePosition = billingDeployWorkflow.indexOf("Require verified off-platform production backup before deployment");
const firstRemoteWritePosition = billingDeployWorkflow.indexOf("supabase --yes secrets set");
const firstMigrationPushPosition = billingDeployWorkflow.indexOf("supabase --yes db push --linked");
if (
  backupInputPosition < 0 ||
  !billingDeployWorkflow.slice(backupInputPosition, backupInputPosition + 500).includes("default: false") ||
  backupGatePosition < 0 ||
  firstRemoteWritePosition < 0 ||
  firstMigrationPushPosition < 0 ||
  !(backupInputPosition < backupGatePosition &&
    backupGatePosition < firstRemoteWritePosition &&
    backupGatePosition < firstMigrationPushPosition) ||
  !billingDeployWorkflow.includes("PRODUCTION_BACKUP_VERIFIED: ${{ inputs.production_backup_verified }}") ||
  !billingDeployWorkflow.includes('if [[ "${PRODUCTION_BACKUP_VERIFIED:-false}" != "true" ]]')
) {
  failures.push("Deploy de produção deve exigir atestado explícito de backup externo verificado, com padrão false, antes de alterar secrets ou aplicar migrations");
}

const billingValidationEnd = billingDeployWorkflow.indexOf("Validate ORDYS Billing Return Edge Function");
const migrationPreflight = billingDeployWorkflow.indexOf("Preflight Supabase migration state");
const migrationPush = billingDeployWorkflow.indexOf("supabase --yes db push --linked");
if (
  billingValidationEnd < 0 ||
  migrationPreflight < 0 ||
  migrationPush < 0 ||
  billingValidationEnd > migrationPreflight ||
  billingValidationEnd > migrationPush
) {
  failures.push("As Edge Functions de cobrança devem ser validadas antes do preflight e da aplicação de migrations");
}

const billingSchemaGate = billingDeployWorkflow.indexOf("Verify Ordys billing schema before deploying billing Edge Functions");
if (
  billingSchemaGate < 0 ||
  migrationPush < 0 ||
  billingSchemaGate < migrationPush ||
  !billingDeployWorkflow.includes("id: billing_schema") ||
  !billingDeployWorkflow.includes("billing_migration_version=\"20261031010000\"") ||
  !billingDeployWorkflow.includes("'$2 ~ version { found=1 } END { exit !found }'") ||
  !billingDeployWorkflow.includes("ready=false")
) {
  failures.push("As funções de cobrança devem permanecer bloqueadas até a migration financeira constar no banco remoto");
}

const deleteAccountDeployStart = billingDeployWorkflow.indexOf("- name: Deploy Ordys Delete Account Edge Function");
const deleteAccountDeployEnd = billingDeployWorkflow.indexOf(
  "- name: Deploy ORDYS Billing Checkout Edge Function",
  deleteAccountDeployStart + 1,
);
const deleteAccountDeployStep = deleteAccountDeployStart < 0
  ? ""
  : billingDeployWorkflow.slice(deleteAccountDeployStart, deleteAccountDeployEnd < 0 ? undefined : deleteAccountDeployEnd);
if (
  deleteAccountDeployStart < 0 ||
  !deleteAccountDeployStep.includes("steps.config.outputs.configured == 'true'") ||
  deleteAccountDeployStep.includes("billing_schema.outputs.ready")
) {
  failures.push("A exclusão de conta do núcleo não pode depender da migration opcional de billing");
}

for (const stepName of [
  "Deploy ORDYS Billing Checkout Edge Function",
  "Deploy ORDYS Billing Status Edge Function",
  "Deploy ORDYS Billing Management Edge Function",
  "Deploy ORDYS Asaas Webhook Edge Function",
  "Deploy ORDYS Billing Return Edge Function",
]) {
  const stepStart = billingDeployWorkflow.indexOf(`- name: ${stepName}`);
  const nextStep = billingDeployWorkflow.indexOf("\n      - name:", stepStart + 1);
  const stepSource = stepStart < 0
    ? ""
    : billingDeployWorkflow.slice(stepStart, nextStep < 0 ? undefined : nextStep);
  if (
    stepStart < 0 ||
    stepStart < billingSchemaGate ||
    !stepSource.includes("steps.config.outputs.configured == 'true' && steps.billing_schema.outputs.ready == 'true'")
  ) {
    failures.push(`A etapa "${stepName}" precisa exigir a confirmação da migration financeira remota`);
  }
}

const billingManageSource = read("supabase/functions/ordys-billing-manage/index.ts");
if (billingManageSource.includes("assertBillingEnabled")) {
  failures.push("Cancelamento de assinatura deve continuar disponível mesmo com o faturamento global desligado");
}

const billingCheckoutSource = read("supabase/functions/ordys-billing-checkout/index.ts");
if (
  !billingCheckoutSource.includes("&status=in.(pending,active,past_due,suspended,cancelled)&order=created_at.desc") ||
  billingCheckoutSource.includes("status=in.(pending,active,past_due,suspended,cancelled)&order=created_at.desc&limit=5") ||
  !billingCheckoutSource.includes('row.status === "pending" || row.status === "active" || row.status === "past_due" || row.status === "suspended"')
) {
  failures.push("A contratação deve bloquear assinaturas ativas, pendentes, atrasadas ou suspensas e preservar períodos pagos após cancelamento");
}

requireIncludes("supabase/migrations/20261031010000_ordys_plus_billing_foundation.sql", [
  "v_existing_payment_status TEXT;",
  "ignored_stale_payment_event",
  "v_existing_payment_status IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED')",
  "'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'",
  "'PAYMENT_REPROVED_BY_RISK_ANALYSIS'",
]);
if (!billingMigrationSource.includes("A delayed negative event for a payment already confirmed must not")) {
  failures.push("A migration financeira deve ignorar eventos negativos atrasados quando o mesmo pagamento já foi confirmado.");
}

if (failures.length) {
  console.error("VERIFICAÇÃO ORDYS FALHOU:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Verificação estática do ORDYS concluída com sucesso.");


// Keep Asaas billing invariants isolated from unrelated application checks.
await import("./verify-ordys-billing-static.mjs");
