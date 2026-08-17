import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/ordys/shell";
import { Chip, Dot, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import { Button } from "@/components/ordys/form";
import {
  useCalendarEvents,
  useExams,
  usePlanSessions,
  useSchedules,
  useSubjects,
  useTasks,
} from "@/lib/ordys-db";
import { addDays, dateKey, formatDateTime, startOfWeek, weekdayShort } from "@/lib/ordys-engine";

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — ORDYS" },
      {
        name: "description",
        content:
          "Agenda acadêmica unificada: aulas recorrentes, provas, prazos de tarefas, sessões de estudo e eventos externos na mesma semana.",
      },
      { property: "og:title", content: "Agenda — ORDYS" },
      {
        property: "og:description",
        content: "Aulas, provas, prazos e sessões de estudo em uma visão semanal única.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Agenda,
});

const groups = [{ items: ["Semana", "Provas", "Prazos", "Eventos"] }];

type Item = {
  key: string;
  time: string;
  label: string;
  meta: string;
  color: string;
  tone: "aula" | "prova" | "estudo" | "tarefa" | "evento";
};

function Agenda() {
  const [active, setActive] = useState("Semana");
  const [offset, setOffset] = useState(0);
  const { data: subjects = [] } = useSubjects();
  const { data: schedules = [] } = useSchedules();
  const { data: exams = [] } = useExams();
  const { data: tasks = [] } = useTasks();
  const { data: plan = [] } = usePlanSessions();
  const { data: events = [] } = useCalendarEvents();

  const from = addDays(startOfWeek(new Date()), offset * 7);
  const days = Array.from({ length: 7 }).map((_, i) => addDays(from, i));
  const todayKey = dateKey(new Date());
  const color = (id: string | null, fallback: string) => subjects.find((s) => s.id === id)?.color ?? fallback;
  const name = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? "Geral";

  function itemsFor(day: Date): Item[] {
    const key = dateKey(day);
    const weekday = (day.getDay() + 6) % 7;
    const out: Item[] = [];
    for (const s of schedules.filter((x) => x.weekday === weekday)) {
      out.push({
        key: `c${s.id}${key}`,
        time: s.start_time.slice(0, 5),
        label: name(s.subject_id),
        meta: s.room ?? "Aula",
        color: color(s.subject_id, "var(--primary)"),
        tone: "aula",
      });
    }
    for (const e of exams.filter((x) => dateKey(new Date(x.exam_at)) === key)) {
      out.push({
        key: `e${e.id}`,
        time: new Date(e.exam_at).toTimeString().slice(0, 5),
        label: `${e.kind === "simulado" ? "Simulado" : "Prova"} · ${name(e.subject_id)}`,
        meta: e.title,
        color: "var(--gold)",
        tone: "prova",
      });
    }
    for (const t of tasks.filter((x) => x.due_at && dateKey(new Date(x.due_at)) === key && x.status !== "concluida")) {
      out.push({
        key: `t${t.id}`,
        time: new Date(t.due_at!).toTimeString().slice(0, 5),
        label: t.title,
        meta: `Entrega · ${name(t.subject_id)}`,
        color: "var(--warning)",
        tone: "tarefa",
      });
    }
    for (const p of plan.filter((x) => x.session_date === key)) {
      out.push({
        key: `p${p.id}`,
        time: p.start_time?.slice(0, 5) ?? "23:59",
        label: p.reason ?? "Sessão de estudo",
        meta: `${p.duration_minutes} min · ${name(p.subject_id)}`,
        color: color(p.subject_id, "var(--primary)"),
        tone: "estudo",
      });
    }
    for (const ev of events.filter((x) => dateKey(new Date(x.starts_at)) === key)) {
      out.push({
        key: `v${ev.id}`,
        time: new Date(ev.starts_at).toTimeString().slice(0, 5),
        label: ev.title,
        meta: ev.location ?? ev.source,
        color: "var(--muted-foreground)",
        tone: "evento",
      });
    }
    return out.sort((a, b) => a.time.localeCompare(b.time));
  }

  const upcomingExams = exams
    .filter((e) => new Date(e.exam_at) >= new Date())
    .sort((a, b) => (a.exam_at < b.exam_at ? -1 : 1));
  const upcomingTasks = tasks
    .filter((t) => t.status !== "concluida" && t.due_at)
    .sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1));

  return (
    <Shell
      contextTitle="Agenda"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Agenda", active]}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle
          title="Agenda"
          subtitle={`${from.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${addDays(from, 6).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`}
        />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setOffset(offset - 1)}>
            Semana anterior
          </Button>
          <Button variant="ghost" onClick={() => setOffset(0)}>
            Hoje
          </Button>
          <Button variant="ghost" onClick={() => setOffset(offset + 1)}>
            Próxima semana
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Aulas na semana" value={String(schedules.length)} sub="horários cadastrados" accent="primary" />
        <Stat label="Provas futuras" value={String(upcomingExams.length)} sub="incluindo simulados" accent="warning" />
        <Stat label="Prazos abertos" value={String(upcomingTasks.length)} sub="tarefas com data" />
        <Stat label="Sessões planejadas" value={String(plan.filter((p) => p.status === "planejada").length)} sub="plano de estudos" accent="success" />
      </div>

      {active === "Semana" ? (
        <Panel className="mt-4 overflow-x-auto">
          <div className="grid min-w-[900px] grid-cols-7 gap-px bg-border">
            {days.map((day, i) => {
              const key = dateKey(day);
              const items = itemsFor(day);
              return (
                <div key={key} className="min-h-[320px] bg-surface">
                  <div
                    className={`flex items-center gap-2 border-b border-border px-3 py-2 ${
                      key === todayKey ? "bg-primary-soft" : ""
                    }`}
                  >
                    <span className="text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
                      {weekdayShort[i]}
                    </span>
                    <span className="num ml-auto text-[12px] font-semibold">{day.getDate()}</span>
                  </div>
                  <div className="flex flex-col gap-1.5 p-2">
                    {items.length ? (
                      items.map((it) => (
                        <div key={it.key} className="rounded-md border border-border bg-background/40 px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="h-3 w-[2px] rounded-full" style={{ background: it.color }} />
                            <span className="num text-[10.5px] text-muted-foreground">{it.time}</span>
                          </div>
                          <p className="mt-0.5 truncate text-[11.5px] font-medium">{it.label}</p>
                          <p className="truncate text-[10.5px] text-muted-foreground">{it.meta}</p>
                        </div>
                      ))
                    ) : (
                      <p className="px-1 py-2 text-[10.5px] text-muted-foreground">livre</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {active === "Provas" ? (
        <Panel className="mt-4">
          <PanelHeader title="Provas e simulados" hint={`${upcomingExams.length} futuras`} />
          <div className="border-t border-border">
            {upcomingExams.length ? (
              upcomingExams.map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <Dot color={color(e.subject_id, "var(--gold)")} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium">
                      {name(e.subject_id)} — {e.title}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{e.content ?? e.kind}</p>
                  </div>
                  {e.weight ? <Chip tone="gold">{e.weight}</Chip> : null}
                  <span className="num text-[11px] text-muted-foreground">{formatDateTime(e.exam_at)}</span>
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">
                Nenhuma avaliação futura. Use a captura rápida para adicionar uma prova.
              </p>
            )}
          </div>
        </Panel>
      ) : null}

      {active === "Prazos" ? (
        <Panel className="mt-4">
          <PanelHeader title="Prazos de entrega" hint={`${upcomingTasks.length} tarefas`} />
          <div className="border-t border-border">
            {upcomingTasks.length ? (
              upcomingTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Dot color={color(t.subject_id, "var(--warning)")} />
                  <p className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</p>
                  <Chip tone={t.priority === "alta" ? "danger" : "muted"}>{t.priority}</Chip>
                  <span className="num text-[11px] text-muted-foreground">{formatDateTime(t.due_at)}</span>
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhum prazo aberto.</p>
            )}
          </div>
        </Panel>
      ) : null}

      {active === "Eventos" ? (
        <Panel className="mt-4">
          <PanelHeader title="Eventos" hint="importados ou criados manualmente" />
          <div className="border-t border-border">
            {events.length ? (
              events.map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Dot color={color(e.subject_id, "var(--muted-foreground)")} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px]">{e.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {e.location ?? "sem local"} · origem {e.source}
                    </p>
                  </div>
                  <span className="num text-[11px] text-muted-foreground">{formatDateTime(e.starts_at)}</span>
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">
                Nenhum evento. Você pode adicionar eventos pela captura rápida.
              </p>
            )}
          </div>
        </Panel>
      ) : null}
    </Shell>
  );
}
