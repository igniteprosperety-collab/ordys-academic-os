import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { edgeFunctionUnavailableMessage } from "@/lib/edge-function-errors";
import { dateKey } from "@/lib/ordys-engine";
import type { OrdysAttachment } from "@/lib/ordys-assistant-media";
import { canUseOrdysAi } from "@/lib/ai-eligibility";
import { ORDYS_PLUS_AI_ENABLED } from "@/lib/ordys-ai-access";
import { isOrdysVideoAudioTranscriptionSupported } from "@/lib/ordys-video-transcription";
import {
  getOrdysContextSections,
  normalizeOrdysContextScopes,
  type OrdysAcademicContextScope,
  type OrdysContextSection,
} from "@/lib/ordys-assistant-context";

export type OrdysAssistantMode = "assist" | "research" | "deep" | "configure" | "mindmap";

export type OrdysCitation = {
  title: string;
  url: string;
};

export type OrdysConfigAction = {
  type: "subject" | "schedule" | "task" | "exam" | "profile";
  title: string;
  details: string;
  subjectName?: string | null;
  teacher?: string | null;
  room?: string | null;
  weekday?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  dueAt?: string | null;
  examAt?: string | null;
  description?: string | null;
  stage?: string | null;
  timezone?: string | null;
};

export type OrdysConfigurationPlan = {
  summary: string;
  actions: OrdysConfigAction[];
  questions: string[];
};

export type OrdysMindMapNode = {
  title: string;
  summary?: string;
  children?: OrdysMindMapNode[];
};

export type OrdysMindMap = {
  title: string;
  nodes: OrdysMindMapNode[];
};

export type OrdysAssistantResult = {
  status: "completed" | "processing" | "failed";
  answer?: string;
  citations?: OrdysCitation[];
  responseId?: string;
  error?: string;
  configuration?: OrdysConfigurationPlan;
  mindMap?: OrdysMindMap;
};

export type OrdysAssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

async function getAccessContext() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Sua sessão não está disponível. Entre novamente no ORDYS.");
  }
  return { accessToken: data.session.access_token, userId: data.session.user.id };
}

export type OrdysQuizQuestion = {
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  topic: string | null;
};

export async function generateOrdysQuiz(input: {
  subjectId: string;
  difficulty: "facil" | "media" | "dificil";
  questionCount: number;
}): Promise<OrdysQuizQuestion[]> {
  await getAccessContext();

  const { data, error } = await invokeAssistant({
    body: { action: "quiz", ...input },
  });

  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;

  if (result?.["status"] === "completed" && Array.isArray(result["questions"])) {
    const questions = result["questions"].map((value): OrdysQuizQuestion => {
      if (!value || typeof value !== "object") {
        throw new Error("O serviço retornou uma questão inválida.");
      }
      const row = value as Record<string, unknown>;
      const question = typeof row["question"] === "string" ? row["question"].trim() : "";
      const options = Array.isArray(row["options"])
        ? row["options"].filter((option): option is string => typeof option === "string").map((option) => option.trim())
        : [];
      const correct = typeof row["correct_answer"] === "string" ? row["correct_answer"].trim() : "";
      const explanation = typeof row["explanation"] === "string" ? row["explanation"].trim() : "";
      const topic = typeof row["topic"] === "string" ? row["topic"] : null;

      if (
        !question ||
        options.length !== 4 ||
        options.some((option) => !option) ||
        new Set(options).size !== 4 ||
        !correct ||
        !options.includes(correct)
      ) {
        throw new Error("O serviço retornou uma questão com formato inválido.");
      }

      return { question, options, correct_answer: correct, explanation, topic };
    });

    if (questions.length !== input.questionCount) {
      throw new Error("O serviço não retornou a quantidade de questões solicitada.");
    }
    return questions;
  }

  const unavailable = edgeFunctionUnavailableMessage(error, "assistant");
  if (unavailable) throw new Error(unavailable);
  if (typeof result?.["error"] === "string" && result["error"].trim()) {
    throw new Error(result["error"]);
  }
  if (error) {
    throw new Error("Não foi possível gerar o simulado pelo serviço seguro. Verifique sua conexão e tente novamente.");
  }
  throw new Error("O serviço de simulados retornou uma resposta inválida.");
}

