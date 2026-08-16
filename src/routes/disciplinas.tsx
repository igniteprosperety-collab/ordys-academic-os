import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import { Button, Field, Modal, Select, TextArea, TextInput } from "@/components/ordys/form";
import {
  SUBJECT_COLORS,
  TOPIC_STATUS,
  fmtNumber,
  subjectAttendance,
  subjectAverage,
  useAttendance,
  useExams,
  useGrades,
  useOrdysMutations,
  useProfile,
  useSchedules,
  useSubjects,
  useTasks,
  useTopics,
  type Subject,
  type Topic,
} from "@/lib/ordys-db";
import { dateKey, formatDateTime, weekdayShort } from "@/lib/ordys-engine";

export const Route = createFileRoute("/disciplinas")({
  head: () => ({
    meta: [
      { title: "Disciplinas — ORDYS" },
      {
        name: "description",
        content:
          "Crie e organize suas próprias disciplinas com professor, sala, horários, conteúdos, notas, frequência e metas dentro do ORDYS.",
      },
      { property: "og:title", content: "Disciplinas — ORDYS" },
      {
        property: "og:description",
        content: "Disciplinas personalizáveis com conteúdos, notas, frequência e metas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Disciplinas,
});

const groups = [{ items: ["Ativas", "Arquivadas", "Conteúdos", "Notas", "Frequência"] }];
const tabs = ["Conteúdos", "Tarefas", "Avaliações", "Notas", "Frequência"];

type SubjectForm = {
  name: string;
  teacher: string;
  room: string;
  term: string;
  weekly_hours: string;
  grade_goal: string;
  color: string;
  weekday: string;
  start_time: string;
  end_time: string;
};

const emptySubject: SubjectForm = {
  name: "",
  teacher: "",
  room: "",
  term: "",
  weekly_hours: "",
  grade_goal: "",
  color: SUBJECT_COLORS[0]!,
  weekday: "0",
  start_time: "",
  end_time: "",
};

function Disciplinas() {
  const [active, setActive] = useState("Ativas");
  const showArchived = active === "Arquivadas";
  const { data: subjects = [], isLoading } = useSubjects(true);
  const list = subjects.filter((s) => s.archived === showArchived);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = list.find((s) => s.id === selectedId) ?? list[0] ?? null;
  const [tab, setTab] = useState(tabs[0]!);

  const { data: topics = [] } = useTopics(selected?.id ?? null);
  const { data: tasks = [] } = useTasks();
  const { data: exams = [] } = useExams();
  const { data: grades = [] } = useGrades();
  const { data: attendance = [] } = useAttendance();
  const { data: schedules = [] } = useSchedules();
  const { data: profile } = useProfile();
  const { insert, update, remove } = useOrdysMutations();

  const [subjectModal, setSubjectModal] = useState<{ open: boolean; editing?: Subject }>({ open: false });
  const [form, setForm] = useState<SubjectForm>(emptySubject);
  const [topicModal, setTopicModal] = useState<{ open: boolean; editing?: Topic }>({ open: false });
  const [topicForm, setTopicForm] = useState({ title: "", status: "nao_estudado", mastery: "0", notes: "", next_review: "" });
  const [gradeForm, setGradeForm] = useState({ title: "", score: "", max_score: "", weight: "1" });

  const scale = Number(profile?.grade_scale_max ?? 10);
  const average = selected ? subjectAverage(grades, selected.id, scale) : null;
  const attendanceRate = selected ? subjectAttendance(attendance, selected.id) : null;
  const subjectSchedules = useMemo(
    () => schedules.filter((s) => s.subject_id === selected?.id),
    [schedules, selected?.id],
  );

  function openCreate() {
    setForm(emptySubject);
    setSubjectModal({ open: true });
  }

  function openEdit(subject: Subject) {
    setForm({
      name: subject.name,
      teacher: subject.teacher ?? "",
      room: subject.room ?? "",
      term: subject.term ?? "",
      weekly_hours: subject.weekly_hours ? String(subject.weekly_hours) : "",
      grade_goal: subject.grade_goal ? String(subject.grade_goal) : "",
      color: subject.color,
      weekday: "0",
      start_time: "",
      end_time: "",
    });
    setSubjectModal({ open: true, editing: subject });
  }

  async function saveSubject() {
    try {
      const payload = {
        name: form.name.trim(),
        teacher: form.teacher || null,
        room: form.room || null,
        term: form.term || null,
        weekly_hours: form.weekly_hours ? Number(form.weekly_hours) : null,
        grade_goal: form.grade_goal ? Number(form.grade_goal) : null,
        color: form.color,
        short_name: form.name.slice(0, 3).toUpperCase(),
      };
      const row = subjectModal.editing
        ? await update("subjects", subjectModal.editing.id, payload)
        : await insert("subjects", payload);
      if (form.start_time && form.end_time) {
        await insert("subject_schedules", {
          subject_id: (row as Subject).id,
          weekday: Number(form.weekday),
          start_time: form.start_time,
          end_time: form.end_time,
          room: form.room || null,
        });
      }
      setSelectedId((row as Subject).id);
      setSubjectModal({ open: false });
      toast.success("Disciplina salva");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  }

  async function saveTopic() {
    if (!selected) return;
    const payload = {
      subject_id: selected.id,
      title: topicForm.title.trim(),
      status: topicForm.status,
      mastery: Number(topicForm.mastery || 0),
      notes: topicForm.notes || null,
      next_review: topicForm.next_review || null,
      last_review: topicForm.status === "estudado" || topicForm.status === "dominado" ? dateKey(new Date()) : null,
    };
    try {
      if (topicModal.editing) await update("topics", topicModal.editing.id, payload);
      else await insert("topics", payload);
      setTopicModal({ open: false });
      setTopicForm({ title: "", status: "nao_estudado", mastery: "0", notes: "", next_review: "" });
      toast.success("Conteúdo salvo");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar conteúdo");
    }
  }

  async function saveGrade() {
    if (!selected) return;
    try {
      await insert("grades", {
        subject_id: selected.id,
        title: gradeForm.title || "Avaliação",
        score: Number(gradeForm.score || 0),
        max_score: Number(gradeForm.max_score || scale),
        weight: Number(gradeForm.weight || 1),
        graded_on: dateKey(new Date()),
      });
      setGradeForm({ title: "", score: "", max_score: "", weight: "1" });
      toast.success("Nota registrada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar nota");
    }
  }

  async function markAttendance(status: string) {
    if (!selected) return;
    await insert("attendance_records", {
      subject_id: selected.id,
      class_date: dateKey(new Date()),
      status,
    });
    toast.success(status === "presente" ? "Presença registrada" : "Falta registrada");
  }

  return (
    <Shell
      contextTitle="Disciplinas"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Disciplinas", selected?.name ?? "Nova"]}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle
          title="Disciplinas"
          subtitle={`${subjects.filter((s) => !s.archived).length} ativas · dados salvos na sua conta`}
        />
        <Button onClick={openCreate}>
          <Plus className="size-[13px]" strokeWidth={2} /> Adicionar disciplina
        </Button>
      </div>

      {!isLoading && !list.length ? (
        <Panel className="mt-6 px-5 py-8 text-center">
          <p className="text-[13px] font-medium">
            {showArchived ? "Nenhuma disciplina arquivada." : "Você ainda não criou disciplinas."}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Crie a primeira disciplina para liberar agenda, tarefas, provas, notas e plano de estudos.
          </p>
          {!showArchived ? (
            <Button className="mx-auto mt-4" onClick={openCreate}>
              <Plus className="size-[13px]" strokeWidth={2} /> Criar disciplina
            </Button>
          ) : null}
        </Panel>
      ) : null}

      {list.length ? (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            {list.map((x) => (
              <button
                key={x.id}
                onClick={() => setSelectedId(x.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
                  x.id === selected?.id
                    ? "border-primary/40 bg-primary-soft text-foreground"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground"
                }`}
              >
                <Dot color={x.color} />
                {x.name}
              </button>
            ))}
          </div>

          {selected ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <Stat
                  label="Média atual"
                  value={average === null ? "—" : fmtNumber(average)}
                  sub={selected.grade_goal ? `meta ${fmtNumber(Number(selected.grade_goal))}` : "sem meta"}
                  accent="primary"
                />
                <Stat
                  label="Frequência"
                  value={attendanceRate === null ? "—" : `${attendanceRate.toFixed(0)}%`}
                  sub={`meta ${Number(selected.attendance_goal ?? profile?.attendance_target ?? 75)}%`}
                  accent={attendanceRate !== null && attendanceRate < 85 ? "warning" : "success"}
                />
                <Stat
                  label="Horários"
                  value={
                    subjectSchedules.length
                      ? subjectSchedules
                          .map((s) => `${weekdayShort[s.weekday] ?? ""} ${s.start_time.slice(0, 5)}`)
                          .slice(0, 2)
                          .join(" · ")
                      : "—"
                  }
                  sub={selected.room ?? "sem sala"}
                />
                <Stat label="Professor" value={selected.teacher ?? "—"} sub={selected.term ?? "sem período"} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => openEdit(selected)}>
                  <Pencil className="size-[13px]" strokeWidth={1.7} /> Editar
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => update("subjects", selected.id, { archived: !selected.archived })}
                >
                  <Archive className="size-[13px]" strokeWidth={1.7} />
                  {selected.archived ? "Desarquivar" : "Arquivar"}
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    await remove("subjects", selected.id);
                    setSelectedId(null);
                    toast.success("Disciplina excluída");
                  }}
                >
                  <Trash2 className="size-[13px]" strokeWidth={1.7} /> Excluir
                </Button>
              </div>

              <div className="mt-5 flex gap-1 border-b border-border">
                {tabs.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b px-3 py-2 text-[12.5px] transition-colors ${
                      tab === t
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                {tab === "Conteúdos" ? (
                  <Panel>
                    <PanelHeader
                      title="Conteúdos"
                      hint={`${topics.length} cadastrados`}
                      action={
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setTopicForm({ title: "", status: "nao_estudado", mastery: "0", notes: "", next_review: "" });
                            setTopicModal({ open: true });
                          }}
                        >
                          <Plus className="size-[13px]" strokeWidth={2} /> Conteúdo
                        </Button>
                      }
                    />
                    <div className="border-t border-border">
                      {topics.length ? (
                        topics.map((t) => (
                          <div key={t.id} className="px-5 py-3">
                            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
                              <span className="font-medium">{t.title}</span>
                              <Chip>{TOPIC_STATUS.find((s) => s.key === t.status)?.label ?? t.status}</Chip>
                              {t.next_review ? <Chip tone="gold">revisar {t.next_review}</Chip> : null}
                              <span className="num ml-auto text-[11px] text-muted-foreground">{t.mastery}%</span>
                              <button
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  setTopicForm({
                                    title: t.title,
                                    status: t.status,
                                    mastery: String(t.mastery),
                                    notes: t.notes ?? "",
                                    next_review: t.next_review ?? "",
                                  });
                                  setTopicModal({ open: true, editing: t });
                                }}
                              >
                                <Pencil className="size-[13px]" strokeWidth={1.7} />
                              </button>
                              <button
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => remove("topics", t.id)}
                              >
                                <Trash2 className="size-[13px]" strokeWidth={1.7} />
                              </button>
                            </div>
                            <Bar value={t.mastery} tone={t.mastery < 50 ? "warning" : "primary"} />
                            {t.notes ? (
                              <p className="mt-2 text-[11.5px] text-muted-foreground">{t.notes}</p>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="px-5 py-6 text-[12px] text-muted-foreground">
                          Cadastre os conteúdos da disciplina — eles alimentam o plano de estudos, revisões e
                          simulados.
                        </p>
                      )}
                    </div>
                  </Panel>
                ) : null}

                {tab === "Tarefas" ? (
                  <Panel>
                    <PanelHeader title="Tarefas da disciplina" />
                    <div className="border-t border-border">
                      {tasks.filter((t) => t.subject_id === selected.id).length ? (
                        tasks
                          .filter((t) => t.subject_id === selected.id)
                          .map((t) => (
                            <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                              <span
                                className={`size-3.5 shrink-0 rounded-[4px] border ${
                                  t.status === "concluida" ? "border-success bg-success/30" : "border-border-strong"
                                }`}
                              />
                              <p className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</p>
                              <span className="num text-[11px] text-muted-foreground">
                                {formatDateTime(t.due_at)}
                              </span>
                            </div>
                          ))
                      ) : (
                        <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhuma tarefa.</p>
                      )}
                    </div>
                  </Panel>
                ) : null}

                {tab === "Avaliações" ? (
                  <Panel>
                    <PanelHeader title="Avaliações" hint="provas e trabalhos" />
                    <div className="border-t border-border">
                      {exams.filter((e) => e.subject_id === selected.id).length ? (
                        exams
                          .filter((e) => e.subject_id === selected.id)
                          .map((e) => (
                            <div key={e.id} className="px-5 py-3">
                              <div className="flex items-center gap-2 text-[12.5px]">
                                <span className="font-medium">{e.title}</span>
                                {e.weight ? <Chip tone="gold">{e.weight}</Chip> : null}
                                <span className="num ml-auto text-[11px] text-muted-foreground">
                                  {formatDateTime(e.exam_at)}
                                </span>
                              </div>
                              {e.content ? (
                                <p className="mt-1 text-[11.5px] text-muted-foreground">{e.content}</p>
                              ) : null}
                            </div>
                          ))
                      ) : (
                        <p className="px-5 py-6 text-[12px] text-muted-foreground">
                          Use a captura rápida para adicionar uma prova.
                        </p>
                      )}
                    </div>
                  </Panel>
                ) : null}

                {tab === "Notas" ? (
                  <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
                    <Panel>
                      <PanelHeader title="Notas registradas" hint={`escala 0 – ${scale}`} />
                      <div className="border-t border-border">
                        {grades.filter((g) => g.subject_id === selected.id).length ? (
                          grades
                            .filter((g) => g.subject_id === selected.id)
                            .map((g) => (
                              <div key={g.id} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
                                <span className="min-w-0 flex-1 truncate">{g.title}</span>
                                <Chip>peso {Number(g.weight)}</Chip>
                                <span className="num font-semibold">
                                  {fmtNumber(Number(g.score))} / {fmtNumber(Number(g.max_score), 0)}
                                </span>
                                <button
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => remove("grades", g.id)}
                                >
                                  <Trash2 className="size-[13px]" strokeWidth={1.7} />
                                </button>
                              </div>
                            ))
                        ) : (
                          <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhuma nota ainda.</p>
                        )}
                      </div>
                    </Panel>
                    <Panel className="px-5 py-4">
                      <p className="text-[12px] font-semibold">Registrar nota</p>
                      <div className="mt-3 grid gap-2.5">
                        <Field label="Avaliação">
                          <TextInput
                            value={gradeForm.title}
                            onChange={(e) => setGradeForm({ ...gradeForm, title: e.target.value })}
                          />
                        </Field>
                        <div className="grid grid-cols-3 gap-2">
                          <Field label="Nota">
                            <TextInput
                              value={gradeForm.score}
                              onChange={(e) => setGradeForm({ ...gradeForm, score: e.target.value })}
                            />
                          </Field>
                          <Field label="Máx.">
                            <TextInput
                              placeholder={String(scale)}
                              value={gradeForm.max_score}
                              onChange={(e) => setGradeForm({ ...gradeForm, max_score: e.target.value })}
                            />
                          </Field>
                          <Field label="Peso">
                            <TextInput
                              value={gradeForm.weight}
                              onChange={(e) => setGradeForm({ ...gradeForm, weight: e.target.value })}
                            />
                          </Field>
                        </div>
                        <Button onClick={saveGrade} disabled={!gradeForm.score}>
                          Salvar nota
                        </Button>
                      </div>
                    </Panel>
                  </div>
                ) : null}

                {tab === "Frequência" ? (
                  <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
                    <Panel>
                      <PanelHeader title="Registros de aula" hint={`${attendance.filter((a) => a.subject_id === selected.id).length} aulas`} />
                      <div className="border-t border-border">
                        {attendance.filter((a) => a.subject_id === selected.id).length ? (
                          attendance
                            .filter((a) => a.subject_id === selected.id)
                            .slice()
                            .reverse()
                            .map((a) => (
                              <div key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
                                <span className="num flex-1">{a.class_date}</span>
                                <Chip tone={a.status === "falta" ? "danger" : "primary"}>{a.status}</Chip>
                                <button
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => remove("attendance_records", a.id)}
                                >
                                  <Trash2 className="size-[13px]" strokeWidth={1.7} />
                                </button>
                              </div>
                            ))
                        ) : (
                          <p className="px-5 py-6 text-[12px] text-muted-foreground">
                            Nenhuma aula registrada ainda.
                          </p>
                        )}
                      </div>
                    </Panel>
                    <Panel className="px-5 py-4">
                      <p className="text-[12px] font-semibold">Registrar aula de hoje</p>
                      <div className="mt-3 flex flex-col gap-2">
                        <Button onClick={() => markAttendance("presente")}>Presente</Button>
                        <Button variant="ghost" onClick={() => markAttendance("falta")}>
                          Falta
                        </Button>
                        <Button variant="ghost" onClick={() => markAttendance("justificada")}>
                          Falta justificada
                        </Button>
                      </div>
                    </Panel>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      <Modal
        open={subjectModal.open}
        onClose={() => setSubjectModal({ open: false })}
        title={subjectModal.editing ? "Editar disciplina" : "Adicionar disciplina"}
        subtitle="Aparece automaticamente na agenda, tarefas, provas, notas, frequência e estudos"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Professor">
            <TextInput value={form.teacher} onChange={(e) => setForm({ ...form, teacher: e.target.value })} />
          </Field>
          <Field label="Sala">
            <TextInput value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
          </Field>
          <Field label="Semestre / bimestre">
            <TextInput value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} />
          </Field>
          <Field label="Carga horária semanal">
            <TextInput
              value={form.weekly_hours}
              onChange={(e) => setForm({ ...form, weekly_hours: e.target.value })}
            />
          </Field>
          <Field label="Meta de nota">
            <TextInput value={form.grade_goal} onChange={(e) => setForm({ ...form, grade_goal: e.target.value })} />
          </Field>
          <Field label="Identificador visual">
            <div className="flex gap-1.5 pt-1">
              {SUBJECT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className={`size-6 rounded-full ring-2 transition-all ${
                    form.color === c ? "ring-primary" : "ring-transparent"
                  }`}
                  style={{ background: c }}
                  aria-label="cor"
                />
              ))}
            </div>
          </Field>
          <Field label="Dia da aula">
            <Select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
              {weekdayShort.map((w, i) => (
                <option key={w} value={i}>
                  {w}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Início">
              <TextInput
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </Field>
            <Field label="Fim">
              <TextInput
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSubjectModal({ open: false })}>
            Cancelar
          </Button>
          <Button onClick={saveSubject} disabled={!form.name.trim()}>
            Salvar
          </Button>
        </div>
      </Modal>

      <Modal
        open={topicModal.open}
        onClose={() => setTopicModal({ open: false })}
        title={topicModal.editing ? "Editar conteúdo" : "Novo conteúdo"}
        subtitle="Status e domínio alimentam plano de estudos, revisões e simulados"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Conteúdo" className="sm:col-span-2">
            <TextInput value={topicForm.title} onChange={(e) => setTopicForm({ ...topicForm, title: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={topicForm.status} onChange={(e) => setTopicForm({ ...topicForm, status: e.target.value })}>
              {TOPIC_STATUS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nível de domínio (%)">
            <TextInput
              type="number"
              min={0}
              max={100}
              value={topicForm.mastery}
              onChange={(e) => setTopicForm({ ...topicForm, mastery: e.target.value })}
            />
          </Field>
          <Field label="Próxima revisão">
            <TextInput
              type="date"
              value={topicForm.next_review}
              onChange={(e) => setTopicForm({ ...topicForm, next_review: e.target.value })}
            />
          </Field>
          <Field label="Anotações" className="sm:col-span-2">
            <TextArea value={topicForm.notes} onChange={(e) => setTopicForm({ ...topicForm, notes: e.target.value })} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setTopicModal({ open: false })}>
            Cancelar
          </Button>
          <Button onClick={saveTopic} disabled={!topicForm.title.trim()}>
            Salvar
          </Button>
        </div>
      </Modal>
    </Shell>
  );
}
