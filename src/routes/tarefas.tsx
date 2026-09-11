import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Chip, Dot, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "@/components/ordys/form";
import {
  useOrdysMutations,
  useSubjects,
  useTasks,
  useTopics,
  type Task,
} from "@/lib/ordys-db";
import { daysUntil, formatDateTime, priorityLabel } from "@/lib/ordys-engine";

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

const groups = [{ items: ["Abertas", "Hoje", "Esta semana", "Atrasadas", "Concluídas", "Todas"] }];

const priorities = [
  { key: "alta", label: "Alta" },
  { key: "media", label: "Média" },
  { key: "baixa", label: "Baixa" },
];

const emptyForm = {
  title: "",
  subject_id: "",
  topic_id: "",
  due_at: "",
  priority: "media",
  estimated_minutes: "",
  description: "",
};

const emptyCopy: Record<string, { title: string; description: string }> = {
  Abertas: {
    title: "Nenhuma tarefa aberta",
    description: "Tudo em dia por aqui. Crie uma tarefa quando receber um trabalho, leitura ou exercício.",
  },
  Hoje: {
    title: "Nada com prazo para hoje",
    description: "Aproveite para adiantar uma tarefa da semana ou abrir uma sessão de estudo.",
  },
  "Esta semana": {
    title: "Nenhum prazo nos próximos 7 dias",
    description: "Cadastre os prazos das suas disciplinas para o ORDYS avisar com antecedência.",
  },
  Atrasadas: {
    title: "Nenhuma tarefa atrasada",
    description: "Continue assim: prazos em dia é o que mantém o plano de estudos realista.",
  },
  Concluídas: {
    title: "Nenhuma tarefa concluída ainda",
    description: "Ao marcar uma tarefa como concluída ela fica registrada aqui e no seu desempenho.",
  },
  Todas: {
    title: "Você ainda não tem tarefas",
    description: "Crie a primeira tarefa com prazo e prioridade para começar a organizar a rotina.",
  },
};