function readFunctionResult(data: unknown, error: unknown) {
  if (error || !data || typeof data !== "object") return null;
  const result = data as Record<string, unknown>;
  return typeof result["status"] === "string" ? (result as unknown as OrdysAssistantResult) : null;
}

async function invokeAssistant(options: { body: Record<string, unknown> }) {
  try {
    const result = await supabase.functions.invoke("ordys-assistant", options);
    const status = result.error?.context?.status;
    if (status === 400 || status === 401 || status === 403) {
      throw result.error;
    }
    return result;
  } catch (error) {
    const unavailable = edgeFunctionUnavailableMessage(error, "assistant");
    if (unavailable) throw new Error(unavailable);
    throw error;
  }
}

function nativeAssistantFailure(error: unknown) {
  return new Error(
    edgeFunctionUnavailableMessage(error, "assistant") ??
    "O Assistente Ordys não respondeu pelo serviço seguro. Verifique sua conexão e tente novamente.",
  );
}

async function assistantFetch(url: string, options: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const unavailable = edgeFunctionUnavailableMessage(
      error instanceof TypeError ? { name: "FunctionsFetchError" } : error,
      "assistant",
    );
    if (unavailable) throw new Error(unavailable);
    throw error;
  }
  const unavailable = edgeFunctionUnavailableMessage({ context: response }, "assistant");
  if (unavailable) throw new Error(unavailable);
  return response;
}

function compactDate(value: string | null | undefined) {
  if (!value) return "não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function weekdayLabel(value: number | null | undefined) {
  return ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"][value ?? -1] ?? "dia não informado";
}

type ContextQueryResult = { data: unknown; error: unknown | null };

function contextQuery<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<ContextQueryResult> {
  return Promise.resolve(query).then(({ data, error }) => ({ data, error }));
}

function emptyContextQuery(): Promise<ContextQueryResult> {
  return Promise.resolve({ data: null, error: null });
}

function contextRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data)
    ? data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

