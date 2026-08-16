import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Modal, Select, TextInput } from "@/components/ordys/form";
import { useOrdysMutations, useSubjects, useTopics } from "@/lib/ordys-db";
import { dateKey } from "@/lib/ordys-engine";

const kinds = [
  { key: "tarefa", label: "Tarefa" },
  { key: "evento", label: "Evento" },
  { key: "prova", label: "Prova" },
  { key: "nota", label: "Nota" },
  { key: "revisao", label: "Revisão" },
  { key: "sessao", label: "Sessão de estudo" },
] as const;

type Kind = (typeof kinds)[number]["key"];

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("tarefa");
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [when, setWhen] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: subjects = [] } = useSubjects();
  const { data: topics = [] } = useTopics(subjectId || null);
  const { insert } = useOrdysMutations();

  function reset() {
    setTitle("");
    setWhen("");
    setValue("");
    setTopicId("");
  }

  async function save() {
    setBusy(true);
    try {
      const subject = subjectId || null;
      if (kind === "tarefa") {
        await insert("tasks", {
          title,
          subject_id: subject,
          topic_id: topicId || null,
          due_at: when ? new Date(when).toISOString() : null,
          estimated_minutes: value ? Number(value) : null,
        });
      } else if (kind === "prova") {
        await insert("exams", {
          title: title || "Avaliação",
          subject_id: subject,
          exam_at: new Date(when || Date.now()).toISOString(),
          content: value || null,
        });
      } else if (kind === "evento") {
        await insert("calendar_events", {
          title,
          subject_id: subject,
          starts_at: new Date(when || Date.now()).toISOString(),
          location: value || null,
        });
      } else if (kind === "nota") {
        if (!subject) throw new Error("Escolha a disciplina");
        await insert("grades", {
          title: title || "Avaliação",
          subject_id: subject,
          score: Number(value || 0),
          graded_on: when ? when.slice(0, 10) : dateKey(new Date()),
        });
      } else if (kind === "revisao") {
        if (!topicId) throw new Error("Escolha o conteúdo a revisar");
        await insert("reviews", {
          topic_id: topicId,
          due_on: when ? when.slice(0, 10) : dateKey(new Date()),
          reason: title || "Revisão criada manualmente",
          source: "manual",
        });
      } else {
        await insert("plan_sessions", {
          subject_id: subject,
          topic_id: topicId || null,
          session_date: when ? when.slice(0, 10) : dateKey(new Date()),
          start_time: when && when.includes("T") ? when.slice(11, 16) : null,
          duration_minutes: Number(value || 45),
          kind: "estudo",
          reason: title || "Sessão criada manualmente",
          generated: false,
        });
      }
      toast.success("Salvo no ORDYS");
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar");
    } finally {
      setBusy(false);
    }
  }

  const needsTopic = kind === "revisao";
  const valueLabel =
    kind === "nota"
      ? "Nota obtida"
      : kind === "sessao"
        ? "Duração (min)"
        : kind === "tarefa"
          ? "Estimativa (min)"
          : kind === "prova"
            ? "Conteúdo"
            : "Local";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
        aria-label="Captura rápida"
        title="Captura rápida"
      >
        <Plus className="size-[16px]" strokeWidth={2} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Captura rápida" subtitle="Crie qualquer item em segundos">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {kinds.map((k) => (
            <button
              key={k.key}
              onClick={() => setKind(k.key)}
              className={`rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
                kind === k.key
                  ? "border-primary/40 bg-primary-soft text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Título" className="sm:col-span-2">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Descreva em poucas palavras" />
          </Field>
          <Field label="Disciplina">
            <Select
              value={subjectId}
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
          <Field label={kind === "nota" || kind === "revisao" ? "Data" : "Data e hora"}>
            <TextInput
              type={kind === "nota" || kind === "revisao" ? "date" : "datetime-local"}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
          {(needsTopic || kind === "sessao" || kind === "tarefa") && subjectId ? (
            <Field label="Conteúdo">
              <Select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                <option value="">Sem conteúdo</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={valueLabel}>
            <TextInput value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={busy || !title.trim()}>
            Salvar
          </Button>
        </div>
      </Modal>
    </>
  );
}
