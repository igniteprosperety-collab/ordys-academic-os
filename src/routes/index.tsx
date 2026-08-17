import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clock, Play } from "lucide-react";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, Ring, Stat } from "@/components/ordys/primitives";
import { Button } from "@/components/ordys/form";
import {
  fmtNumber,
  minutesLabel,
  subjectAttendance,
  subjectAverage,
  useAttendance,
  useCalendarEvents,
  useExams,
  useFocusSessions,
  useGrades,
  useNotificationPrefs,
  usePlanSessions,
  useProfile,
  useReviews,
  useSchedules,
  useSubjects,
  useTasks,
  useTopics,
} from "@/lib/ordys-db";
import {
  addDays,
  dateKey,
  daysUntil,
  formatDateTime,
  startOfWeek,
  summarize,
  syncNotifications,
  weekdayShort,
} from "@/lib/ordys-engine";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ORDYS — Sistema operacional da sua vida acadêmica" },
      {
        name: "description",
        content:
          "ORDYS reúne agenda, tarefas, estudos, notas e desempenho em um único painel premium para estudantes do ensino médio e da universidade.",
      },
      { property: "og:title", content: "ORDYS — Discipline your day. Learn with purpose." },
      {
        property: "og:description",
        content:
          "Painel acadêmico inteligente: o que você tem hoje, o que precisa fazer e como está evoluindo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const groups = [
  { items: ["Hoje", "Semana", "Atenção", "Progresso"] },
  { label: "Atalhos", items: ["Sessão de foco", "Nova tarefa", "Notificações"] },
];

