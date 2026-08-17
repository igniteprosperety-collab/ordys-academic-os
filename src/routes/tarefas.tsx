import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Chip, Dot, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import { Button, Field, Modal, Select, TextArea, TextInput } from "@/components/ordys/form";
import {
  useOrdysMutations,
  useSubjects,
  useTasks,
  useTopics,
  type Task,
} from "@/lib/ordys-db";
import { daysUntil, formatDateTime } from "@/lib/ordys-engine";

export const Route = createFileRoute("/tarefas")({
  head: () => ({
    meta: [
      { title: "Tarefas — ORDYS" },
      {
        name: "description",
        content:
          "Gerencie tarefas acadêmicas com prazos, prioridades, disciplina, conteúdo e estimativa de tempo — tudo salvo na sua conta ORDYS.",
      },
      { property: "og:title", content: "Tarefas — ORDYS" },
      {
        property: "og:description",
        content: "Prazos, prioridades e status reais, integrados ao plano de estudos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Tarefas,
});

const groups = [{ items: ["Todas", "Hoje", "Semana", "Atrasadas", "Concluídas"] }];

const priorities = [
  { key: "alta", label: "Alta" },
  { key: "media", label: "Média" },
  { key: "baixa", label: "Baixa" },
];

function bucketOf(task: Task) {
  if (task.status === "concluida") return "Concluídas";
  const left = daysUntil(task.due_at);
  if (left === null) return "Todas";
  if (left < 0) return "Atrasadas";
  if (left === 0) return "Hoje";
  if (left <= 7) return "Semana";
  return "Todas";
}

function Tarefas() {
  const [active, setActive] = useState("Todas");
  const { data: tasks = [] } = useTasks();
  const { data: subjects = [] } = useSubjects();
  const { insert, update, remove } = useOrdysMutations();
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    title: "",
    subject_id: "",
    topic_id: "",
    due_at: "",
    priority: "media",
    estimated_minutes: "",
    description: "",
  });
  const { data: topics = [] } = useTopics(form.subject_id || null);

  const visible = tasks.filter((t) =>
    active === "Todas" ? t.status !== "concluida" : bucketOf(t) === active,
  );
  const late = tasks.filter((t) => bucketOf(t) === "Atrasadas").length;
  const open = tasks.filter((t) => t.status !== "concluida").length;
  const doneWeek = tasks.filter((t) => t.status === "concluida").length;

  async function save() {
    try {
      await insert("tasks", {
        title: form.title.trim(),
        subject_id: form.subject_id || null,
        topic_id: form.topic_id || null,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        priority: form.priority,
        estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
        description: form.description || null,
      });
      setForm({ title: "", subject_id: "", topic_id: "", due_at: "", priority: "media", estimated_minutes: "", description: "" });
      setModal(false);
      toast.success("Tarefa criada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar tarefa");
    }
  }

  async function toggle(task: Task) {
    const done = task.status === "concluida";
    await update("tasks", task.id, {
      status: done ? "em_andamento" : "concluida",
      completed_at: done ? null : new Date().toISOString(),
    });
  }

  return (
    <Shell
      contextTitle="Tarefas"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Tarefas", active]}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title="Tarefas" subtitle={`${open} abertas · ${late} atrasadas`} />
        <Button onClick={() => setModal(true)}>
          <Plus className="size-[13px]" strokeWidth={2} /> Nova tarefa
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Abertas" value={String(open)} sub="em todas as disciplinas" />
        <Stat label="Atrasadas" value={String(late)} sub="precisam de atenção" accent="warning" />
        <Stat label="Concluídas" value={String(doneWeek)} sub="histórico total" accent="success" />
        <Stat
          label="Carga estimada"
          value={`${tasks
            .filter((t) => t.status !== "concluida")
            .reduce((acc, t) => acc + (t.estimated_minutes ?? 0), 0)} min`}
          sub="tarefas pendentes"
        />
      </div>

      <Panel className="mt-4">
        <PanelHeader title={active} hint={`${visible.length} tarefas`} />
        <div className="border-t border-border">
          {visible.length ? (
            visible.map((t) => {
              const subject = subjects.find((s) => s.id === t.subject_id);
              const left = daysUntil(t.due_at);
              return (
                <div key={t.id} className="flex items-start gap-3 px-5 py-3">
                  <button
                    onClick={() => toggle(t)}
                    className={`mt-[3px] size-3.5 shrink-0 rounded-[4px] border transition-colors ${
                      t.status === "concluida" ? "border-success bg-success/40" : "border-border-strong hover:border-primary"
                    }`}
                    aria-label="Concluir tarefa"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12.5px] ${t.status === "concluida" ? "text-muted-foreground line-through" : ""}`}>
                      {t.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {subject ? (
                        <>
                          <Dot color={subject.color} /> {subject.name} ·{" "}
                        </>
                      ) : null}
                      {formatDateTime(t.due_at)}
                      {t.estimated_minutes ? ` · ${t.estimated_minutes} min` : ""}
                    </p>
                  </div>
                  <Chip tone={t.priority === "alta" ? "danger" : t.priority === "baixa" ? "muted" : "primary"}>
                    {t.priority}
                  </Chip>
                  {left !== null && left < 0 && t.status !== "concluida" ? (
                    <Chip tone="danger">atrasada</Chip>
                  ) : null}
                  <button
                    className="mt-0.5 text-muted-foreground hover:text-destructive"
                    onClick={() => remove("tasks", t.id)}
                  >
                    <Trash2 className="size-[13px]" strokeWidth={1.7} />
                  </button>
                </div>
              );
            })
          ) : (
            <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhuma tarefa nesta visão.</p>
          )}
        </div>
      </Panel>

      <Modal open={modal} onClose={() => setModal(false)} title="Nova tarefa">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Título" className="sm:col-span-2">
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Disciplina">
            <Select
              value={form.subject_id}
              onChange={(e) => setForm({ ...form, subject_id: e.target.value, topic_id: "" })}
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
            <Select value={form.topic_id} onChange={(e) => setForm({ ...form, topic_id: e.target.value })}>
              <option value="">Sem conteúdo</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prazo">
            <TextInput
              type="datetime-local"
              value={form.due_at}
              onChange={(e) => setForm({ ...form, due_at: e.target.value })}
            />
          </Field>
          <Field label="Prioridade">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {priorities.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estimativa (min)">
            <TextInput
              value={form.estimated_minutes}
              onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })}
            />
          </Field>
          <Field label="Detalhes" className="sm:col-span-2">
            <TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!form.title.trim()}>
            Criar tarefa
          </Button>
        </div>
      </Modal>
    </Shell>
  );
}
