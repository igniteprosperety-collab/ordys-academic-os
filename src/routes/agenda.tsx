import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/ordys/shell";
import { Chip, Dot, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import { Button } from "@/components/ordys/form";
import {
  subjectAttendance,
  subjectAverage,
  useAttendance,
  useCalendarEvents,
  useExams,
  useGrades,
  usePlanSessions,
  useProfile,
  useSchedules,
  useSubjects,
  useTasks,
  useTopics,
} from "@/lib/ordys-db";
import {
  addDays,
  attendanceStatusLabel,
  dateKey,
  formatDateTime,
  formatDay,
  priorityLabel,
  parseTimeOfDay,
  startOfWeek,
  topicStatusLabel,
  weekdayLong,
  weekdayShort,
} from "@/lib/ordys-engine";

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — Ordys Academy" },
      { name: "description", content: "Agenda acadêmica unificada: aulas recorrentes, provas, prazos de tarefas, sessões de estudo e eventos externos na mesma semana." },
      { property: "og:title", content: "Agenda — Ordys Academy" },
      { property: "og:description", content: "Aulas, provas, prazos e sessões de estudo em uma visão semanal única." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Agenda,
});

const groups = [{ items: ["Dia", "Semana", "Mês", "Provas", "Prazos", "Eventos"] }];
type SubjectSection = "resumo" | "horarios" | "academico" | "desempenho";

type Item = {
  key: string;
  time: string;
  label: string;
  meta: string;
  color: string;
  tone: "aula" | "prova" | "estudo" | "tarefa" | "evento";
  subjectId: string | null;
  scheduleId?: string;
};