/** Converte um ISO em valor aceito por <input type="datetime-local"> no fuso local. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function matchesBucket(task: Task, bucket: string) {
  const done = task.status === "concluida";
  if (bucket === "Todas") return true;
  if (bucket === "Concluídas") return done;
  if (done) return false;
  if (bucket === "Abertas") return true;
  const left = daysUntil(task.due_at);
  if (left === null) return false;
  if (bucket === "Atrasadas") return left < 0;
  if (bucket === "Hoje") return left === 0;
  if (bucket === "Esta semana") return left >= 0 && left <= 7;
  return false;
}

function Tarefas() {
  const [active, setActive] = useState("Abertas");
  const { data: tasks = [] } = useTasks();
  const { data: subjects = [] } = useSubjects();
  const { insert, update, remove } = useOrdysMutations();
  const [modal, setModal] = useState<{ open: boolean; editing?: Task }>({ open: false });
  const [confirm, setConfirm] = useState<Task | null>(null);
  const [removing, setRemoving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { data: topics = [] } = useTopics(form.subject_id || null);

  const visible = tasks.filter((t) => matchesBucket(t, active));
  const late = tasks.filter((t) => matchesBucket(t, "Atrasadas")).length;
  const open = tasks.filter((t) => t.status !== "concluida").length;
  const done = tasks.filter((t) => t.status === "concluida").length;

  function openCreate() {
    setForm(emptyForm);
    setModal({ open: true });
  }

  function openEdit(task: Task) {
    setForm({
      title: task.title,
      subject_id: task.subject_id ?? "",
      topic_id: task.topic_id ?? "",
      due_at: toLocalInput(task.due_at),
      priority: task.priority ?? "media",
      estimated_minutes: task.estimated_minutes ? String(task.estimated_minutes) : "",
      description: task.description ?? "",
    });
    setModal({ open: true, editing: task });
  }

  const minutesInvalid =
    form.estimated_minutes !== "" &&
    (!Number.isFinite(Number(form.estimated_minutes)) || Number(form.estimated_minutes) < 0);

  async function save() {
    if (!form.title.trim()) {
      toast.error("Dê um título para a tarefa");
      return;
    }
    if (minutesInvalid) {
      toast.error("A estimativa deve ser um número de minutos");
      return;
    }
    const payload = {
      title: form.title.trim(),
      subject_id: form.subject_id || null,
      topic_id: form.topic_id || null,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      priority: form.priority,
      estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
      description: form.description.trim() || null,
    };
    try {
      if (modal.editing) await update("tasks", modal.editing.id, payload);
      else await insert("tasks", payload);
      setForm(emptyForm);
      setModal({ open: false });
      toast.success(modal.editing ? "Tarefa atualizada" : "Tarefa criada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a tarefa");
    }
  }

  async function toggle(task: Task) {
    const isDone = task.status === "concluida";
    try {
      await update("tasks", task.id, {
        status: isDone ? "em_andamento" : "concluida",
        completed_at: isDone ? null : new Date().toISOString(),
      });
      toast.success(isDone ? "Tarefa reaberta" : "Tarefa concluída");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível atualizar a tarefa");
    }
  }

  async function confirmRemove() {
    if (!confirm) return;
    setRemoving(true);
    try {
      await remove("tasks", confirm.id);
      toast.success("Tarefa excluída");
      setConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível excluir a tarefa");
    } finally {
      setRemoving(false);
    }
  }

  const copy = emptyCopy[active] ?? emptyCopy["Todas"]!;

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
        <Button onClick={openCreate}>
          <Plus className="size-[13px]" strokeWidth={2} /> Nova tarefa
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Abertas" value={String(open)} sub="em todas as disciplinas" />
        <Stat label="Atrasadas" value={String(late)} sub="precisam de atenção" accent="warning" />
        <Stat label="Concluídas" value={String(done)} sub="histórico total" accent="success" />
        <Stat
          label="Carga estimada"
          value={`${tasks
            .filter((t) => t.status !== "concluida")
            .reduce((acc, t) => acc + (t.estimated_minutes ?? 0), 0)} min`}
          sub="tarefas pendentes"
        />
      </div>

      <Panel className="mt-4">
        <PanelHeader
          title={active}
          hint={`${visible.length} ${visible.length === 1 ? "tarefa" : "tarefas"}`}
        />
        <div className="border-t border-border">
          {visible.length ? (
            visible.map((t) => {
              const subject = subjects.find((s) => s.id === t.subject_id);
              const left = daysUntil(t.due_at);
              const isDone = t.status === "concluida";
              return (
                <div key={t.id} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-0 sm:px-5">
                  <button
                    onClick={() => toggle(t)}
                    className={`mt-[3px] size-4 shrink-0 rounded-[4px] border transition-colors ${
                      isDone ? "border-success bg-success/40" : "border-border-strong hover:border-primary"
                    }`}
                    aria-label={isDone ? `Reabrir ${t.title}` : `Concluir ${t.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12.5px] ${isDone ? "text-muted-foreground line-through" : ""}`}>
                      {t.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {subject ? (
                        <>
                          <Dot color={subject.color} /> {subject.name} ·{" "}
                        </>
                      ) : null}
                      {t.due_at ? formatDateTime(t.due_at) : "Sem prazo definido"}
                      {t.estimated_minutes ? ` · ${t.estimated_minutes} min` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Chip tone={t.priority === "alta" ? "danger" : t.priority === "baixa" ? "muted" : "primary"}>
                        {`Prioridade ${priorityLabel(t.priority)}`}
                      </Chip>
                      {left !== null && left < 0 && !isDone ? <Chip tone="danger">Atrasada</Chip> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                      onClick={() => openEdit(t)}
                      aria-label={`Editar ${t.title}`}
                    >
                      <Pencil className="size-[14px]" strokeWidth={1.7} />
                    </button>
                    <button
                      className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive"
                      onClick={() => setConfirm(t)}
                      aria-label={`Excluir ${t.title}`}
                    >
                      <Trash2 className="size-[14px]" strokeWidth={1.7} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState
              title={copy.title}
              description={copy.description}
              actionLabel="Nova tarefa"
              onAction={openCreate}
            />
          )}
        </div>
      </Panel>

      <Modal
        open={modal.open}
        onClose={() => setModal({ open: false })}
        title={modal.editing ? "Editar tarefa" : "Nova tarefa"}
        subtitle="Prazo e prioridade alimentam a agenda, o plano de estudos e os alertas"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Título" className="sm:col-span-2">
            <TextInput
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Lista de exercícios de Cálculo"
            />
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
          <Field label="Conteúdo" hint={form.subject_id ? undefined : "Escolha uma disciplina para listar conteúdos"}>
            <Select
              value={form.topic_id}
              onChange={(e) => setForm({ ...form, topic_id: e.target.value })}
              disabled={!form.subject_id}
            >
              <option value="">Sem conteúdo</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prazo" hint="Opcional — sem prazo a tarefa não aparece nas visões por data">
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
          <Field
            label="Estimativa (minutos)"
            hint={minutesInvalid ? "Informe apenas números, em minutos" : undefined}
          >
            <TextInput
              type="number"
              min={0}
              inputMode="numeric"
              value={form.estimated_minutes}
              onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })}
              placeholder="60"
            />
          </Field>
          <Field label="Detalhes" className="sm:col-span-2">
            <TextArea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Páginas, critérios de entrega, links…"
            />
          </Field>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setModal({ open: false })}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!form.title.trim() || minutesInvalid}>
            {modal.editing ? "Salvar alterações" : "Criar tarefa"}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="Excluir tarefa"
        description={`“${confirm?.title ?? ""}” será removida definitivamente da sua conta. Essa ação não pode ser desfeita.`}
        onConfirm={confirmRemove}
        onClose={() => setConfirm(null)}
        loading={removing}
      />
    </Shell>
  );
}
