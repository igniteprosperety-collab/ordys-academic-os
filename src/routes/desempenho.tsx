import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, PageTitle, Ring, Stat } from "@/components/ordys/primitives";
import { Button, ConfirmDialog, Field, Modal, Select, TextInput } from "@/components/ordys/form";
import {
  fmtNumber,
  minutesLabel,
  subjectAttendance,
  subjectAverage,
  useAttendance,
  useCheckins,
  useFocusSessions,
  useGoals,
  useGrades,
  useOrdysMutations,
  usePlanSessions,
  useProfile,
  useSubjects,
  useTasks,
} from "@/lib/ordys-db";
import { addDays, dateKey, goalMetricLabel, goalPeriodLabel, startOfWeek, summarize } from "@/lib/ordys-engine";

export const Route = createFileRoute("/desempenho")({
  head: () => ({
    meta: [
      { title: "Desempenho — Ordys Academy" },
      {
        name: "description",
        content:
          "Evolução de médias, horas estudadas, frequência, metas e resumos diários, semanais e mensais da sua vida acadêmica.",
      },
      { property: "og:title", content: "Desempenho — Ordys Academy" },
      {
        property: "og:description",
        content: "Métricas reais de evolução: notas, estudo, frequência e cumprimento do plano.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Desempenho,
});

const groups = [{ items: ["Visão geral", "Evolução", "Metas", "Resumos"] }];

type GoalPeriod = "diario" | "semanal" | "mensal" | "bimestral" | "semestral";

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function goalRange(period: string, now: Date) {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (period as GoalPeriod) {
    case "diario": {
      const from = startOfDay(now);
      return { from, to: addDays(from, 1) };
    }
    case "semanal": {
      const from = startOfWeek(now);
      return { from, to: addDays(from, 7) };
    }
    case "mensal": {
      const from = new Date(year, month, 1);
      return { from, to: new Date(year, month + 1, 1) };
    }
    case "bimestral": {
      const firstMonth = Math.floor(month / 2) * 2;
      const from = new Date(year, firstMonth, 1);
      return { from, to: new Date(year, firstMonth + 2, 1) };
    }
    case "semestral": {
      const firstMonth = month < 6 ? 0 : 6;
      const from = new Date(year, firstMonth, 1);
      return { from, to: new Date(year, firstMonth + 6, 1) };
    }
    default: {
      const from = startOfWeek(now);
      return { from, to: addDays(from, 7) };
    }
  }
}

function timestampInRange(value: string | null, range: { from: Date; to: Date }) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= range.from && date < range.to;
}

function dateOnlyInRange(value: string | null, range: { from: Date; to: Date }) {
  if (!value) return false;
  const date = new Date(value + "T00:00:00");
  return !Number.isNaN(date.getTime()) && date >= range.from && date < range.to;
}

function Desempenho() {
  const [active, setActive] = useState("Visão geral");
  const { data: profile } = useProfile();
  const { data: subjects = [] } = useSubjects();
  const { data: grades = [] } = useGrades();
  const { data: attendance = [] } = useAttendance();
  const { data: focus = [] } = useFocusSessions();
  const { data: tasks = [] } = useTasks();
  const { data: plan = [] } = usePlanSessions();
  const { data: goals = [] } = useGoals();
  const [goalToDelete, setGoalToDelete] = useState<(typeof goals)[number] | null>(null);
  const [deleteGoalBusy, setDeleteGoalBusy] = useState(false);
  const { data: checkins = [] } = useCheckins();
  const { insert, update, remove } = useOrdysMutations();
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ title: "", metric: "horas_estudo", target: "", period: "semanal", subject_id: "" });

  const scale = Number(profile?.grade_scale_max ?? 10);
  const now = new Date();
  const averages = subjects
    .map((s) => ({ subject: s, avg: subjectAverage(grades, s.id, scale), att: subjectAttendance(attendance, s.id) }))
    .filter((x) => x.avg !== null || x.att !== null);
  const overall = averages.filter((a) => a.avg !== null).length
    ? averages.filter((a) => a.avg !== null).reduce((acc, a) => acc + a.avg!, 0) /
      averages.filter((a) => a.avg !== null).length
    : null;

  const summaryScale = Number(profile?.grade_scale_max ?? 10);
  const day = summarize({ from: new Date(new Date().setHours(0, 0, 0, 0)), to: now }, { focus, tasks, plan, grades, attendance }, summaryScale);
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 6);
  weekEnd.setHours(23, 59, 59, 999);
  const week = summarize({ from: weekStart, to: weekEnd }, { focus, tasks, plan, grades, attendance }, summaryScale);
  const month = summarize(
    { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now },
    { focus, tasks, plan, grades, attendance },
    summaryScale,
  );

  const monthlyChart = (() => {
    const map = new Map<string, { weightedSum: number; weight: number; minutes: number }>();
    for (const g of grades) {
      const key = g.graded_on.slice(0, 7);
      const gradeWeight = Number(g.weight || 1);
      const score = Number(g.score);
      const maxScore = Number(g.max_score || scale);
      if (!key || !Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0 || !Number.isFinite(gradeWeight) || gradeWeight <= 0) continue;
      const normalized = (score / maxScore) * scale;
      const cur = map.get(key) ?? { weightedSum: 0, weight: 0, minutes: 0 };
      cur.weightedSum += normalized * gradeWeight;
      cur.weight += gradeWeight;
      map.set(key, cur);
    }
    for (const f of focus) {
      if (f.status !== "concluida") continue;
      const startedAt = new Date(f.started_at);
      const minutes = Number(f.actual_minutes ?? f.planned_minutes);
      if (Number.isNaN(startedAt.getTime()) || !Number.isFinite(minutes) || minutes < 0) continue;
      const key = dateKey(startedAt).slice(0, 7);
      const cur = map.get(key) ?? { weightedSum: 0, weight: 0, minutes: 0 };
      cur.minutes += minutes;
      map.set(key, cur);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        period: key.slice(5) + "/" + key.slice(2, 4),
        media: v.weight ? Number((v.weightedSum / v.weight).toFixed(2)) : null,
        horas: Number((v.minutes / 60).toFixed(1)),
      }));
  })();

  function goalProgress(goal: { metric: string; target: number | string; subject_id: string | null; period: string }) {
    const target = Number(goal.target);
    if (!Number.isFinite(target) || target <= 0) return 0;

    const range = goalRange(goal.period, now);
    const scopedFocus = focus.filter(
      (item) =>
        item.status === "concluida" &&
        timestampInRange(item.started_at, range) &&
        (!goal.subject_id || item.subject_id === goal.subject_id),
    );
    const scopedTasks = tasks.filter(
      (item) =>
        item.status === "concluida" &&
        timestampInRange(item.completed_at, range) &&
        (!goal.subject_id || item.subject_id === goal.subject_id),
    );
    const scopedGrades = grades.filter(
      (item) =>
        dateOnlyInRange(item.graded_on, range) &&
        (!goal.subject_id || item.subject_id === goal.subject_id),
    );
    const scopedAttendance = attendance.filter(
      (item) =>
        dateOnlyInRange(item.class_date, range) &&
        (!goal.subject_id || item.subject_id === goal.subject_id),
    );

    if (goal.metric === "horas_estudo") {
      const minutes = scopedFocus.reduce((sum, item) => {
        const value = Number(item.actual_minutes ?? item.planned_minutes);
        return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
      }, 0);
      return Math.min(100, (minutes / 60 / target) * 100);
    }

    if (goal.metric === "tarefas") {
      return Math.min(100, (scopedTasks.length / target) * 100);
    }

    if (goal.metric === "media") {
      let weightedSum = 0;
      let weight = 0;
      for (const grade of scopedGrades) {
        const gradeWeight = Number(grade.weight || 1);
        const score = Number(grade.score);
        const maxScore = Number(grade.max_score || scale);
        if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0 || !Number.isFinite(gradeWeight) || gradeWeight <= 0) continue;
        weightedSum += (score / maxScore) * scale * gradeWeight;
        weight += gradeWeight;
      }
      if (!weight) return 0;
      return Math.min(100, ((weightedSum / weight) / target) * 100);
    }

    if (goal.metric === "frequencia") {
      if (!scopedAttendance.length) return 0;
      const present = scopedAttendance.filter(
        (item) => item.status === "presente" || item.status === "justificada",
      ).length;
      return Math.min(100, (((present / scopedAttendance.length) * 100) / target) * 100);
    }

    return 0;
  }

  async function toggleGoal(goal: (typeof goals)[number]) {
    try {
      await update("goals", goal.id, { active: !goal.active });
      toast.success(goal.active ? "Meta pausada" : "Meta ativada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível alterar a meta.");
    }
  }

  function removeGoal(goal: (typeof goals)[number]) {
    if (deleteGoalBusy) return;
    setGoalToDelete(goal);
  }

  async function confirmRemoveGoal() {
    const target = goalToDelete;
    if (!target || deleteGoalBusy) return;
    setDeleteGoalBusy(true);
    try {
      await remove("goals", target.id);
      setGoalToDelete(null);
      toast.success("Meta excluída");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível excluir a meta.");
    } finally {
      setDeleteGoalBusy(false);
    }
  }

  async function saveGoal() {
    const title = form.title.trim();
    const target = Number(form.target);
    if (!title) {
      toast.error("Informe o título da meta.");
      return;
    }
    const metric = form.metric;
    const maxTarget = metric === "media" ? scale : metric === "frequencia" ? 100 : 100000;
    if (!Number.isFinite(target) || target <= 0 || target > maxTarget) {
      toast.error(
        metric === "media"
          ? `A meta de média deve ficar entre 0 e ${scale}.`
          : metric === "frequencia"
            ? "A meta de frequência deve ficar entre 0% e 100%."
            : "O alvo da meta deve estar entre zero e 100.000.",
      );
      return;
    }
    if (metric === "tarefas" && !Number.isInteger(target)) {
      toast.error("A meta de tarefas deve ser um número inteiro.");
      return;
    }

    try {
      await insert("goals", {
        title,
        metric: form.metric,
        target,
        period: form.period,
        subject_id: form.subject_id || null,
      });
      setForm({ title: "", metric: "horas_estudo", target: "", period: "semanal", subject_id: "" });
      setModal(false);
      toast.success("Meta criada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar meta");
    }
  }

  return (
    <Shell
      contextTitle="Desempenho"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Desempenho", active]}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title="Desempenho" subtitle="Notas, estudo, frequência e cumprimento do plano" />
        <Button onClick={() => setModal(true)}>
          <Plus className="size-[13px]" strokeWidth={2} /> Nova meta
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Média geral" value={overall === null ? "—" : fmtNumber(overall)} sub={`escala 0 – ${scale}`} accent="primary" />
        <Stat label="Estudo no mês" value={minutesLabel(month.minutes)} sub={`${month.focusCount} sessões`} accent="success" />
        <Stat
          label="Frequência"
          value={
            attendance.length
              ? `${((attendance.filter((a) => a.status === "presente" || a.status === "justificada").length / attendance.length) * 100).toFixed(0)}%`
              : "—"
          }
          sub={`meta ${Number(profile?.attendance_target ?? 75)}%`}
          accent="warning"
        />
        <Stat
          label="Plano cumprido"
          value={week.plannedCount ? `${Math.round((week.completedPlanCount / week.plannedCount) * 100)}%` : "—"}
          sub="nesta semana"
        />
      </div>

      {active === "Visão geral" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Panel>
            <PanelHeader title="Por disciplina" hint="média e frequência" />
            <div className="border-t border-border">
              {averages.length ? (
                averages.map((a) => (
                  <div key={a.subject.id} className="min-w-0 px-5 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px]">
                      <Dot color={a.subject.color} />
                      <span className="min-w-0 flex-1 basis-[9rem] truncate font-medium">{a.subject.name}</span>
                      <span className="num ml-auto font-semibold">{a.avg === null ? "—" : fmtNumber(a.avg)}</span>
                      {a.subject.grade_goal ? (
                        <Chip className="shrink-0" tone={a.avg !== null && a.avg >= Number(a.subject.grade_goal) ? "success" : "gold"}>
                          meta {fmtNumber(Number(a.subject.grade_goal))}
                        </Chip>
                      ) : null}
                    </div>
                    <div className="mt-2 flex min-w-0 items-center gap-2">
                      <Bar value={a.att ?? 0} tone={a.att !== null && a.att < 85 ? "warning" : "primary"} />
                      <span className="num text-[10.5px] text-muted-foreground">
                        {a.att === null ? "—" : `${a.att.toFixed(0)}% presença`}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="px-5 py-6 text-[12px] text-muted-foreground">
                  Registre notas e frequência nas disciplinas para ver o desempenho.
                </p>
              )}
            </div>
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader title="Hoje" />
              <div className="flex flex-wrap items-center gap-5 border-t border-border px-5 py-5">
                <Ring value={Math.min(100, (day.minutes / Math.max(1, (profile?.daily_load_limit_minutes ?? 240))) * 100)} size={72} />
                <div className="text-[12px]">
                  <p className="num text-[16px] font-semibold">{minutesLabel(day.minutes)}</p>
                  <p className="text-muted-foreground">{day.tasksDone} tarefas concluídas</p>
                  <p className="text-muted-foreground">{day.completedPlanCount}/{day.plannedCount} sessões</p>
                </div>
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Consistência" hint="últimos check-ins" />
              <div className="border-t border-border">
                {checkins.slice(0, 6).length ? (
                  checkins.slice(0, 6).map((c) => (
                    <div key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2 text-[12px]">
                      <span className="num flex-1">{c.checkin_date}</span>
                      <span className="num text-muted-foreground">{c.studied_minutes ?? 0} min</span>
                      <Chip className="shrink-0" tone={c.completed_plan === "sim" ? "success" : c.completed_plan === "nao" ? "danger" : "gold"}>
                        {c.completed_plan ?? "—"}
                      </Chip>
                    </div>
                  ))
                ) : (
                  <p className="px-5 py-6 text-[12px] text-muted-foreground">Faça o check-in diário em Estudos.</p>
                )}
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      {active === "Evolução" ? (
        <Panel className="mt-4">
          <PanelHeader title="Evolução de média e horas" hint="por mês" />
          <div className="h-[300px] border-t border-border px-4 py-4">
            {monthlyChart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyChart}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="period" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
                  <YAxis
                    yAxisId="grade"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    width={28}
                    domain={[0, "auto"]}
                  />
                  <YAxis
                    yAxisId="hours"
                    orientation="right"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    width={32}
                    domain={[0, "auto"]}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    yAxisId="grade"
                    type="monotone"
                    dataKey="media"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    name="Média"
                  />
                  <Line
                    yAxisId="hours"
                    type="monotone"
                    dataKey="horas"
                    stroke="var(--gold)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    name="Horas"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="grid h-full place-items-center text-[12px] text-muted-foreground">
                Registre notas e sessões de foco para ver sua evolução.
              </p>
            )}
          </div>
        </Panel>
      ) : null}

      {active === "Metas" ? (
        <Panel className="mt-4">
          <PanelHeader title="Metas" hint={`${goals.filter((g) => g.active).length} ativas`} />
          <div className="border-t border-border">
            {goals.length ? (
              goals.map((g) => {
                const progress = goalProgress(g);
                return (
                  <div key={g.id} className="px-5 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px]">
                      <span className="min-w-0 flex-1 basis-[10rem] break-words font-medium">{g.title}</span>
                      <Chip>{goalPeriodLabel(g.period)}</Chip>
                      <span className="num ml-auto text-muted-foreground">{progress.toFixed(0)}%</span>
                      <button type="button"
                        className="min-h-11 shrink-0 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground sm:min-h-8"
                        onClick={() => void toggleGoal(g)}
                      >
                        {g.active ? "pausar" : "ativar"}
                      </button>
                      <button type="button" className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground sm:size-8 hover:bg-secondary hover:text-destructive" onClick={() => removeGoal(g)}>
                        <Trash2 className="size-[13px]" strokeWidth={1.7} />
                      </button>
                    </div>
                    <div className="mt-2">
                      <Bar value={progress} tone={progress >= 100 ? "success" : "primary"} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Alvo {Number(g.target)} · métrica {goalMetricLabel(g.metric)}
                      {g.subject_id ? ` · ${subjects.find((s) => s.id === g.subject_id)?.name ?? ""}` : ""}
                    </p>
                  </div>
                );
              })
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">
                Crie metas de nota, horas de estudo, frequência ou entregas.
              </p>
            )}
          </div>
        </Panel>
      ) : null}

      {active === "Resumos" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {[
            { label: "Resumo diário", data: day },
            { label: "Resumo semanal", data: week },
            { label: "Resumo mensal", data: month },
          ].map(({ label, data }) => (
            <Panel key={label}>
              <PanelHeader title={label} />
              <div className="space-y-2 border-t border-border px-5 py-4 text-[12px]">
                <Row label="Tempo estudado" value={minutesLabel(data.minutes)} />
                <Row label="Sessões de foco" value={String(data.focusCount)} />
                <Row label="Tarefas concluídas" value={String(data.tasksDone)} />
                <Row label="Tarefas atrasadas" value={String(data.tasksLate)} />
                <Row
                  label="Plano cumprido"
                  value={data.plannedCount ? `${data.completedPlanCount}/${data.plannedCount}` : "—"}
                />
                <Row label="Média das notas" value={data.gradeAverage === null ? "—" : fmtNumber(data.gradeAverage)} />
                <Row
                  label="Frequência"
                  value={data.attendanceRate === null ? "—" : `${data.attendanceRate.toFixed(0)}%`}
                />
              </div>
            </Panel>
          ))}
        </div>
      ) : null}

      <Modal open={modal} onClose={() => setModal(false)} title="Nova meta">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Título" className="sm:col-span-2">
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Métrica">
            <Select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>
              <option value="horas_estudo">Horas de estudo</option>
              <option value="media">Média</option>
              <option value="frequencia">Frequência (%)</option>
              <option value="tarefas">Tarefas entregues</option>
            </Select>
          </Field>
          <Field label="Alvo">
            <TextInput value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          </Field>
          <Field label="Período">
            <Select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
              <option value="diario">Diário</option>
              <option value="semanal">Semanal</option>
              <option value="mensal">Mensal</option>
              <option value="bimestral">Bimestral</option>
              <option value="semestral">Semestral</option>
            </Select>
          </Field>
          <Field label="Disciplina (opcional)">
            <Select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
              <option value="">Todas</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setModal(false)}>
            Cancelar
          </Button>
          <Button onClick={saveGoal} disabled={!form.title.trim() || !form.target}>
            Criar meta
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={goalToDelete !== null}
        title="Excluir meta?"
        description={goalToDelete
          ? `A meta "${goalToDelete.title}" será removida permanentemente.`
          : "Esta meta será removida permanentemente."}
        confirmLabel="Excluir meta"
        confirmVariant="danger"
        loadingLabel="Excluindo…"
        onConfirm={() => void confirmRemoveGoal()}
        onClose={() => {
          if (!deleteGoalBusy) setGoalToDelete(null);
        }}
        loading={deleteGoalBusy}
      />
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-medium">{value}</span>
    </div>
  );
}
