import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, PageTitle, Ring, Stat } from "@/components/ordys/primitives";
import { Button, Field, Modal, Select, TextInput } from "@/components/ordys/form";
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
import { addDays, startOfWeek, summarize } from "@/lib/ordys-engine";

export const Route = createFileRoute("/desempenho")({
  head: () => ({
    meta: [
      { title: "Desempenho — ORDYS" },
      {
        name: "description",
        content:
          "Evolução de médias, horas estudadas, frequência, metas e resumos diários, semanais e mensais da sua vida acadêmica.",
      },
      { property: "og:title", content: "Desempenho — ORDYS" },
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

  const day = summarize({ from: new Date(new Date().setHours(0, 0, 0, 0)), to: now }, { focus, tasks, plan, grades, attendance });
  const week = summarize({ from: startOfWeek(now), to: addDays(startOfWeek(now), 6) }, { focus, tasks, plan, grades, attendance });
  const month = summarize(
    { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now },
    { focus, tasks, plan, grades, attendance },
  );

  const monthlyChart = (() => {
    const map = new Map<string, { sum: number; count: number; minutes: number }>();
    for (const g of grades) {
      const key = g.graded_on.slice(0, 7);
      const cur = map.get(key) ?? { sum: 0, count: 0, minutes: 0 };
      cur.sum += (Number(g.score) / Number(g.max_score || scale)) * scale;
      cur.count += 1;
      map.set(key, cur);
    }
    for (const f of focus) {
      if (f.status !== "concluida") continue;
      const key = f.started_at.slice(0, 7);
      const cur = map.get(key) ?? { sum: 0, count: 0, minutes: 0 };
      cur.minutes += f.actual_minutes ?? f.planned_minutes;
      map.set(key, cur);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        period: key.slice(5) + "/" + key.slice(2, 4),
        media: v.count ? Number((v.sum / v.count).toFixed(2)) : null,
        horas: Number((v.minutes / 60).toFixed(1)),
      }));
  })();

  function goalProgress(goal: { metric: string; target: number | string; subject_id: string | null }) {
    const t = Number(goal.target) || 1;
    if (goal.metric === "horas_estudo") return Math.min(100, (week.minutes / 60 / t) * 100);
    if (goal.metric === "media") {
      const v = goal.subject_id ? subjectAverage(grades, goal.subject_id, scale) : overall;
      return v === null ? 0 : Math.min(100, (v / t) * 100);
    }
    if (goal.metric === "frequencia") {
      const v = goal.subject_id ? subjectAttendance(attendance, goal.subject_id) : null;
      const all = attendance.length
        ? (attendance.filter((a) => a.status !== "falta").length / attendance.length) * 100
        : null;
      const value = v ?? all;
      return value === null ? 0 : Math.min(100, (value / t) * 100);
    }
    if (goal.metric === "tarefas") return Math.min(100, (week.tasksDone / t) * 100);
    return 0;
  }

  async function saveGoal() {
    try {
      await insert("goals", {
        title: form.title.trim(),
        metric: form.metric,
        target: Number(form.target || 0),
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
              ? `${((attendance.filter((a) => a.status !== "falta").length / attendance.length) * 100).toFixed(0)}%`
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
                  <div key={a.subject.id} className="px-5 py-3">
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <Dot color={a.subject.color} />
                      <span className="font-medium">{a.subject.name}</span>
                      <span className="num ml-auto font-semibold">{a.avg === null ? "—" : fmtNumber(a.avg)}</span>
                      {a.subject.grade_goal ? (
                        <Chip tone={a.avg !== null && a.avg >= Number(a.subject.grade_goal) ? "success" : "gold"}>
                          meta {fmtNumber(Number(a.subject.grade_goal))}
                        </Chip>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
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
              <div className="flex items-center gap-5 border-t border-border px-5 py-5">
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
                    <div key={c.id} className="flex items-center gap-3 px-5 py-2 text-[12px]">
                      <span className="num flex-1">{c.checkin_date}</span>
                      <span className="num text-muted-foreground">{c.studied_minutes ?? 0} min</span>
                      <Chip tone={c.completed_plan === "sim" ? "success" : c.completed_plan === "nao" ? "danger" : "gold"}>
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
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} width={28} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="media"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    name="Média"
                  />
                  <Line
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
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <span className="font-medium">{g.title}</span>
                      <Chip>{g.period}</Chip>
                      <span className="num ml-auto text-muted-foreground">{progress.toFixed(0)}%</span>
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => update("goals", g.id, { active: !g.active })}
                      >
                        {g.active ? "pausar" : "ativar"}
                      </button>
                      <button className="text-muted-foreground hover:text-destructive" onClick={() => remove("goals", g.id)}>
                        <Trash2 className="size-[13px]" strokeWidth={1.7} />
                      </button>
                    </div>
                    <div className="mt-2">
                      <Bar value={progress} tone={progress >= 100 ? "success" : "primary"} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Alvo {Number(g.target)} · métrica {g.metric.replace("_", " ")}
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
              <option value="horas_estudo">Horas de estudo (semana)</option>
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
              <option value="semanal">Semanal</option>
              <option value="mensal">Mensal</option>
              <option value="bimestral">Bimestral</option>
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
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(false)}>
            Cancelar
          </Button>
          <Button onClick={saveGoal} disabled={!form.title.trim() || !form.target}>
            Criar meta
          </Button>
        </div>
      </Modal>
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
