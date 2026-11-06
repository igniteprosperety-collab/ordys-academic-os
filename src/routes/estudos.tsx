import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, Play, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, PageTitle, Ring, Stat } from "@/components/ordys/primitives";
import { Button, Field, Select, TextArea, TextInput } from "@/components/ordys/form";
import {
  minutesLabel,
  useAttendance,
  useCheckins,
  useCalendarEvents,
  useExams,
  useFocusSessions,
  useGrades,
  useOrdysMutations,
  usePlanSessions,
  useProfile,
  useReviews,
  useSubjects,
  useSchedules,
  useTasks,
  useTopics,
  type PlanSession,
} from "@/lib/ordys-db";
import {
  addDays,
  dateKey,
  ensureAutomaticReviews,
  formatDay,
  generateWeeklyPlan,
  replanMissed,
  startOfWeek,
  summarize,
  planStatusLabel,
} from "@/lib/ordys-engine";

export const Route = createFileRoute("/estudos")({
  head: () => ({
    meta: [
      { title: "Estudos — Ordys Academy" },
      {
        name: "description",
        content:
          "Plano de estudos inteligente, replanejamento automático, sessões de foco cronometradas, revisões espaçadas e check-in diário no Ordys Academy.",
      },
      { property: "og:title", content: "Estudos — Ordys Academy" },
      {
        property: "og:description",
        content: "Plano gerado a partir das suas provas, tarefas e nível de domínio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Estudos,
});

const groups = [{ items: ["Plano", "Foco", "Revisões", "Check-in"] }];

function checkinPlanLabel(value: string | null) {
  return value === "sim" ? "Sim, tudo" : value === "parcial" ? "Parcialmente" : value === "nao" ? "Não consegui" : "—";
}

function Estudos() {
  const [active, setActive] = useState("Plano");
  const { data: profile } = useProfile();
  const { data: subjects = [] } = useSubjects();
  const { data: topics = [] } = useTopics();
  const { data: tasks = [] } = useTasks();
  const { data: exams = [] } = useExams();
  const { data: grades = [] } = useGrades();
  const { data: attendance = [] } = useAttendance();
  const { data: reviews = [] } = useReviews();
  const { data: plan = [] } = usePlanSessions();
  const { data: focus = [] } = useFocusSessions();
  const { data: checkins = [] } = useCheckins();
  const { data: schedules = [] } = useSchedules();
  const { data: calendarEvents = [] } = useCalendarEvents();
  const { insert, update, userId, refresh } = useOrdysMutations();
  const [busy, setBusy] = useState(false);

  const todayKey = dateKey(new Date());
  const todayCheckin = checkins.find((c) => c.checkin_date === todayKey) ?? null;
  const automaticReviewSignature = [
    ...topics.map((topic) => `t:${topic.id}:${topic.status}:${topic.mastery}:${topic.last_review ?? ""}`),
    ...exams.map((exam) => `e:${exam.id}:${exam.exam_at}`),
    ...reviews.map((review) => `r:${review.id}:${review.status}:${review.due_on}`),
  ].sort().join("|");
  const automaticReviewSignatureRef = useRef<string | null>(null);
  const automaticReviewGeneratingRef = useRef(false);
  useEffect(() => {
    if (
      !userId ||
      !automaticReviewSignature ||
      automaticReviewSignatureRef.current === automaticReviewSignature ||
      automaticReviewGeneratingRef.current
    ) {
      return;
    }
    automaticReviewGeneratingRef.current = true;
    void ensureAutomaticReviews({ userId, topics, exams, reviews })
      .then((created) => {
        automaticReviewSignatureRef.current = automaticReviewSignature;
        if (created > 0) refresh();
      })
      .catch((error) => {
        console.error("[reviews] automatic generation failed", error);
      })
      .finally(() => {
        automaticReviewGeneratingRef.current = false;
      });
  }, [automaticReviewSignature, exams, refresh, reviews, topics, userId]);

  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 6);
  weekEnd.setHours(23, 59, 59, 999);
  const week = summarize(
    { from: weekStart, to: weekEnd },
    { focus, tasks, plan, grades, attendance },
    Number(profile?.grade_scale_max ?? 10),
  );
  const target = profile?.weekly_study_target_minutes ?? 480;
  const planByDay = useMemo(() => {
    const map = new Map<string, PlanSession[]>();
    for (const s of plan) {
      if (s.session_date < todayKey) continue;
      const arr = map.get(s.session_date) ?? [];
      arr.push(s);
      map.set(s.session_date, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 8);
  }, [plan, todayKey]);

  const engineInput = () => ({
    userId: userId!,
    profile: profile ?? null,
    subjects,
    topics,
    tasks,
    exams,
    grades,
    reviews,
    existing: plan,
    schedules,
    calendarEvents,
  });

  async function run(label: string, fn: () => Promise<unknown>) {
    if (!userId) return;
    setBusy(true);
    try {
      await fn();
      refresh();
      toast.success(label);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  const subjectName = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? "Estudo geral";
  const subjectColor = (id: string | null) => subjects.find((s) => s.id === id)?.color ?? "var(--muted-foreground)";

  return (
    <Shell
      contextTitle="Estudos"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Estudos", active]}
      contextFooter={
        <div className="panel px-3 py-3">
          <p className="text-[11px] text-muted-foreground">Meta semanal</p>
          <p className="num mt-1 text-[15px] font-semibold">
            {minutesLabel(week.minutes)}{" "}
            <span className="text-[11px] font-normal text-muted-foreground">de {minutesLabel(target)}</span>
          </p>
          <div className="mt-2">
            <Bar value={Math.min(100, (week.minutes / Math.max(1, target)) * 100)} />
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title="Estudos" subtitle="Plano inteligente, foco, revisões e check-in" />
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => run("Plano replanejado", () => replanMissed(engineInput()))}
          >
            <RefreshCw className="size-[13px]" strokeWidth={1.8} /> Replanejar
          </Button>
          <Button
            disabled={busy}
            onClick={() => run("Plano gerado", () => generateWeeklyPlan(engineInput()))}
          >
            <Sparkles className="size-[13px]" strokeWidth={1.8} /> Gerar plano
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Estudado na semana" value={minutesLabel(week.minutes)} sub={`${week.focusCount} sessões`} accent="primary" />
        <Stat
          label="Sessões planejadas"
          value={`${week.completedPlanCount}/${week.plannedCount}`}
          sub="concluídas nesta semana"
          accent="success"
        />
        <Stat label="Revisões pendentes" value={String(reviews.filter((r) => r.status === "pendente").length)} sub="geradas automaticamente" accent="warning" />
        <Stat
          label="Limite diário"
          value={minutesLabel(profile?.daily_load_limit_minutes ?? 240)}
          sub="respeitado pelo plano"
        />
      </div>

      {active === "Plano" ? (
        <Panel className="mt-4">
          <PanelHeader title="Plano de estudos" hint="gerado a partir de provas, tarefas e domínio" />
          <div className="border-t border-border">
            {planByDay.length ? (
              planByDay.map(([day, sessions]) => (
                <div key={day} className="border-b border-border last:border-0">
                  <div className="flex items-center gap-2 bg-secondary/30 px-5 py-1.5">
                    <span className="text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
                      {formatDay(`${day}T12:00:00`)}
                    </span>
                    <span className="num ml-auto text-[11px] text-muted-foreground">
                      {minutesLabel(sessions.reduce((a, s) => a + s.duration_minutes, 0))}
                    </span>
                  </div>
                  {sessions.map((s) => (
                    <div key={s.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5">
                      <span className="num w-[46px] text-[12px] text-muted-foreground">
                        {s.start_time?.slice(0, 5) ?? "--:--"}
                      </span>
                      <span className="h-6 w-[2px] rounded-full" style={{ background: subjectColor(s.subject_id) }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium">{subjectName(s.subject_id)}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {s.reason ?? s.kind} · {s.duration_minutes} min
                        </p>
                      </div>
                      <Chip tone={s.status === "concluida" ? "success" : s.status === "perdida" ? "danger" : "primary"}>
                        {planStatusLabel(s.status)}
                      </Chip>
                      <button type="button"
                        className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-success sm:size-8"
                        aria-label="Concluir sessão"
                        onClick={() => run("Sessão concluída", () => update("plan_sessions", s.id, { status: "concluida" }))}
                      >
                        <Check className="size-[14px]" strokeWidth={1.8} />
                      </button>
                      <button type="button"
                        className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive sm:size-8"
                        aria-label="Pular sessão"
                        onClick={() => run("Sessão cancelada", () => update("plan_sessions", s.id, { status: "cancelada" }))}
                      >
                        <X className="size-[14px]" strokeWidth={1.8} />
                      </button>
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">
                Nenhuma sessão planejada. Cadastre disciplinas, conteúdos e provas e clique em “Gerar plano”.
              </p>
            )}
          </div>
        </Panel>
      ) : null}

      {active === "Foco" ? (
        <FocusPanel
          subjects={subjects}
          topics={topics}
          plan={plan.filter((p) => p.session_date === todayKey && p.status === "planejada")}
          onSave={async (payload) => {
            await insert("focus_sessions", payload);
          }}
          recent={focus.slice(0, 8).map((f) => ({
            id: f.id,
            label: subjectName(f.subject_id),
            minutes: f.actual_minutes ?? f.planned_minutes,
            status: f.status,
            color: subjectColor(f.subject_id),
          }))}
          weekMinutes={week.minutes}
          target={target}
        />
      ) : null}

      {active === "Revisões" ? (
        <Panel className="mt-4">
          <PanelHeader
            title="Revisões"
            hint="espaçadas por domínio e proximidade de prova"
            action={
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run("Revisões atualizadas", () =>
                    ensureAutomaticReviews({ userId: userId!, topics, exams, reviews }),
                  )
                }
              >
                <RotateCcw className="size-[13px]" strokeWidth={1.8} /> Atualizar revisões
              </Button>
            }
          />
          <div className="border-t border-border">
            {reviews.filter((r) => r.status === "pendente").length ? (
              reviews
                .filter((r) => r.status === "pendente")
                .map((r) => {
                  const topic = topics.find((t) => t.id === r.topic_id);
                  return (
                    <div key={r.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5">
                      <Dot color={subjectColor(topic?.subject_id ?? null)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px]">{topic?.title ?? "Conteúdo"}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{r.reason ?? "Revisão programada"}</p>
                      </div>
                      <Chip className="shrink-0" tone={r.due_on <= todayKey ? "danger" : "gold"}>{formatDay(`${r.due_on}T12:00:00`)}</Chip>
                      <button type="button"
                        className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-success sm:size-8"
                        aria-label="Concluir revisão"
                        disabled={busy}
                        onClick={() =>
                          run("Revisão concluída", async () => {
                            await update("reviews", r.id, {
                              status: "concluida",
                              completed_at: new Date().toISOString(),
                            });
                            if (!topic) return;
                            try {
                              await update("topics", topic.id, {
                                last_review: todayKey,
                                mastery: Math.min(100, topic.mastery + 10),
                              });
                            } catch (error) {
                              try {
                                await update("reviews", r.id, {
                                  status: "pendente",
                                  completed_at: null,
                                });
                              } catch (rollbackError) {
                                console.error("[reviews] rollback failed", rollbackError);
                              }
                              throw error;
                            }
                          })
                        }
                      >
                        <Check className="size-[14px]" strokeWidth={1.8} />
                      </button>
                    </div>
                  );
                })
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">
                Sem revisões pendentes. Elas são criadas automaticamente quando o domínio está baixo ou uma prova se
                aproxima.
              </p>
            )}
          </div>
        </Panel>
      ) : null}

      {active === "Check-in" ? (
        <CheckinPanel
          subjects={subjects}
          already={!!todayCheckin}
          history={checkins.slice(0, 7)}
          onSave={async (payload) => {
            if (todayCheckin) {
              await update("daily_checkins", todayCheckin.id, payload);
              toast.success("Check-in atualizado");
            } else {
              await insert("daily_checkins", { ...payload, checkin_date: todayKey });
              toast.success("Check-in registrado");
            }
            refresh();
          }}
        />
      ) : null}
    </Shell>
  );
}

function FocusPanel({
  subjects,
  topics,
  plan,
  onSave,
  recent,
  weekMinutes,
  target,
}: {
  subjects: { id: string; name: string; color: string }[];
  topics: { id: string; title: string; subject_id: string }[];
  plan: PlanSession[];
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  recent: { id: string; label: string; minutes: number; status: string; color: string }[];
  weekMinutes: number;
  target: number;
}) {
  const [minutes, setMinutes] = useState(50);
  const [subjectId, setSubjectId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [planId, setPlanId] = useState("");
  const [left, setLeft] = useState(50 * 60);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const startedAt = useRef<string | null>(null);
  const timerEndAt = useRef<number | null>(null);

  const sessionStarted = startedAt.current !== null;
  const elapsedMinutes = Math.max(0, Math.round((minutes * 60 - left) / 60));

  const finish = useCallback(async (status: "concluida" | "cancelada") => {
    if (saving || !startedAt.current) return;
    setRunning(false);
    setSaving(true);
    const actualMinutes = status === "concluida" ? Math.max(1, elapsedMinutes) : elapsedMinutes;
    try {
      await onSave({
        subject_id: subjectId || null,
        topic_id: topicId || null,
        plan_session_id: planId || null,
        planned_minutes: minutes,
        actual_minutes: actualMinutes,
        started_at: startedAt.current,
        ended_at: new Date().toISOString(),
        status,
      });
      startedAt.current = null;
      timerEndAt.current = null;
      setLeft(minutes * 60);
      toast.success(status === "concluida" ? `Sessão de ${actualMinutes} min salva` : "Sessão cancelada");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível salvar a sessão.";
      toast.error(message);
      setLeft((current) => Math.max(1, current));
    } finally {
      setSaving(false);
    }
  }, [elapsedMinutes, minutes, onSave, planId, saving, subjectId, topicId]);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const endAt = timerEndAt.current;
      if (endAt === null) return;
      setLeft(Math.max(0, Math.ceil((endAt - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    setLeft(minutes * 60);
  }, [minutes]);

  useEffect(() => {
    if (!running || left > 0) return;
    void finish("concluida");
  }, [finish, left, running]);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel className="px-6 py-8 text-center">
        <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Sessão de foco</p>
        <p className="num mt-4 text-[64px] leading-none font-semibold tracking-tight tabular-nums">
          {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
        </p>
        <div className="mx-auto mt-6 flex w-full max-w-xs flex-col gap-3">
          <div className="flex justify-center gap-2">
            {[25, 50, 90].map((m) => (
              <button type="button"
                key={m}
                disabled={sessionStarted}
                onClick={() => setMinutes(m)}
                className={`min-h-11 rounded-lg border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-40 ${
                  minutes === m ? "border-primary/40 bg-primary-soft" : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {m} min
              </button>
            ))}
          </div>
          <Field label="Disciplina">
            <Select
              value={subjectId}
              disabled={sessionStarted}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setTopicId("");
              }}
            >
              <option value="">Sem disciplina</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Conteúdo">
            <Select value={topicId} disabled={sessionStarted} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">Sem conteúdo</option>
              {topics
                .filter((t) => !subjectId || t.subject_id === subjectId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </Select>
          </Field>
          {plan.length ? (
            <Field label="Vincular a uma sessão do plano">
              <Select value={planId} disabled={sessionStarted} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Sem vínculo</option>
                {plan.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reason ?? p.kind} · {p.duration_minutes} min
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="flex justify-center gap-2">
            {running ? (
              <>
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    if (timerEndAt.current !== null) {
                      setLeft(Math.max(0, Math.ceil((timerEndAt.current - Date.now()) / 1000)));
                    }
                    timerEndAt.current = null;
                    setRunning(false);
                  }}
                >
                  <Pause className="size-[13px]" strokeWidth={1.8} /> Pausar
                </Button>
                <Button disabled={saving} onClick={() => void finish("concluida")}>
                  <Check className="size-[13px]" strokeWidth={1.8} /> Concluir
                </Button>
                <Button variant="danger" disabled={saving} onClick={() => void finish("cancelada")}>
                  <X className="size-[13px]" strokeWidth={1.8} /> Cancelar
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  startedAt.current = startedAt.current ?? new Date().toISOString();
                  timerEndAt.current = Date.now() + left * 1000;
                  setRunning(true);
                }}
              >
                <Play className="size-[13px]" strokeWidth={2} /> Iniciar foco
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel>
          <PanelHeader title="Semana" hint="tempo real de estudo" />
          <div className="flex flex-wrap items-center gap-5 border-t border-border px-5 py-5">
            <Ring value={Math.min(100, (weekMinutes / Math.max(1, target)) * 100)} size={72} />
            <div>
              <p className="num text-[16px] font-semibold">{minutesLabel(weekMinutes)}</p>
              <p className="text-[11.5px] text-muted-foreground">meta {minutesLabel(target)}</p>
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Sessões recentes" />
          <div className="border-t border-border">
            {recent.length ? (
              recent.map((r) => (
                <div key={r.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 text-[12px]">
                  <Dot color={r.color} />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="num shrink-0 text-muted-foreground">{minutesLabel(r.minutes)}</span>
                  <Chip className="shrink-0" tone={r.status === "concluida" ? "success" : "muted"}>{planStatusLabel(r.status)}</Chip>
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhuma sessão registrada ainda.</p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function CheckinPanel({
  subjects,
  already,
  history,
  onSave,
}: {
  subjects: { id: string; name: string }[];
  already: boolean;
  history: { id: string; checkin_date: string; focus_rating: number | null; studied_minutes: number | null; completed_plan: string | null }[];
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    completed_plan: "parcial",
    focus_rating: "3",
    studied_minutes: "",
    hardest_subject_id: "",
    pending_note: "",
  });
  const [saving, setSaving] = useState(false);

  async function saveCheckin() {
    const studiedMinutes =
      form.studied_minutes.trim() === "" ? null : Number(form.studied_minutes);
    if (
      studiedMinutes !== null &&
      (!Number.isInteger(studiedMinutes) || studiedMinutes < 0 || studiedMinutes > 1440)
    ) {
      toast.error("Os minutos estudados devem ser um número inteiro entre 0 e 1440.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        completed_plan: form.completed_plan,
        focus_rating: Number(form.focus_rating),
        studied_minutes: studiedMinutes,
        hardest_subject_id: form.hardest_subject_id || null,
        pending_note: form.pending_note.trim() || null,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o check-in.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
      <Panel className="px-5 py-5">
        <p className="text-[13px] font-semibold">Check-in de hoje</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Três perguntas rápidas que ajustam seu plano e alimentam os resumos.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Cumpriu o plano de hoje?">
            <Select
              value={form.completed_plan}
              onChange={(e) => setForm({ ...form, completed_plan: e.target.value })}
            >
              <option value="sim">Sim, tudo</option>
              <option value="parcial">Parcialmente</option>
              <option value="nao">Não consegui</option>
            </Select>
          </Field>
          <Field label="Nível de foco (1–5)">
            <Select value={form.focus_rating} onChange={(e) => setForm({ ...form, focus_rating: e.target.value })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Minutos estudados">
            <TextInput
              value={form.studied_minutes}
              onChange={(e) => setForm({ ...form, studied_minutes: e.target.value })}
            />
          </Field>
          <Field label="Disciplina mais difícil hoje">
            <Select
              value={form.hardest_subject_id}
              onChange={(e) => setForm({ ...form, hardest_subject_id: e.target.value })}
            >
              <option value="">Nenhuma</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="O que ficou pendente?" className="sm:col-span-2">
            <TextArea
              value={form.pending_note}
              onChange={(e) => setForm({ ...form, pending_note: e.target.value })}
            />
          </Field>
        </div>
        <Button className="mt-4" onClick={saveCheckin} disabled={saving}>
          {saving ? "Salvando…" : already ? "Atualizar check-in" : "Registrar check-in"}
        </Button>
      </Panel>
      <Panel>
        <PanelHeader title="Últimos check-ins" />
        <div className="border-t border-border">
          {history.length ? (
            history.map((c) => (
              <div key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 text-[12px]">
                <span className="num flex-1">{formatDay(`${c.checkin_date}T12:00:00`)}</span>
                <Chip className="shrink-0" tone={c.completed_plan === "sim" ? "success" : c.completed_plan === "nao" ? "danger" : "gold"}>
                  {checkinPlanLabel(c.completed_plan)}
                </Chip>
                <span className="num text-muted-foreground">foco {c.focus_rating ?? "—"}</span>
              </div>
            ))
          ) : (
            <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhum check-in ainda.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