function Agenda() {
  const [active, setActive] = useState("Semana");
  const [offset, setOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => (new Date().getDay() + 6) % 7);
  const [monthOffset, setMonthOffset] = useState(0);
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [subjectSection, setSubjectSection] = useState<SubjectSection>("resumo");

  const { data: subjects = [] } = useSubjects();
  const { data: schedules = [] } = useSchedules();
  const { data: exams = [] } = useExams();
  const { data: tasks = [] } = useTasks();
  const { data: plan = [] } = usePlanSessions();
  const { data: events = [] } = useCalendarEvents();
  const { data: attendance = [] } = useAttendance();
  const { data: grades = [] } = useGrades();
  const { data: profile } = useProfile();
  const { data: topics = [] } = useTopics(selectedSubjectId);

  const from = addDays(startOfWeek(new Date()), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const selectedDate = days[selectedDay] ?? from;
  const monthStartBase = new Date();
  const monthStart = new Date(monthStartBase.getFullYear(), monthStartBase.getMonth() + monthOffset, 1);
  const monthGridStart = startOfWeek(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, i) => addDays(monthGridStart, i));
  const todayKey = dateKey(new Date());
  const color = (id: string | null, fallback: string) => subjects.find((s) => s.id === id)?.color ?? fallback;
  const name = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? "Geral";

  function itemsFor(day: Date): Item[] {
    const key = dateKey(day);
    const weekday = (day.getDay() + 6) % 7;
    const out: Item[] = [];

    for (const s of schedules.filter((x) => x.weekday === weekday)) {
      out.push({ key: `c${s.id}${key}`, time: s.start_time.slice(0, 5), label: name(s.subject_id), meta: s.room ?? "Aula", color: color(s.subject_id, "var(--primary)"), tone: "aula", subjectId: s.subject_id, scheduleId: s.id });
    }
    for (const e of exams.filter((x) => dateKey(new Date(x.exam_at)) === key)) {
      out.push({ key: `e${e.id}`, time: new Date(e.exam_at).toTimeString().slice(0, 5), label: `${e.kind === "simulado" ? "Simulado" : "Prova"} · ${name(e.subject_id)}`, meta: e.title, color: "var(--gold)", tone: "prova", subjectId: e.subject_id });
    }
    for (const t of tasks.filter((x) => x.due_at && dateKey(new Date(x.due_at)) === key && x.status !== "concluida")) {
      out.push({ key: `t${t.id}`, time: new Date(t.due_at!).toTimeString().slice(0, 5), label: t.title, meta: `Entrega · ${name(t.subject_id)}`, color: "var(--warning)", tone: "tarefa", subjectId: t.subject_id });
    }
    for (const p of plan.filter((x) => x.session_date === key)) {
      out.push({ key: `p${p.id}`, time: p.start_time?.slice(0, 5) ?? "23:59", label: p.reason ?? "Sessão de estudo", meta: `${p.duration_minutes} min · ${name(p.subject_id)}`, color: color(p.subject_id, "var(--primary)"), tone: "estudo", subjectId: p.subject_id });
    }
    for (const ev of events.filter((x) => dateKey(new Date(x.starts_at)) === key)) {
      out.push({ key: `v${ev.id}`, time: new Date(ev.starts_at).toTimeString().slice(0, 5), label: ev.title, meta: ev.location ?? ev.source, color: "var(--muted-foreground)", tone: "evento", subjectId: ev.subject_id });
    }
    return out.sort((a, b) => a.time.localeCompare(b.time));
  }

  const upcomingExams = exams.filter((e) => new Date(e.exam_at) >= new Date()).sort((a, b) => (a.exam_at < b.exam_at ? -1 : 1));
  const upcomingTasks = tasks.filter((t) => t.status !== "concluida" && t.due_at).sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1));
  const mobileWeek = days.map((day, i) => ({ day, i, items: itemsFor(day) }));
  const focusedItems = focusedDay === null ? [] : itemsFor(days[focusedDay] ?? days[0]!);
  const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId) ?? null;
  const selectedSubjectSchedules = schedules.filter((schedule) => schedule.subject_id === selectedSubjectId).sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  const selectedScheduleIndex = selectedScheduleId ? selectedSubjectSchedules.findIndex((schedule) => schedule.id === selectedScheduleId) : -1;
  const selectedSubjectExams = upcomingExams.filter((exam) => exam.subject_id === selectedSubjectId).slice(0, 5);
  const selectedSubjectTasks = upcomingTasks.filter((task) => task.subject_id === selectedSubjectId).slice(0, 6);
  const selectedSubjectPlan = plan.filter((session) => session.subject_id === selectedSubjectId && session.status !== "concluida").sort((a, b) => `${a.session_date}T${a.start_time ?? "23:59"}`.localeCompare(`${b.session_date}T${b.start_time ?? "23:59"}`)).slice(0, 6);
  const selectedSubjectGrades = grades.filter((grade) => grade.subject_id === selectedSubjectId).sort((a, b) => (a.graded_on < b.graded_on ? 1 : -1));
  const selectedSubjectAttendance = attendance.filter((record) => record.subject_id === selectedSubjectId).sort((a, b) => (a.class_date < b.class_date ? 1 : -1));
  const latestLesson = selectedSubjectAttendance.find((record) => record.note?.trim());
  const scale = Number(profile?.grade_scale_max ?? 10);
  const avg = selectedSubjectId ? subjectAverage(grades, selectedSubjectId, scale) : null;
  const attendanceRate = selectedSubjectId ? subjectAttendance(attendance, selectedSubjectId) : null;
  const masteredTopics = topics.filter((topic) => topic.status === "dominado").length;
  const averageMastery = topics.length ? Math.round(topics.reduce((sum, topic) => sum + Number(topic.mastery || 0), 0) / topics.length) : 0;
  const nextOccurrences = selectedSubjectSchedules.flatMap((schedule) => {
    const today = new Date();
    const currentWeekday = (today.getDay() + 6) % 7;
    let delta = (schedule.weekday - currentWeekday + 7) % 7;
    const parsedTime = parseTimeOfDay(schedule.start_time);
    if (
      !parsedTime ||
      !Number.isInteger(parsedTime.hour) ||
      !Number.isInteger(parsedTime.minute) ||
      parsedTime.hour < 0 ||
      parsedTime.hour > 23 ||
      parsedTime.minute < 0 ||
      parsedTime.minute > 59
    ) return [];
    const { hour, minute } = parsedTime;
    let occurrence = addDays(today, delta);
    occurrence.setHours(hour, minute, 0, 0);
    if (occurrence.getTime() <= Date.now()) {
      delta += 7;
      occurrence = addDays(today, delta);
      occurrence.setHours(hour, minute, 0, 0);
    }
    return [{ schedule, occurrence }];
  }).sort((a, b) => a.occurrence.getTime() - b.occurrence.getTime()).slice(0, 6);

  function openDay(index: number) {
    setSelectedDay(index);
    setSelectedSubjectId(null);
    setSelectedScheduleId(null);
    setFocusedDay(index);
  }
  function openSubject(subjectId: string | null, scheduleId?: string) {
    if (!subjectId) {
      setSelectedSubjectId(null);
      setSelectedScheduleId(null);
      setFocusedDay(focusedDay ?? selectedDay);
      return;
    }
    setSelectedSubjectId(subjectId);
    setSelectedScheduleId(scheduleId ?? null);
    setFocusedDay(null);
    setSubjectSection("resumo");
  }
  function openItem(item: Item, dayIndex: number) {
    setSelectedDay(dayIndex);
    if (item.subjectId) openSubject(item.subjectId, item.scheduleId);
    else openDay(dayIndex);
  }
  function openMonthItem(item: Item, day: Date) {
    const dayIndex = (day.getDay() + 6) % 7;
    const baseWeek = startOfWeek(new Date());
    const weekOffset = Math.round((day.getTime() - baseWeek.getTime()) / (7 * 86400000));
    setOffset(weekOffset);
    setSelectedDay(dayIndex);
    setActive("Dia");
    if (item.subjectId) {
      openSubject(item.subjectId, item.scheduleId);
    } else {
      setFocusedDay(dayIndex);
    }
  }

  function openAgendaDate(value: string | null) {
    if (!value) return;
    const target = new Date(value);
    if (Number.isNaN(target.getTime())) return;
    const baseWeek = startOfWeek(new Date());
    const targetWeek = startOfWeek(target);
    const dayIndex = (target.getDay() + 6) % 7;
    const weekOffset = Math.round((targetWeek.getTime() - baseWeek.getTime()) / (7 * 86400000));
    setOffset(weekOffset);
    setSelectedDay(dayIndex);
    setActive("Dia");
    setSelectedSubjectId(null);
    setSelectedScheduleId(null);
    setFocusedDay(dayIndex);
  }
  function backToWeek() {
    setSelectedSubjectId(null);
    setSelectedScheduleId(null);
    setFocusedDay(null);
  }
  function backToDay() {
    setSelectedSubjectId(null);
    setSelectedScheduleId(null);
    setFocusedDay(selectedDay);
  }
  function resetToToday() {
    const today = new Date();
    const index = (today.getDay() + 6) % 7;
    setOffset(0);
    setSelectedDay(index);
    setMonthOffset(0);
    setSelectedSubjectId(null);
    setSelectedScheduleId(null);
    setFocusedDay(null);
  }
  function changeDay(delta: number) {
    let nextIndex = selectedDay + delta;
    let nextOffset = offset;
    if (nextIndex < 0) {
      nextIndex = 6;
      nextOffset -= 1;
    } else if (nextIndex > 6) {
      nextIndex = 0;
      nextOffset += 1;
    }
    setOffset(nextOffset);
    setSelectedDay(nextIndex);
    setSelectedSubjectId(null);
    setSelectedScheduleId(null);
    setFocusedDay(null);
  }
  function changeMonth(delta: number) {
    setMonthOffset((value) => value + delta);
    setSelectedSubjectId(null);
    setSelectedScheduleId(null);
    setFocusedDay(null);
  }
  function changeWeek(nextOffset: number) {
    setOffset(nextOffset);
    setFocusedDay(null);
    setSelectedSubjectId(null);
    setSelectedScheduleId(null);
  }

  const detailTabs: { key: SubjectSection; label: string }[] = [
    { key: "resumo", label: "Resumo" },
    { key: "horarios", label: "Horários" },
    { key: "academico", label: "Acadêmico" },
    { key: "desempenho", label: "Desempenho" },
  ];

  return (
    <Shell contextTitle="Calendário" groups={groups} active={active} onSelect={setActive} breadcrumb={["Calendário", selectedSubject ? selectedSubject.name : active]}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle
          title={selectedSubject ? selectedSubject.name : "Calendário"}
          subtitle={selectedSubject ? (selectedSubject.teacher ? `${selectedSubject.short_name ?? "Disciplina"} · ${selectedSubject.teacher}` : selectedSubject.short_name ?? "Detalhes da disciplina") : active === "Dia" ? selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }) : active === "Mês" ? monthStart.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : `${from.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${addDays(from, 6).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`}
        />
        {!selectedSubject ? (
          <div className="flex flex-wrap gap-2">
            {active === "Dia" ? (
              <>
                <Button variant="ghost" onClick={() => changeDay(-1)}>Dia anterior</Button>
                <Button variant="ghost" onClick={resetToToday}>Hoje</Button>
                <Button variant="ghost" onClick={() => changeDay(1)}>Próximo dia</Button>
              </>
            ) : active === "Mês" ? (
              <>
                <Button variant="ghost" onClick={() => changeMonth(-1)}>Mês anterior</Button>
                <Button variant="ghost" onClick={resetToToday}>Hoje</Button>
                <Button variant="ghost" onClick={() => changeMonth(1)}>Próximo mês</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => changeWeek(offset - 1)}>Semana anterior</Button>
                <Button variant="ghost" onClick={resetToToday}>Hoje</Button>
                <Button variant="ghost" onClick={() => changeWeek(offset + 1)}>Próxima semana</Button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {selectedSubject ? (
        <Panel className="mt-4 overflow-hidden ordys-motion-slide">
          <div className="border-b border-border bg-background/30 px-3 py-3 md:hidden">
            <div className="flex items-center gap-2">
              <button type="button" onClick={focusedDay !== null ? backToDay : backToWeek} className="ordys-pressable grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-lg leading-none hover:bg-secondary sm:size-9" aria-label="Voltar">←</button>
              <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold">{selectedSubject.name}</p><p className="truncate text-[9.5px] text-muted-foreground">Ficha completa da disciplina</p></div>
              <span className="size-3 shrink-0 rounded-full" style={{ background: selectedSubject.color }} aria-hidden="true" />
            </div>
            <div className="mt-3 flex gap-1 overflow-x-auto">
              {detailTabs.map((tab) => <button key={tab.key} type="button" onClick={() => setSubjectSection(tab.key)} className={`ordys-pressable min-h-11 shrink-0 rounded-full px-3 py-2 text-[10px] font-medium ${subjectSection === tab.key ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:bg-secondary"}`} aria-current={subjectSection === tab.key ? "page" : undefined}>{tab.label}</button>)}
            </div>
          </div>

          <div className="grid min-h-[520px] md:grid-cols-[168px_minmax(0,1fr)]">
            <aside className="hidden border-r border-border bg-background/25 p-3 md:flex md:flex-col">
              <button type="button" onClick={focusedDay !== null ? backToDay : backToWeek} className="ordys-pressable mb-5 flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-muted-foreground hover:bg-surface hover:text-foreground">← Voltar</button>
              <div className="px-2 pb-2"><div className="mb-2 size-3 rounded-full" style={{ background: selectedSubject.color }} aria-hidden="true" /><p className="break-words text-[12px] font-semibold leading-snug">{selectedSubject.name}</p><p className="mt-1 text-[9px] text-muted-foreground">Disciplina</p></div>
              <div className="mt-4 space-y-1">
                {detailTabs.map((tab) => <button key={tab.key} type="button" onClick={() => setSubjectSection(tab.key)} className={`ordys-pressable min-h-11 w-full rounded-lg px-2.5 py-2 text-left text-[10.5px] font-medium ${subjectSection === tab.key ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground"}`} aria-current={subjectSection === tab.key ? "page" : undefined}>{tab.label}</button>)}
              </div>
            </aside>

            <div className="min-w-0 bg-surface">
              <div className="border-b border-border px-4 py-4 md:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold tracking-tight">{selectedSubject.name}</h2>{selectedSubject.term ? <Chip tone="muted">{selectedSubject.term}</Chip> : null}{selectedScheduleIndex >= 0 ? <Chip tone="primary">Aula {selectedScheduleIndex + 1} de {selectedSubjectSchedules.length}</Chip> : null}</div><p className="mt-1 text-[11px] text-muted-foreground">{selectedSubject.teacher ?? "Professor não cadastrado"}{selectedSubject.room ? ` · Sala ${selectedSubject.room}` : ""}</p></div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Aulas/semana" value={String(selectedSubjectSchedules.length)} sub="horários" accent="primary" /><Stat label="Carga" value={selectedSubject.weekly_hours ? `${selectedSubject.weekly_hours}h` : "—"} sub="semanal" /><Stat label="Média" value={avg === null ? "—" : avg.toFixed(1)} sub="notas" accent="gold" /><Stat label="Frequência" value={attendanceRate === null ? "—" : `${attendanceRate.toFixed(0)}%`} sub="presença" accent="success" /></div>
                </div>
              </div>

              <div className="space-y-4 p-4 md:p-6">
                {subjectSection === "resumo" ? (
                  <>
                    <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
                      <div className="rounded-xl border border-border bg-background/25 p-4"><p className="text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">Resumo da última aula</p><p className="mt-2 text-[12px] font-medium">{latestLesson ? `Aula de ${new Date(`${latestLesson.class_date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}` : "Nenhum resumo registrado"}</p><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{latestLesson?.note?.trim() ?? "Ainda não há uma anotação de aula registrada para esta disciplina. Quando houver, ela aparecerá aqui automaticamente."}</p></div>
                      <div className="rounded-xl border border-border bg-background/25 p-4"><p className="text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">Situação acadêmica</p><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-lg bg-surface p-3"><p className="text-[9px] text-muted-foreground">Conteúdos</p><p className="mt-1 text-lg font-semibold">{topics.length}</p></div><div className="rounded-lg bg-surface p-3"><p className="text-[9px] text-muted-foreground">Dominados</p><p className="mt-1 text-lg font-semibold">{masteredTopics}</p></div><div className="rounded-lg bg-surface p-3"><p className="text-[9px] text-muted-foreground">Domínio</p><p className="mt-1 text-lg font-semibold">{topics.length ? `${averageMastery}%` : "—"}</p></div></div></div>
                    </div>
                    <div className="rounded-xl border border-border bg-background/25"><div className="border-b border-border px-4 py-3"><p className="text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">Próximas aulas</p><p className="mt-0.5 text-[12px] font-medium">Próximos encontros programados</p></div><div className="divide-y divide-border">{nextOccurrences.length ? nextOccurrences.map(({ schedule, occurrence }, index) => <button type="button" key={`${schedule.id}-${dateKey(occurrence)}`} onClick={() => { setSelectedScheduleId(schedule.id); setSubjectSection("horarios"); }} className={`ordys-pressable flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left hover:bg-surface ${schedule.id === selectedScheduleId ? "bg-primary/8" : ""}`}><div className="w-11 shrink-0 text-center"><p className="text-[9px] text-muted-foreground">{weekdayShort[schedule.weekday]}</p><p className="num mt-0.5 text-[12px] font-semibold">{occurrence.getDate()}</p></div><div className="h-9 w-[3px] rounded-full" style={{ background: selectedSubject.color }} /><div className="min-w-0 flex-1"><p className="truncate text-[11.5px] font-semibold">{index === 0 ? "Próxima aula" : "Aula seguinte"}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{schedule.start_time.slice(0, 5)} – {schedule.end_time.slice(0, 5)}{schedule.room ? ` · Sala ${schedule.room}` : ""}</p></div></button>) : <p className="px-4 py-5 text-[11px] text-muted-foreground">Nenhum horário futuro cadastrado.</p>}</div></div>
                    <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-border bg-background/25"><div className="border-b border-border px-4 py-3"><p className="text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">Próximas avaliações</p></div><div className="divide-y divide-border">{selectedSubjectExams.length ? selectedSubjectExams.map((exam) => <div key={exam.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3"><Dot color="var(--gold)" /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{exam.title}</p><p className="truncate text-[9.5px] text-muted-foreground">{formatDateTime(exam.exam_at)}</p></div><Chip className="shrink-0" tone="gold">{exam.kind === "simulado" ? "Simulado" : "Prova"}</Chip></div>) : <p className="px-4 py-5 text-[11px] text-muted-foreground">Nenhuma avaliação futura.</p>}</div></div><div className="rounded-xl border border-border bg-background/25"><div className="border-b border-border px-4 py-3"><p className="text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">Prazos da disciplina</p></div><div className="divide-y divide-border">{selectedSubjectTasks.length ? selectedSubjectTasks.map((task) => <div key={task.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3"><Dot color="var(--warning)" /><p className="min-w-0 flex-1 truncate text-[11px] font-medium">{task.title}</p><span className="num shrink-0 text-[9.5px] text-muted-foreground">{formatDateTime(task.due_at)}</span></div>) : <p className="px-4 py-5 text-[11px] text-muted-foreground">Nenhum prazo aberto.</p>}</div></div></div>
                  </>
                ) : null}

                {subjectSection === "horarios" ? <><div className="rounded-xl border border-border bg-background/25"><PanelHeader title="Horários da disciplina" hint={`${selectedSubjectSchedules.length} horários cadastrados`} /><div className="divide-y divide-border">{selectedSubjectSchedules.length ? selectedSubjectSchedules.map((schedule, index) => <button type="button" key={schedule.id} onClick={() => setSelectedScheduleId(schedule.id)} className={`ordys-pressable flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-surface ${selectedScheduleId === schedule.id ? "bg-primary/8" : ""}`}><span className="num shrink-0 text-[11px] font-semibold sm:min-w-[68px]">{weekdayLong[schedule.weekday]}</span><span className="num shrink-0 text-[11px] sm:min-w-[92px]">{schedule.start_time.slice(0, 5)} – {schedule.end_time.slice(0, 5)}</span><div className="min-w-0 flex-1"><p className="text-[11px] font-medium">Aula {index + 1} de {selectedSubjectSchedules.length}</p><p className="text-[9.5px] text-muted-foreground">{schedule.room ? `Sala ${schedule.room}` : "Sala não informada"}</p></div>{selectedScheduleId === schedule.id ? <Chip tone="primary">Selecionada</Chip> : null}</button>) : <p className="px-4 py-6 text-[11px] text-muted-foreground">Nenhum horário cadastrado.</p>}</div></div><div className="rounded-xl border border-border bg-background/25 p-4"><p className="text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">Próximas ocorrências</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{nextOccurrences.map(({ schedule, occurrence }) => <div key={`${schedule.id}-${dateKey(occurrence)}`} className="rounded-lg border border-border bg-surface p-3"><p className="text-[10px] font-medium">{weekdayLong[schedule.weekday]}</p><p className="num mt-1 text-[13px] font-semibold">{occurrence.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</p><p className="num mt-1 text-[10px] text-muted-foreground">{schedule.start_time.slice(0, 5)} – {schedule.end_time.slice(0, 5)}</p></div>)}</div></div></> : null}

                {subjectSection === "academico" ? <><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-border bg-background/25"><PanelHeader title="Conteúdos e domínio" hint={`${topics.length} tópicos`} /><div className="divide-y divide-border">{topics.length ? topics.map((topic) => <div key={topic.id} className="px-4 py-3"><div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-[11px] font-medium">{topic.title}</p><span className="num text-[9.5px] text-muted-foreground">{topic.mastery}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, Number(topic.mastery || 0)))}%` }} /></div><p className="mt-1 text-[9px] text-muted-foreground">{topicStatusLabel(topic.status)}</p></div>) : <p className="px-4 py-6 text-[11px] text-muted-foreground">Nenhum conteúdo cadastrado.</p>}</div></div><div className="rounded-xl border border-border bg-background/25"><PanelHeader title="Plano de estudos" hint={`${selectedSubjectPlan.length} próximas sessões`} /><div className="divide-y divide-border">{selectedSubjectPlan.length ? selectedSubjectPlan.map((session) => <div key={session.id} className="flex items-center gap-3 px-4 py-3"><Dot color="var(--primary)" /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{session.reason ?? "Sessão de estudo"}</p><p className="text-[9.5px] text-muted-foreground">{formatDay(`${session.session_date}T12:00:00`)}{session.start_time ? ` · ${session.start_time.slice(0, 5)}` : ""}</p></div><Chip tone="muted">{session.duration_minutes} min</Chip></div>) : <p className="px-4 py-6 text-[11px] text-muted-foreground">Nenhuma sessão planejada.</p>}</div></div></div></> : null}

                {subjectSection === "desempenho" ? <><div className="grid gap-4 sm:grid-cols-3"><Stat label="Média da disciplina" value={avg === null ? "—" : avg.toFixed(2)} sub={`${selectedSubjectGrades.length} notas`} accent="gold" /><Stat label="Frequência" value={attendanceRate === null ? "—" : `${attendanceRate.toFixed(1)}%`} sub={`${selectedSubjectAttendance.length} registros`} accent="success" /><Stat label="Meta de média" value={selectedSubject.grade_goal ? Number(selectedSubject.grade_goal).toFixed(1) : "—"} sub="objetivo" accent="primary" /></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-border bg-background/25"><PanelHeader title="Notas" hint="resultados registrados" /><div className="divide-y divide-border">{selectedSubjectGrades.length ? selectedSubjectGrades.slice(0, 8).map((grade) => <div key={grade.id} className="flex items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{grade.title}</p><p className="text-[9.5px] text-muted-foreground">{new Date(`${grade.graded_on}T12:00:00`).toLocaleDateString("pt-BR")}</p></div><span className="num text-[12px] font-semibold">{Number(grade.score).toFixed(1)} / {Number(grade.max_score).toFixed(1)}</span></div>) : <p className="px-4 py-6 text-[11px] text-muted-foreground">Nenhuma nota registrada.</p>}</div></div><div className="rounded-xl border border-border bg-background/25"><PanelHeader title="Frequência" hint="últimos registros" /><div className="divide-y divide-border">{selectedSubjectAttendance.length ? selectedSubjectAttendance.slice(0, 8).map((record) => <div key={record.id} className="flex items-center gap-3 px-4 py-3"><Dot color={record.status === "presente" || record.status === "justificada" ? "var(--success)" : "var(--destructive)"} /><p className="min-w-0 flex-1 text-[11px]">{new Date(`${record.class_date}T12:00:00`).toLocaleDateString("pt-BR")}</p><span className="text-[10px] text-muted-foreground">{attendanceStatusLabel(record.status)}</span></div>) : <p className="px-4 py-6 text-[11px] text-muted-foreground">Nenhum registro de frequência.</p>}</div></div></div></> : null}
              </div>
            </div>
          </div>
        </Panel>
      ) : (
        <>
          {active === "Dia" ? <Panel className="mt-4 overflow-hidden">
            <PanelHeader title={selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} hint={selectedDate.toLocaleDateString("pt-BR", { year: "numeric" })} />
            <div className="border-t border-border bg-background/20 p-4">
              {itemsFor(selectedDate).length ? (
                <div className="space-y-2">
                  {itemsFor(selectedDate).map((it) => (
                    <button key={it.key} type="button" onClick={() => openItem(it, selectedDay)} className="ordys-pressable flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left hover:border-primary/30">
                      <div className="min-w-[50px] text-center">
                        <span className="num text-[11px] font-semibold">{it.time}</span>
                        <span className="mt-0.5 block text-[8.5px] text-muted-foreground">{it.tone === "aula" ? "Aula" : it.tone === "prova" ? "Prova" : it.tone === "estudo" ? "Estudo" : it.tone === "tarefa" ? "Prazo" : "Evento"}</span>
                      </div>
                      <span className="h-10 w-[3px] shrink-0 rounded-full" style={{ background: it.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-semibold">{it.label}</p>
                        <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{it.meta}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
                  <p className="text-[12px] font-medium">Dia livre</p>
                  <p className="mt-1 text-[10.5px] text-muted-foreground">Nenhuma atividade está programada para esta data.</p>
                </div>
              )}
            </div>
          </Panel> : null}
          {active === "Mês" ? <Panel className="mt-4 overflow-hidden">
            <PanelHeader title={monthStart.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} hint="Visão mensal" />
            <div className="hidden border-t border-border bg-border p-px lg:block">
              <div className="grid grid-cols-7 gap-px">
                {weekdayShort.map((day) => <div key={day} className="bg-background px-2 py-2 text-center text-[9px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{day}</div>)}
                {monthDays.map((day) => {
                  const key = dateKey(day);
                  const items = itemsFor(day);
                  const inMonth = day.getMonth() === monthStart.getMonth() && day.getFullYear() === monthStart.getFullYear();
                  const isToday = key === todayKey;
                  return (
                    <div key={key} className={`min-h-[108px] min-w-0 bg-surface p-2 text-left ${inMonth ? "" : "opacity-45"}`}>
                      <div className="flex items-center justify-between gap-1">
                        <button type="button" onClick={() => { setOffset(Math.round((day.getTime() - startOfWeek(new Date()).getTime()) / (7 * 86400000))); setSelectedDay((day.getDay() + 6) % 7); setActive("Dia"); setFocusedDay(null); }} className={`num grid size-7 place-items-center rounded-full text-[10px] font-semibold hover:bg-secondary ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                          {day.getDate()}
                        </button>
                        {items.length ? <span className="text-[8px] text-muted-foreground">{items.length}</span> : null}
                      </div>
                      <div className="mt-1.5 space-y-1">
                        {items.slice(0, 3).map((it) => (
                          <button key={it.key} type="button" onClick={() => openMonthItem(it, day)} className="ordys-pressable flex w-full min-h-10 items-center gap-1.5 rounded-md border border-border/80 bg-background/45 px-1.5 py-1 text-left hover:border-primary/25">
                            <span className="h-3 w-[2px] shrink-0 rounded-full" style={{ background: it.color }} />
                            <span className="min-w-0 truncate text-[8.5px] text-muted-foreground">{it.label}</span>
                          </button>
                        ))}
                        {items.length > 3 ? <p className="px-1 text-[8px] text-muted-foreground">+{items.length - 3} atividades</p> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="border-t border-border lg:hidden">
              {monthDays.filter((day) => day.getMonth() === monthStart.getMonth() && day.getFullYear() === monthStart.getFullYear()).map((day) => {
                const key = dateKey(day);
                const items = itemsFor(day);
                const isToday = key === todayKey;
                return (
                  <div key={key} className="flex min-w-0 items-start gap-3 border-b border-border bg-surface px-4 py-3.5 last:border-b-0">
                    <button type="button" onClick={() => { setOffset(Math.round((day.getTime() - startOfWeek(new Date()).getTime()) / (7 * 86400000))); setSelectedDay((day.getDay() + 6) % 7); setActive("Dia"); setFocusedDay(null); }} className={`num grid size-11 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${isToday ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}`}>
                      {day.getDate()}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{weekdayLong[day.getDay() === 0 ? 6 : day.getDay() - 1]}</p>
                          <p className="mt-0.5 truncate text-[12px] font-medium">{day.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}</p>
                        </div>
                        {items.length ? <span className="num shrink-0 text-[10px] text-muted-foreground">{items.length}</span> : null}
                      </div>
                      {items.length ? (
                        <div className="mt-2 space-y-1.5">
                          {items.slice(0, 4).map((it) => (
                            <button key={it.key} type="button" onClick={() => openMonthItem(it, day)} className="ordys-pressable flex w-full min-h-11 min-w-0 items-center gap-2 rounded-lg border border-border bg-background/45 px-2.5 py-2 text-left hover:border-primary/25">
                              <span className="h-5 w-[3px] shrink-0 rounded-full" style={{ background: it.color }} />
                              <span className="num shrink-0 text-[9.5px] text-muted-foreground">{it.time}</span>
                              <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium">{it.label}</span>
                            </button>
                          ))}
                          {items.length > 4 ? <p className="px-1 text-[9.5px] text-muted-foreground">+{items.length - 4} atividades</p> : null}
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[10px] text-muted-foreground">Dia livre</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel> : null}
          {active === "Semana" ? <Panel className="mt-4 overflow-hidden"><PanelHeader title="Semana acadêmica" hint="toque em um dia ou atividade para abrir a disciplina e seus detalhes" /><div className="hidden grid-cols-7 gap-px border-t border-border bg-border lg:grid">{days.map((day, i) => { const key = dateKey(day); const items = itemsFor(day); const isSelected = selectedDay === i; return <div key={key} className={`min-w-0 min-h-[320px] bg-surface px-3 py-3 text-left transition-colors ${isSelected ? "bg-secondary/20" : ""}`}><button type="button" onClick={() => openDay(i)} className="ordys-pressable flex w-full items-center gap-2 border-b border-border/70 pb-2 text-left" aria-pressed={isSelected}><span className="text-[10.5px] tracking-[0.1em] text-muted-foreground uppercase">{weekdayShort[i]}</span><span className={`num ml-auto grid size-7 place-items-center rounded-full text-[11px] ${key === todayKey ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{day.getDate()}</span></button><div className="mt-2 space-y-1.5">{items.slice(0, 6).map((it) => <button key={it.key} type="button" onClick={() => openItem(it, i)} className="ordys-pressable w-full rounded-lg border border-border bg-background/45 px-2 py-2 text-left hover:border-primary/30 hover:bg-background/65"><div className="flex items-center gap-1.5"><span className="h-4 w-[2px] shrink-0 rounded-full" style={{ background: it.color }} /><span className="num text-[10px] text-muted-foreground">{it.time}</span></div><p className="mt-1 truncate text-[11px] font-medium">{it.label}</p><p className="truncate text-[9.5px] text-muted-foreground">{it.meta}</p></button>)}{!items.length ? <p className="py-2 text-[10.5px] text-muted-foreground">Livre</p> : null}{items.length > 6 ? <p className="px-1 pt-0.5 text-[10px] text-muted-foreground">+{items.length - 6} atividades</p> : null}</div></div>; })}</div><div className="border-t border-border lg:hidden">{focusedDay === null ? <div className="ordys-motion-enter"><div className="grid gap-1.5 p-2.5">
              {mobileWeek.map(({ day, i, items }) => (
                <div key={dateKey(day)} className={`rounded-xl border border-border bg-surface px-3 py-2.5 ${selectedDay === i ? "border-primary/40 bg-secondary/15" : ""}`}>
                  <button type="button" onClick={() => openDay(i)} className="ordys-pressable flex w-full items-center gap-3 text-left">
                    <span className={`num grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${dateKey(day) === todayKey ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>{day.getDate()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold">{weekdayLong[i]}</span>
                      <span className="block text-[9.5px] text-muted-foreground">{items.length === 1 ? "1 atividade" : `${items.length} atividades`}</span>
                    </span>
                    <span aria-hidden="true" className="text-muted-foreground">›</span>
                  </button>
                  {items.length ? (
                    <div className="mt-2 space-y-1">
                      {items.slice(0, 3).map((it) => (
                        <button key={it.key} type="button" onClick={() => openItem(it, i)} className="ordys-pressable flex w-full items-center gap-2 rounded-lg border border-border/70 bg-background/45 px-2.5 py-2 text-left">
                          <span className="h-4 w-[2px] shrink-0 rounded-full" style={{ background: it.color }} />
                          <span className="num w-11 shrink-0 text-[9px] text-muted-foreground">{it.time}</span>
                          <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{it.label}</span>
                        </button>
                      ))}
                      {items.length > 3 ? <p className="px-1 pt-0.5 text-[9.5px] text-muted-foreground">+{items.length - 3} atividades</p> : null}
                    </div>
                  ) : (
                    <p className="mt-2 px-1 text-[10px] text-muted-foreground">Nenhuma atividade programada.</p>
                  )}
                </div>
              ))}
            </div><div className="border-t border-border bg-background/25 px-4 py-3 text-center"><p className="text-[10.5px] text-muted-foreground">Toque em uma disciplina para abrir sua ficha completa; toque no cabeçalho de um dia para ver a sequência do dia.</p></div></div> : <div className="ordys-motion-slide"><div className="flex items-center gap-3 border-b border-border bg-background/30 px-4 py-3"><button type="button" onClick={backToWeek} className="ordys-pressable grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-lg leading-none hover:bg-secondary sm:size-9" aria-label="Voltar para a semana">←</button><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">{weekdayLong[focusedDay]}</p><p className="text-[9.5px] text-muted-foreground">{days[focusedDay]?.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}</p></div>{days[focusedDay] && dateKey(days[focusedDay]) === todayKey ? <Chip tone="primary">Hoje</Chip> : null}</div><div className="border-b border-border bg-surface px-4 py-2.5"><p className="text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">Próximas atividades</p><p className="mt-0.5 text-[12px] font-medium">{focusedItems.length === 1 ? "1 atividade programada" : `${focusedItems.length} atividades programadas`}</p></div><div className="space-y-2.5 bg-background/20 p-4">{focusedItems.length ? focusedItems.map((it, index) => <button key={it.key} type="button" onClick={() => openItem(it, focusedDay)} className="ordys-pressable ordys-motion-scale w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-left shadow-sm" style={{ animationDelay: `${Math.min(index, 7) * 35}ms` }}><div className="flex items-start gap-3"><div className="min-w-[44px] pt-0.5 text-center"><span className="num text-[11px] font-semibold">{it.time}</span><span className="mt-1 block text-[8.5px] text-muted-foreground">{it.tone === "aula" ? "Aula" : it.tone === "prova" ? "Prova" : it.tone === "estudo" ? "Estudo" : it.tone === "tarefa" ? "Prazo" : "Evento"}</span></div><span className="mt-1 h-9 w-[3px] shrink-0 rounded-full" style={{ background: it.color }} /><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold leading-snug">{it.label}</p><p className="mt-1 text-[10.5px] text-muted-foreground">{it.meta}</p></div></div></button>) : <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center"><p className="text-[12px] font-medium">Dia livre</p><p className="mt-1 text-[10.5px] text-muted-foreground">Nenhuma atividade está programada para este dia.</p></div>}</div></div>}</div></Panel> : null}
          {active === "Provas" ? <Panel className="mt-4"><PanelHeader title="Provas e simulados" hint={`${upcomingExams.length} futuras`} /><div className="border-t border-border">{upcomingExams.length ? upcomingExams.map((e) => <button key={e.id} type="button" onClick={() => e.subject_id ? openSubject(e.subject_id) : openAgendaDate(e.exam_at)} className="ordys-pressable flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 text-left hover:bg-surface"><Dot color={color(e.subject_id, "var(--gold)")} /><div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-medium">{name(e.subject_id)} — {e.title}</p><p className="truncate text-[11px] text-muted-foreground">{e.content ?? e.kind}</p></div>{e.weight ? <Chip tone="gold">{e.weight}</Chip> : null}<span className="num shrink-0 text-[11px] text-muted-foreground">{formatDateTime(e.exam_at)}</span></button>) : <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhuma avaliação futura.</p>}</div></Panel> : null}
          {active === "Prazos" ? <Panel className="mt-4"><PanelHeader title="Prazos de entrega" hint={`${upcomingTasks.length} tarefas`} /><div className="border-t border-border">{upcomingTasks.length ? upcomingTasks.map((t) => <button key={t.id} type="button" onClick={() => t.subject_id ? openSubject(t.subject_id) : openAgendaDate(t.due_at)} className="ordys-pressable flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 text-left hover:bg-surface"><Dot color={color(t.subject_id, "var(--warning)")} /><p className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</p><Chip className="shrink-0" tone={t.priority === "alta" ? "danger" : "muted"}>{priorityLabel(t.priority)}</Chip><span className="num shrink-0 text-[11px] text-muted-foreground">{formatDateTime(t.due_at)}</span></button>) : <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhum prazo aberto.</p>}</div></Panel> : null}
          {active === "Eventos" ? <Panel className="mt-4"><PanelHeader title="Eventos" hint="importados ou criados manualmente" /><div className="border-t border-border">{events.length ? events.map((e) => <button key={e.id} type="button" onClick={() => e.subject_id ? openSubject(e.subject_id) : openAgendaDate(e.starts_at)} className="ordys-pressable flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-surface"><Dot color={color(e.subject_id, "var(--muted-foreground)")} /><div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-medium">{e.title}</p><p className="truncate text-[11px] text-muted-foreground">{e.location ?? e.source}</p></div><span className="num shrink-0 text-[11px] text-muted-foreground">{formatDateTime(e.starts_at)}</span></button>) : <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhum evento encontrado.</p>}</div></Panel> : null}
        </>
      )}
    </Shell>
  );
}