function Home() {
  const [active, setActive] = useState("Hoje");
  const { data: profile } = useProfile();
  const { data: subjects = [] } = useSubjects();
  const { data: schedules = [] } = useSchedules();
  const { data: topics = [] } = useTopics();
  const { data: tasks = [] } = useTasks();
  const { data: exams = [] } = useExams();
  const { data: grades = [] } = useGrades();
  const { data: attendance = [] } = useAttendance();
  const { data: plan = [] } = usePlanSessions();
  const { data: focus = [] } = useFocusSessions();
  const { data: reviews = [] } = useReviews();
  const { data: events = [] } = useCalendarEvents();
  const { data: prefs } = useNotificationPrefs();

  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !profile) return;
    synced.current = true;
    void syncNotifications({
      userId: profile.id,
      subjects,
      topics,
      tasks,
      exams,
      plan,
      grades,
      attendance,
      profile,
      prefs: prefs ?? null,
    }).catch(() => undefined);
  }, [profile, subjects, topics, tasks, exams, plan, grades, attendance, prefs]);

  const now = new Date();
  const todayKey = dateKey(now);
  const weekday = (now.getDay() + 6) % 7;
  const scale = Number(profile?.grade_scale_max ?? 10);

  const classesToday = schedules
    .filter((s) => s.weekday === weekday)
    .map((s) => ({
      key: `class-${s.id}`,
      time: s.start_time.slice(0, 5),
      end: s.end_time.slice(0, 5),
      label: subjects.find((x) => x.id === s.subject_id)?.name ?? "Aula",
      meta: s.room ?? subjects.find((x) => x.id === s.subject_id)?.teacher ?? "Aula",
      color: subjects.find((x) => x.id === s.subject_id)?.color ?? "var(--primary)",
      kind: "aula" as const,
    }));

  const planToday = plan
    .filter((p) => p.session_date === todayKey)
    .map((p) => ({
      key: `plan-${p.id}`,
      time: p.start_time?.slice(0, 5) ?? "--:--",
      end: "",
      label: p.reason ?? "Sessão de estudo",
      meta: `${subjects.find((x) => x.id === p.subject_id)?.name ?? "Estudo"} · ${p.duration_minutes} min`,
      color: subjects.find((x) => x.id === p.subject_id)?.color ?? "var(--gold)",
      kind: "estudo" as const,
    }));

  const eventsToday = events
    .filter((e) => dateKey(new Date(e.starts_at)) === todayKey)
    .map((e) => ({
      key: `event-${e.id}`,
      time: new Date(e.starts_at).toTimeString().slice(0, 5),
      end: "",
      label: e.title,
      meta: e.location ?? e.kind,
      color: subjects.find((x) => x.id === e.subject_id)?.color ?? "var(--primary)",
      kind: "evento" as const,
    }));

  const dayBlocks = [...classesToday, ...planToday, ...eventsToday].sort((a, b) => a.time.localeCompare(b.time));
  const nextBlock = dayBlocks.find((b) => b.time >= now.toTimeString().slice(0, 5));

  const openTasks = tasks.filter((t) => t.status !== "concluida");
  const late = openTasks.filter((t) => {
    const left = daysUntil(t.due_at);
    return left !== null && left < 0;
  });
  const nextTask = openTasks
    .filter((t) => t.due_at)
    .sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1))[0];
  const nextExam = exams
    .filter((e) => (daysUntil(e.exam_at) ?? -1) >= 0)
    .sort((a, b) => (a.exam_at < b.exam_at ? -1 : 1))[0];

  const averages = subjects
    .map((s) => subjectAverage(grades, s.id, scale))
    .filter((v): v is number => v !== null);
  const overall = averages.length ? averages.reduce((a, b) => a + b, 0) / averages.length : null;

  const weekRange = { from: startOfWeek(now), to: addDays(startOfWeek(now), 6) };
  const week = summarize(weekRange, { focus, tasks, plan, grades, attendance });
  const target = profile?.weekly_study_target_minutes ?? 480;

  const attention: { tone: string; text: string; meta: string }[] = [];
  if (late.length)
    attention.push({
      tone: "destructive",
      text: `${late.length} tarefa(s) atrasada(s).`,
      meta: late.slice(0, 2).map((t) => t.title).join(" · "),
    });
  if (nextExam) {
    const left = daysUntil(nextExam.exam_at) ?? 0;
    attention.push({
      tone: "primary",
      text: `Prova de ${subjects.find((s) => s.id === nextExam.subject_id)?.name ?? "disciplina"} em ${left} dia(s).`,
      meta: nextExam.content ?? nextExam.title,
    });
  }
  for (const s of subjects) {
    const att = subjectAttendance(attendance, s.id);
    const goal = Number(s.attendance_goal ?? profile?.attendance_target ?? 75);
    if (att !== null && att < goal)
      attention.push({
        tone: "gold",
        text: `Frequência em ${s.name} caiu para ${att.toFixed(0)}%.`,
        meta: `Meta: ${goal}%`,
      });
  }
  const pendingReviews = reviews.filter((r) => r.status === "pendente" && r.due_on <= todayKey);
  if (pendingReviews.length)
    attention.push({
      tone: "warning",
      text: `${pendingReviews.length} revisão(ões) para hoje.`,
      meta: "Geradas automaticamente pelo seu nível de domínio",
    });

  const weekDays = Array.from({ length: 7 }).map((_, i) => {
    const day = addDays(weekRange.from, i);
    const key = dateKey(day);
    return {
      key,
      label: weekdayShort[i]!,
      date: String(day.getDate()),
      active: key === todayKey,
      load:
        plan.filter((p) => p.session_date === key).length +
        schedules.filter((s) => s.weekday === i).length,
      exams: exams.filter((e) => dateKey(new Date(e.exam_at)) === key).length,
    };
  });

  const studyBySubject = subjects
    .map((s) => {
      const planned = plan.filter((p) => p.subject_id === s.id && p.session_date >= dateKey(weekRange.from));
      const done = planned.filter((p) => p.status === "concluida").length;
      return { subject: s, done: planned.length ? (done / planned.length) * 100 : 0, planned: planned.length };
    })
    .filter((x) => x.planned)
    .slice(0, 3);

  const empty = !subjects.length;

  return (
    <Shell
      contextTitle="Início"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Início", active]}
      contextFooter={
        <div className="panel px-3 py-3">
          <p className="text-[11px] text-muted-foreground">Semana atual</p>
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] leading-tight font-semibold tracking-tight">
            Olá{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </p>
        </div>
        <Link to="/estudos">
          <Button>
            <Play className="size-[13px]" strokeWidth={2} /> Iniciar foco
          </Button>
        </Link>
      </div>

      {empty ? (
        <Panel className="mt-6 px-5 py-8 text-center">
          <p className="text-[13px] font-medium">Bem-vindo ao ORDYS.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Comece criando suas disciplinas — a partir delas o ORDYS monta agenda, tarefas, provas, plano de estudos e
            desempenho.
          </p>
          <Link to="/disciplinas" className="mt-4 inline-block">
            <Button>Criar minha primeira disciplina</Button>
          </Link>
        </Panel>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Próximo compromisso"
          value={nextBlock?.time ?? "—"}
          sub={nextBlock ? `${nextBlock.label}` : "nada restante hoje"}
          accent="primary"
        />
        <Stat
          label="Próxima tarefa"
          value={nextTask ? formatDateTime(nextTask.due_at) : "—"}
          sub={nextTask?.title ?? "sem tarefas com prazo"}
        />
        <Stat
          label="Próxima prova"
          value={nextExam ? `Em ${daysUntil(nextExam.exam_at)} dias` : "—"}
          sub={nextExam ? (subjects.find((s) => s.id === nextExam.subject_id)?.name ?? nextExam.title) : "nenhuma marcada"}
        />
        <Stat
          label="Pendências"
          value={`${late.length} atrasadas`}
          sub={`${openTasks.length} tarefas abertas`}
          accent="warning"
        />
        <Stat
          label="Média geral"
          value={overall === null ? "—" : fmtNumber(overall)}
          sub={`escala 0 – ${scale}`}
          accent="success"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Panel>
          <PanelHeader
            title="Visão do dia"
            hint={`${dayBlocks.length} blocos`}
            action={<Chip tone="primary">Agora · {now.toTimeString().slice(0, 5)}</Chip>}
          />
          <div className="border-t border-border">
            {dayBlocks.length ? (
              dayBlocks.map((b) => (
                <div
                  key={b.key}
                  className="flex items-center gap-4 px-5 py-2.5 transition-colors hover:bg-secondary/40"
                >
                  <span className="num w-[74px] text-[12px] text-muted-foreground">
                    {b.time}
                    {b.end ? `–${b.end}` : ""}
                  </span>
                  <span className="h-7 w-[2px] rounded-full" style={{ background: b.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{b.label}</p>
                    <p className="truncate text-[11.5px] text-muted-foreground">{b.meta}</p>
                  </div>
                  {b.key === nextBlock?.key ? <Chip tone="primary">a seguir</Chip> : null}
                  {b.kind === "estudo" ? <Chip>foco</Chip> : null}
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">
                Nenhum bloco hoje. Cadastre horários das aulas nas disciplinas ou gere seu plano de estudos.
              </p>
            )}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="O que precisa da sua atenção" />
            <div className="border-t border-border">
              {attention.length ? (
                attention.slice(0, 5).map((a) => (
                  <div key={a.text} className="flex gap-3 px-5 py-3">
                    <span
                      className="mt-[6px] size-1.5 shrink-0 rounded-full"
                      style={{ background: `var(--${a.tone})` }}
                    />
                    <div className="min-w-0">
                      <p className="text-[12.5px] leading-snug">{a.text}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{a.meta}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="px-5 py-6 text-[12px] text-muted-foreground">Tudo em ordem por aqui.</p>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Semana"
              hint={`${weekRange.from.getDate()} – ${weekRange.to.getDate()}`}
            />
            <div className="grid grid-cols-7 gap-1.5 border-t border-border px-4 py-4">
              {weekDays.map((d) => (
                <div key={d.key} className="flex flex-col items-center gap-2">
                  <span className="text-[10.5px] text-muted-foreground">{d.label}</span>
                  <span
                    className={`num grid size-7 place-items-center rounded-md text-[12px] ${
                      d.active ? "bg-primary text-primary-foreground" : "bg-secondary"
                    }`}
                  >
                    {d.date}
                  </span>
                  <div className="flex h-10 w-full flex-col justify-end gap-[3px]">
                    {Array.from({ length: Math.min(6, d.load) }).map((_, i) => (
                      <span key={i} className="h-[3px] rounded-full bg-primary/35" />
                    ))}
                    {d.exams ? <span className="h-[3px] rounded-full bg-gold" /> : null}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Tarefas próximas" action={<Chip>{openTasks.length} abertas</Chip>} />
          <div className="border-t border-border">
            {openTasks.slice(0, 5).length ? (
              openTasks.slice(0, 5).map((t) => {
                const s = subjects.find((x) => x.id === t.subject_id);
                const left = daysUntil(t.due_at);
                return (
                  <div key={t.id} className="flex items-start gap-3 px-5 py-2.5">
                    <span className="mt-[3px] size-3.5 shrink-0 rounded-[4px] border border-border-strong" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px]">{t.title}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                        {s ? (
                          <>
                            <Dot color={s.color} /> {s.name} ·{" "}
                          </>
                        ) : null}
                        {formatDateTime(t.due_at)}
                      </p>
                    </div>
                    {left !== null && left < 0 ? <Chip tone="danger">atrasada</Chip> : null}
                  </div>
                );
              })
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">Sem tarefas abertas.</p>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Próxima prova" />
          {nextExam ? (
            <div className="border-t border-border px-5 py-4">
              <p className="text-[14px] font-semibold">
                {subjects.find((s) => s.id === nextExam.subject_id)?.name ?? nextExam.title}
              </p>
              <p className="num mt-1 text-[12px] text-muted-foreground">{formatDateTime(nextExam.exam_at)}</p>
              <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                {nextExam.content ?? "Sem conteúdo detalhado."}
              </p>
              <div className="mt-4 flex items-center gap-2">
                {nextExam.weight ? <Chip tone="gold">{nextExam.weight}</Chip> : null}
                <Chip tone="primary">em {daysUntil(nextExam.exam_at)} dias</Chip>
              </div>
            </div>
          ) : (
            <p className="border-t border-border px-5 py-6 text-[12px] text-muted-foreground">
              Nenhuma avaliação marcada.
            </p>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Progresso" hint="esta semana" />
          <div className="flex items-center gap-5 border-t border-border px-5 py-4">
            <Ring
              value={week.plannedCount ? (week.completedPlanCount / week.plannedCount) * 100 : 0}
              size={72}
            />
            <div className="flex-1 space-y-2.5">
              {studyBySubject.length ? (
                studyBySubject.map((p) => (
                  <div key={p.subject.id}>
                    <div className="mb-1 flex items-center justify-between text-[11.5px]">
                      <span className="flex items-center gap-1.5">
                        <Dot color={p.subject.color} /> {p.subject.name}
                      </span>
                      <span className="num text-muted-foreground">{p.done.toFixed(0)}%</span>
                    </div>
                    <Bar value={p.done} />
                  </div>
                ))
              ) : (
                <p className="text-[11.5px] text-muted-foreground">Gere o plano de estudos para ver o progresso.</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-[11.5px] text-muted-foreground">
            <Clock className="size-[13px]" strokeWidth={1.6} />
            {minutesLabel(week.minutes)} estudados nesta semana
            <ArrowUpRight className="ml-auto size-[13px] text-success" strokeWidth={1.8} />
            <span className="text-success">{week.tasksDone} tarefas entregues</span>
          </div>
        </Panel>
      </div>

      {subjects.length ? (
        <Panel className="mt-4">
          <PanelHeader title="Disciplinas" hint={`${subjects.length} ativas`} />
          <div className="grid grid-cols-2 gap-px border-t border-border bg-border lg:grid-cols-3">
            {subjects.map((s) => {
              const avg = subjectAverage(grades, s.id, scale);
              const att = subjectAttendance(attendance, s.id);
              return (
                <div key={s.id} className="bg-surface px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <Dot color={s.color} />
                    <p className="text-[13px] font-medium">{s.name}</p>
                    <span className="num ml-auto text-[13px] font-semibold">
                      {avg === null ? "—" : fmtNumber(avg)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {s.teacher ?? "sem professor"} · {s.room ?? "sem sala"}
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Bar value={att ?? 0} tone={att !== null && att < 85 ? "warning" : "primary"} />
                    <span className="num text-[10.5px] text-muted-foreground">
                      {att === null ? "—" : `${att.toFixed(0)}%`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <p className="mt-8 text-center text-[11px] tracking-[0.14em] text-muted-foreground/70 uppercase">
        Ordys · Discipline your day. Learn with purpose.
      </p>
    </Shell>
  );
}