async function loadOrdysContext(
  userId: string,
  selectedScopes: readonly OrdysAcademicContextScope[],
) {
  const sections = getOrdysContextSections(selectedScopes);
  if (!sections.size) return "";

  const needsSubjectLabels = [
    "subjects", "schedules", "tasks", "exams", "grades", "attendance",
    "goals", "topics", "plan", "focus", "reviews", "quizAttempts",
  ].some((section) => sections.has(section as OrdysContextSection));

  const profilePromise = sections.has("profile")
    ? contextQuery(supabase.from("profiles").select("stage,timezone,grade_scale_max,grade_pass,attendance_target,weekly_study_target_minutes,daily_load_limit_minutes").eq("id", userId).maybeSingle())
    : emptyContextQuery();
  const subjectsPromise = sections.has("subjects")
    ? contextQuery(supabase.from("subjects").select("id,name,teacher,room,term,weekly_hours,grade_goal,attendance_goal").eq("user_id", userId).eq("archived", false).order("name").limit(80))
    : needsSubjectLabels
      ? contextQuery(supabase.from("subjects").select("id,name").eq("user_id", userId).eq("archived", false).order("name").limit(80))
      : emptyContextQuery();
  const schedulesPromise = sections.has("schedules")
    ? contextQuery(supabase.from("subject_schedules").select("subject_id,weekday,start_time,end_time,room").eq("user_id", userId).order("weekday").order("start_time").limit(200))
    : emptyContextQuery();
  const tasksPromise = sections.has("tasks")
    ? contextQuery(supabase.from("tasks").select("subject_id,title,due_at,priority,status,estimated_minutes").eq("user_id", userId).order("due_at", { ascending: true, nullsFirst: false }).limit(40))
    : emptyContextQuery();
  const examsPromise = sections.has("exams")
    ? contextQuery(supabase.from("exams").select("subject_id,title,exam_at,weight,content,kind").eq("user_id", userId).order("exam_at").limit(30))
    : emptyContextQuery();
  const gradesPromise = sections.has("grades")
    ? contextQuery(supabase.from("grades").select("subject_id,title,score,max_score,weight,term,graded_on").eq("user_id", userId).order("graded_on", { ascending: false }).limit(60))
    : emptyContextQuery();
  const attendancePromise = sections.has("attendance")
    ? contextQuery(supabase.from("attendance_records").select("subject_id,class_date,status,note").eq("user_id", userId).order("class_date", { ascending: false }).limit(60))
    : emptyContextQuery();
  const goalsPromise = sections.has("goals")
    ? contextQuery(supabase.from("goals").select("subject_id,title,metric,target,period,active").eq("user_id", userId).eq("active", true).limit(30))
    : emptyContextQuery();
  const topicsPromise = sections.has("topics")
    ? contextQuery(supabase.from("topics").select("id,subject_id,title,status,mastery,last_review,next_review").eq("user_id", userId).order("title").limit(80))
    : emptyContextQuery();
  const planPromise = sections.has("plan")
    ? contextQuery(supabase.from("plan_sessions").select("subject_id,topic_id,session_date,start_time,duration_minutes,kind,reason,priority,status,generated").eq("user_id", userId).gte("session_date", dateKey(new Date())).limit(120))
    : emptyContextQuery();
  const focusPromise = sections.has("focus")
    ? contextQuery(supabase.from("focus_sessions").select("subject_id,topic_id,planned_minutes,actual_minutes,started_at,ended_at,status").eq("user_id", userId).order("started_at", { ascending: false }).limit(60))
    : emptyContextQuery();
  const reviewsPromise = sections.has("reviews")
    ? contextQuery(supabase.from("reviews").select("topic_id,due_on,status,reason,source,completed_at").eq("user_id", userId).order("due_on").limit(80))
    : emptyContextQuery();
  const quizAttemptsPromise = sections.has("quizAttempts")
    ? contextQuery(supabase.from("quiz_attempts").select("subject_id,difficulty,question_count,correct_count,status,created_at,finished_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(40))
    : emptyContextQuery();
  const checkinsPromise = sections.has("checkins")
    ? contextQuery(supabase.from("daily_checkins").select("checkin_date,focus_rating,studied_minutes,completed_plan,pending_note").eq("user_id", userId).order("checkin_date", { ascending: false }).limit(30))
    : emptyContextQuery();

  const [
    profileResult, subjectsResult, schedulesResult, tasksResult, examsResult,
    gradesResult, attendanceResult, goalsResult, topicsResult, planResult,
    focusResult, reviewsResult, quizAttemptsResult, checkinsResult,
  ] = await Promise.all([
    profilePromise, subjectsPromise, schedulesPromise, tasksPromise, examsPromise,
    gradesPromise, attendancePromise, goalsPromise, topicsPromise, planPromise,
    focusPromise, reviewsPromise, quizAttemptsPromise, checkinsPromise,
  ]);

  const queryResults = [
    profileResult, subjectsResult, schedulesResult, tasksResult, examsResult,
    gradesResult, attendanceResult, goalsResult, topicsResult, planResult,
    focusResult, reviewsResult, quizAttemptsResult, checkinsResult,
  ].filter((result) => result.data !== null || result.error !== null);
  const contextQueryFailed = queryResults.some((result) => Boolean(result.error));

  const subjects = contextRows(subjectsResult.data);
  const subjectById = new Map<string, string>();
  subjects.forEach((subject) => {
    if (typeof subject["id"] === "string") subjectById.set(subject["id"], String(subject["name"] ?? "Matéria sem nome"));
  });
  const subjectName = (id: unknown) => subjectById.get(String(id ?? "")) ?? "Matéria não identificada";
  const output = [
    "DADOS ACADÊMICOS DO ORDYS — SOMENTE AS CATEGORIAS SELECIONADAS PELO ESTUDANTE",
    contextQueryFailed
      ? "LIMITAÇÃO DO CONTEXTO: uma ou mais categorias selecionadas não puderam ser carregadas. Não trate campos ausentes como inexistentes e deixe a limitação clara ao estudante."
      : "CONTEXTO SELECIONADO: apenas as categorias marcadas para esta mensagem foram consultadas.",
  ];

  if (sections.has("profile")) {
    const profile = profileResult.data && typeof profileResult.data === "object"
      ? profileResult.data as Record<string, unknown>
      : null;
    output.push(profile
      ? `PERFIL: etapa ${String(profile["stage"] ?? "não informada")} | fuso ${String(profile["timezone"] ?? "não informado")} | nota mínima ${String(profile["grade_pass"] ?? "não informada")} | meta de presença ${String(profile["attendance_target"] ?? "não informada")}%`
      : "PERFIL: não disponível.");
    output.push("MATÉRIAS:\n" + (subjects.length
      ? subjects.map((item) => `- ${String(item["name"] ?? "Matéria")} | professor: ${String(item["teacher"] ?? "não informado")} | sala: ${String(item["room"] ?? "não informada")} | período: ${String(item["term"] ?? "não informado")}`).join("\n")
      : "(nenhuma matéria cadastrada)"));
  }
  if (sections.has("schedules")) {
    output.push("HORÁRIOS:\n" + contextRows(schedulesResult.data).map((item) =>
      `- ${subjectName(item["subject_id"])}: ${weekdayLabel(typeof item["weekday"] === "number" ? item["weekday"] : null)}, ${String(item["start_time"] ?? "?")}–${String(item["end_time"] ?? "?")}${item["room"] ? ` | sala: ${String(item["room"])}` : ""}`,
    ).join("\n") || "(nenhum horário cadastrado)");
  }
  if (sections.has("tasks")) {
    output.push("TAREFAS:\n" + contextRows(tasksResult.data).map((item) =>
      `- ${String(item["title"] ?? "Tarefa")} | ${subjectName(item["subject_id"])} | prazo: ${compactDate(typeof item["due_at"] === "string" ? item["due_at"] : null)} | prioridade: ${String(item["priority"] ?? "não informada")} | status: ${String(item["status"] ?? "não informado")}`,
    ).join("\n") || "(nenhuma tarefa encontrada no recorte atual)");
  }
  if (sections.has("exams")) {
    output.push("PROVAS/AVALIAÇÕES:\n" + contextRows(examsResult.data).map((item) =>
      `- ${String(item["title"] ?? "Avaliação")} | ${subjectName(item["subject_id"])} | data: ${compactDate(typeof item["exam_at"] === "string" ? item["exam_at"] : null)} | conteúdo: ${String(item["content"] ?? "não informado")}`,
    ).join("\n") || "(nenhuma prova encontrada no recorte atual)");
  }
  if (sections.has("grades")) {
    output.push("NOTAS:\n" + contextRows(gradesResult.data).map((item) =>
      `- ${subjectName(item["subject_id"])} | ${String(item["title"] ?? "Nota")} | ${String(item["score"] ?? "?")}/${String(item["max_score"] ?? "10")} | peso: ${String(item["weight"] ?? "1")} | data: ${String(item["graded_on"] ?? "não informada")}`,
    ).join("\n") || "(nenhuma nota encontrada no recorte atual)");
  }
  if (sections.has("attendance")) {
    output.push("FREQUÊNCIA:\n" + contextRows(attendanceResult.data).map((item) =>
      `- ${subjectName(item["subject_id"])} | ${String(item["class_date"] ?? "?")} | ${String(item["status"] ?? "não informado")}${item["note"] ? ` | ${String(item["note"])}` : ""}`,
    ).join("\n") || "(nenhum registro de frequência encontrado)");
  }
  if (sections.has("goals")) {
    output.push("METAS:\n" + contextRows(goalsResult.data).map((item) =>
      `- ${String(item["title"] ?? "Meta")} | ${item["subject_id"] ? subjectName(item["subject_id"]) : "geral"} | métrica: ${String(item["metric"] ?? "?")} | alvo: ${String(item["target"] ?? "?")} | período: ${String(item["period"] ?? "?")}`,
    ).join("\n") || "(nenhuma meta ativa encontrada)");
  }
  if (sections.has("topics")) {
    output.push("TÓPICOS:\n" + contextRows(topicsResult.data).map((item) =>
      `- ${subjectName(item["subject_id"])}: ${String(item["title"] ?? "Tópico")} | domínio: ${String(item["mastery"] ?? 0)}% | status: ${String(item["status"] ?? "não informado")} | próxima revisão: ${String(item["next_review"] ?? "não agendada")}`,
    ).join("\n") || "(nenhum tópico cadastrado no recorte atual)");
  }
  if (sections.has("plan")) {
    output.push("PLANO DE ESTUDOS ATUAL:\n" + contextRows(planResult.data).map((item) =>
      `- ${String(item["session_date"] ?? "?")} ${String(item["start_time"] ?? "?")} | ${subjectName(item["subject_id"])} | ${String(item["duration_minutes"] ?? 0)} min | ${String(item["kind"] ?? "estudo")} | ${String(item["status"] ?? "?")} | ${String(item["reason"] ?? "")}`,
    ).join("\n") || "(nenhuma sessão encontrada no recorte atual)");
  }
  if (sections.has("focus")) {
    output.push("SESSÕES DE FOCO:\n" + contextRows(focusResult.data).map((item) =>
      `- ${compactDate(typeof item["started_at"] === "string" ? item["started_at"] : null)} | ${subjectName(item["subject_id"])} | planejado: ${String(item["planned_minutes"] ?? 0)} min | realizado: ${String(item["actual_minutes"] ?? 0)} min | status: ${String(item["status"] ?? "?")}`,
    ).join("\n") || "(nenhuma sessão de foco encontrada)");
  }
  if (sections.has("reviews")) {
    const topicsById = new Map<string, Record<string, unknown>>(contextRows(topicsResult.data).map((item) => [String(item["id"]), item] as const));
    output.push("REVISÕES:\n" + contextRows(reviewsResult.data).map((item) => {
      const topic = topicsById.get(String(item["topic_id"] ?? ""));
      return `- ${String(item["due_on"] ?? "?")} | ${topic ? subjectName(topic["subject_id"]) : "Matéria não identificada"} | ${String(topic?.["title"] ?? "Tópico")} | ${String(item["status"] ?? "pendente")} | ${String(item["reason"] ?? "")}`;
    }).join("\n") || "(nenhuma revisão encontrada)");
  }
  if (sections.has("quizAttempts")) {
    output.push("SIMULADOS:\n" + contextRows(quizAttemptsResult.data).map((item) =>
      `- ${compactDate(typeof item["created_at"] === "string" ? item["created_at"] : null)} | ${subjectName(item["subject_id"])} | ${String(item["correct_count"] ?? 0)}/${String(item["question_count"] ?? 0)} | dificuldade: ${String(item["difficulty"] ?? "?")} | status: ${String(item["status"] ?? "?")}`,
    ).join("\n") || "(nenhum simulado encontrado)");
  }
  if (sections.has("checkins")) {
    output.push("CHECK-INS DIÁRIOS:\n" + contextRows(checkinsResult.data).map((item) =>
      `- ${String(item["checkin_date"] ?? "?")} | foco: ${String(item["focus_rating"] ?? "—")}/5 | estudado: ${String(item["studied_minutes"] ?? 0)} min | plano: ${String(item["completed_plan"] ?? "não informado")} | ${String(item["pending_note"] ?? "")}`,
    ).join("\n") || "(nenhum check-in encontrado)");
  }

  output.push("Regra: este contexto contém apenas as categorias que o estudante selecionou para esta mensagem. As listas são limitadas e não representam necessariamente o histórico completo.");
  return output.join("\n\n").slice(0, 22000);
}

async function prepareMessageWithContext(
  message: string,
  userId: string,
  videoTranscripts: string[] = [],
  videoNotes: string[] = [],
  selectedScopes: readonly OrdysAcademicContextScope[] = [],
) {
  const transcriptBlock = videoTranscripts.length
    ? `\n\n--- TRANSCRIÇÕES DOS VÍDEOS ---\n${videoTranscripts.join("\n\n")}`
    : "";
  const videoNotesBlock = videoNotes.length
    ? `\n\n--- LIMITAÇÕES DA ANÁLISE DE VÍDEO ---\n${videoNotes.join("\n")}`
    : "";
  const baseMessage = `${message || "(o estudante enviou apenas anexos)"}${transcriptBlock}${videoNotesBlock}`;
  if (!selectedScopes.length) return baseMessage;

  try {
    const context = await loadOrdysContext(userId, selectedScopes);
    return context ? `${baseMessage}\n\n--- CONTEXTO ACADÊMICO DO ORDYS ---\n${context}` : baseMessage;
  } catch {
    return `${baseMessage}\n\n--- CONTEXTO ACADÊMICO DO ORDYS ---\nO contexto selecionado não pôde ser carregado nesta solicitação. Não invente dados da rotina.`;
  }
}

async function transcribeOrdysVideo(attachment: OrdysAttachment): Promise<{ transcript: string | null; note: string | null }> {
  if (attachment.kind !== "video" || !attachment.dataUrl) return { transcript: null, note: null };

  if (!ORDYS_PLUS_AI_ENABLED) {
    return {
      transcript: null,
      note: `O áudio do vídeo "${attachment.name}" não é transcrito nesta versão. Analise somente os quadros extraídos; não infira falas ou sons.`,
    };
  }

  if (!isOrdysVideoAudioTranscriptionSupported(attachment)) {
    return {
      transcript: null,
      note: `O áudio do vídeo "${attachment.name}" não foi transcrito: a transcrição aceita apenas contêineres MP4 e WebM. A análise deve se limitar aos quadros extraídos; não infira falas ou sons.`,
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke("ordys-video-transcribe", {
      body: { filename: attachment.name, mimeType: attachment.mimeType, dataUrl: attachment.dataUrl },
    });
    if (error || !data || typeof data !== "object") {
      return {
        transcript: null,
        note: `Não foi possível transcrever o áudio do vídeo "${attachment.name}". A análise deve se limitar aos quadros extraídos; não infira falas ou sons.`,
      };
    }
    const result = data as Record<string, unknown>;
    const transcript = typeof result["transcript"] === "string" ? result["transcript"].trim() : "";
    if (result["status"] !== "completed" || !transcript) {
      return {
        transcript: null,
        note: `A transcrição do vídeo "${attachment.name}" não retornou fala reconhecível. A análise deve se limitar aos quadros extraídos; não infira falas ou sons.`,
      };
    }
    return { transcript: `Vídeo ${attachment.name}:\n${transcript}`, note: null };
  } catch {
    return {
      transcript: null,
      note: `Não foi possível transcrever o áudio do vídeo "${attachment.name}". A análise deve se limitar aos quadros extraídos; não infira falas ou sons.`,
    };
  }
}

async function fallbackPost(accessToken: string, body: Record<string, unknown>) {
  const response = await assistantFetch("/api/ordys-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as OrdysAssistantResult | null;
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível falar com o Assistente Ordys.");
  return payload ?? { status: "failed", error: "Resposta inválida do servidor." };
}

async function fallbackPoll(accessToken: string, responseId: string) {
  const response = await assistantFetch(`/api/ordys-assistant?responseId=${encodeURIComponent(responseId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => null)) as OrdysAssistantResult | null;
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível consultar a pesquisa.");
  return payload ?? { status: "failed", error: "Resposta inválida do servidor." };
}

export async function askOrdysAssistant(input: {
  message: string;
  mode: OrdysAssistantMode;
  history?: OrdysAssistantMessage[];
  attachments?: OrdysAttachment[];
  academicContext?: readonly OrdysAcademicContextScope[];
}): Promise<OrdysAssistantResult> {
  const { accessToken, userId } = await getAccessContext();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("birth_date")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error("Não foi possível verificar a elegibilidade dos recursos de IA.");
  const aiEligibility = canUseOrdysAi(profile?.birth_date);
  if (!aiEligibility.allowed) throw new Error(aiEligibility.reason);
  const videoAttachments = (input.attachments ?? []).filter((attachment) => attachment.kind === "video");
  const videoResults = await Promise.all(videoAttachments.map(transcribeOrdysVideo));
  const videoTranscripts = videoResults
    .map((result) => result.transcript)
    .filter((value): value is string => Boolean(value));
  const videoNotes = videoResults
    .map((result) => result.note)
    .filter((value): value is string => Boolean(value));
  const academicContext = normalizeOrdysContextScopes(input.academicContext);
  const enrichedMessage = await prepareMessageWithContext(
    input.message,
    userId,
    videoTranscripts,
    videoNotes,
    academicContext,
  );
  const body = {
    action: "ask",
    message: enrichedMessage,
    mode: input.mode,
    history: (input.history ?? []).slice(-8),
    attachments: (input.attachments ?? []).map(({ id, name, kind, mimeType, dataUrl, frames, durationSeconds }) => ({
      id,
      name,
      kind,
      mimeType,
      dataUrl: kind === "video" ? undefined : dataUrl,
      frames,
      durationSeconds,
    })),
  };

  const { data, error } = await invokeAssistant({ body });
  const functionResult = readFunctionResult(data, error);
  if (functionResult) return functionResult;
  // The packaged Android client is static and has no TanStack server route at /api.
  if (Capacitor.isNativePlatform()) throw nativeAssistantFailure(error);

  return fallbackPost(accessToken, body);
}

export async function pollOrdysResearch(responseId: string): Promise<OrdysAssistantResult> {
  const { accessToken } = await getAccessContext();
  const body = { action: "poll", responseId };
  const { data, error } = await invokeAssistant({ body });
  const functionResult = readFunctionResult(data, error);
  if (functionResult) return functionResult;
  // Never send a native WebView request to a server route that is not packaged.
  if (Capacitor.isNativePlatform()) throw nativeAssistantFailure(error);
  return fallbackPoll(accessToken, responseId);
}

export async function cancelOrdysResearch(responseId: string): Promise<OrdysAssistantResult> {
  const { accessToken } = await getAccessContext();
  const body = { action: "cancel", responseId };
  const { data, error } = await invokeAssistant({ body });
  const functionResult = readFunctionResult(data, error);
  if (functionResult) return functionResult;
  if (Capacitor.isNativePlatform()) throw nativeAssistantFailure(error);
  return fallbackPost(accessToken, body);
}

export async function applyOrdysConfiguration(plan: OrdysConfigurationPlan) {
  const { accessToken } = await getAccessContext();
  const body = { action: "apply-config", plan };
  const { data, error } = await invokeAssistant({ body });
  const functionResult = readFunctionResult(data, error);
  if (functionResult) return functionResult;
  // Keep the relative API fallback for web only; Android uses the Edge Function.
  if (Capacitor.isNativePlatform()) throw nativeAssistantFailure(error);

  const response = await assistantFetch("/api/ordys-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { status?: string; error?: string; applied?: string[] } | null;
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível aplicar a configuração.");
  return payload ?? { status: "failed", error: "Resposta inválida do servidor." };
}
