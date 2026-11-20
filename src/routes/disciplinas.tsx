import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import {
  Button,
  ConfirmDialog,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "@/components/ordys/form";
import { ColorSelector } from "@/components/ordys/color-selector";
import {
  SUBJECT_COLORS,
  TOPIC_STATUS,
  fmtNumber,
  subjectAttendance,
  subjectAverage,
  useAttendance,
  useExams,
  useGrades,
  type Exam,
  useOrdysMutations,
  useProfile,
  useSchedules,
  useSubjects,
  useTasks,
  useTopics,
  type Grade,
  type Subject,
  type SubjectSchedule,
  type Topic,
  type AttendanceRecord,
} from "@/lib/ordys-db";
import {
  attendanceStatusLabel,
  dateKey,
  formatDateTime,
  formatDay,
  weekdayLong,
  weekdayShort,
} from "@/lib/ordys-engine";

export const Route = createFileRoute("/disciplinas")({
  head: () => ({
    meta: [
      { title: "Disciplinas — Ordys Academy" },
      {
        name: "description",
        content:
          "Crie e organize suas próprias disciplinas com professor, sala, horários, conteúdos, notas, frequência e metas dentro do Ordys Academy.",
      },
      { property: "og:title", content: "Disciplinas — Ordys Academy" },
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

type ExamForm = {
  title: string;
  exam_at: string;
  kind: string;
  weight: string;
  content: string;
};

function toLocalDateTimeInput(value?: string | null) {
  const date = value ? new Date(value) : new Date(Date.now() + 7 * 24 * 60 * 60_000);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const emptyExamForm = (): ExamForm => ({
  title: "",
  exam_at: toLocalDateTimeInput(),
  kind: "prova",
  weight: "",
  content: "",
});

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

  const [subjectModal, setSubjectModal] = useState<{ open: boolean; editing?: Subject }>({
    open: false,
  });
  const [form, setForm] = useState<SubjectForm>(emptySubject);
  const [topicModal, setTopicModal] = useState<{ open: boolean; editing?: Topic }>({ open: false });
  const [topicForm, setTopicForm] = useState({
    title: "",
    status: "nao_estudado",
    mastery: "0",
    notes: "",
    next_review: "",
  });
  const [gradeForm, setGradeForm] = useState({ title: "", score: "", max_score: "", weight: "1" });
  const [editingGrade, setEditingGrade] = useState<Grade | null>(null);
  const [attendanceModal, setAttendanceModal] = useState<AttendanceRecord | null>(null);
  const [attendanceEditStatus, setAttendanceEditStatus] = useState("presente");
  const [attendanceEditDate, setAttendanceEditDate] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(() => dateKey(new Date()));
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [examModal, setExamModal] = useState<{ open: boolean; editing?: Exam }>({ open: false });
  const [examForm, setExamForm] = useState<ExamForm>(emptyExamForm);
  const [examSaving, setExamSaving] = useState(false);
  const [examToDelete, setExamToDelete] = useState<Exam | null>(null);
  const [examDeleting, setExamDeleting] = useState(false);
  const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null);
  const [deleteSubjectBusy, setDeleteSubjectBusy] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<{
    table: "topics" | "grades" | "attendance_records";
    id: string;
    label: string;
  } | null>(null);
  const [recordDeleting, setRecordDeleting] = useState(false);
  const [scheduleModal, setScheduleModal] = useState<{
    open: boolean;
    editing?: SubjectSchedule;
  }>({ open: false });
  const [scheduleForm, setScheduleForm] = useState({
    weekday: "0",
    start_time: "",
    end_time: "",
    room: "",
  });
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleToDelete, setScheduleToDelete] = useState<SubjectSchedule | null>(null);
  const [scheduleDeleting, setScheduleDeleting] = useState(false);

  const scale = Number(profile?.grade_scale_max ?? 10);
  const average = selected ? subjectAverage(grades, selected.id, scale) : null;
  const attendanceRate = selected ? subjectAttendance(attendance, selected.id) : null;
  const subjectSchedules = useMemo(
    () => schedules.filter((s) => s.subject_id === selected?.id),
    [schedules, selected?.id],
  );

  function openCreateSchedule() {
    if (!selected) return;
    setScheduleForm({
      weekday: "0",
      start_time: "",
      end_time: "",
      room: selected.room ?? "",
    });
    setScheduleModal({ open: true });
  }

  function openEditSchedule(schedule: SubjectSchedule) {
    setScheduleForm({
      weekday: String(schedule.weekday),
      start_time: schedule.start_time.slice(0, 5),
      end_time: schedule.end_time.slice(0, 5),
      room: schedule.room ?? "",
    });
    setScheduleModal({ open: true, editing: schedule });
  }

  async function saveSchedule() {
    if (!selected) return;
    const weekday = Number(scheduleForm.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      toast.error("Selecione um dia válido.");
      return;
    }
    if (!scheduleForm.start_time || !scheduleForm.end_time) {
      toast.error("Informe o início e o fim da aula.");
      return;
    }
    if (scheduleForm.end_time <= scheduleForm.start_time) {
      toast.error("O fim da aula deve ser depois do início.");
      return;
    }

    setScheduleSaving(true);
    try {
      const payload = {
        subject_id: scheduleModal.editing?.subject_id ?? selected.id,
        weekday,
        start_time: scheduleForm.start_time,
        end_time: scheduleForm.end_time,
        room: scheduleForm.room.trim() || null,
      };
      if (scheduleModal.editing) {
        await update("subject_schedules", scheduleModal.editing.id, payload);
        toast.success("Horário atualizado.");
      } else {
        await insert("subject_schedules", payload);
        toast.success("Horário adicionado.");
      }
      setScheduleModal({ open: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o horário.");
    } finally {
      setScheduleSaving(false);
    }
  }

  async function confirmDeleteSchedule() {
    if (!scheduleToDelete || scheduleDeleting) return;
    setScheduleDeleting(true);
    try {
      await remove("subject_schedules", scheduleToDelete.id);
      toast.success("Horário removido.");
      setScheduleToDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível remover o horário.");
    } finally {
      setScheduleDeleting(false);
    }
  }

  function openCreateExam() {
    setExamForm(emptyExamForm());
    setExamModal({ open: true });
  }

  function openEditExam(exam: Exam) {
    setExamForm({
      title: exam.title,
      exam_at: toLocalDateTimeInput(exam.exam_at),
      kind: exam.kind,
      weight: exam.weight ?? "",
      content: exam.content ?? "",
    });
    setExamModal({ open: true, editing: exam });
  }

  async function saveExam() {
    if (!selected) return;
    const title = examForm.title.trim();
    const examDate = new Date(examForm.exam_at);
    if (!title) {
      toast.error("Informe o nome da avaliação.");
      return;
    }
    if (!examForm.exam_at || !Number.isFinite(examDate.getTime())) {
      toast.error("Informe uma data e horário válidos.");
      return;
    }
    if (examForm.weight.trim().length > 30 || examForm.content.length > 4000) {
      toast.error("Revise o peso e o conteúdo da avaliação.");
      return;
    }

    setExamSaving(true);
    try {
      const payload = {
        title,
        subject_id: examModal.editing?.subject_id ?? selected.id,
        exam_at: examDate.toISOString(),
        kind: examForm.kind,
        weight: examForm.weight.trim() || null,
        content: examForm.content.trim() || null,
      };
      if (examModal.editing) {
        await update("exams", examModal.editing.id, payload);
        toast.success("Avaliação atualizada.");
      } else {
        await insert("exams", payload);
        toast.success("Avaliação cadastrada.");
      }
      setExamModal({ open: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a avaliação.");
    } finally {
      setExamSaving(false);
    }
  }

  async function confirmDeleteExam() {
    if (!examToDelete || examDeleting) return;
    setExamDeleting(true);
    try {
      await remove("exams", examToDelete.id);
      toast.success("Avaliação excluída.");
      setExamToDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir a avaliação.");
    } finally {
      setExamDeleting(false);
    }
  }

  function openCreate() {
    setForm(emptySubject);
    setSubjectModal({ open: true });
  }

  function openEdit(subject: Subject) {
    const schedule = schedules
      .filter((item) => item.subject_id === subject.id)
      .slice()
      .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))[0];

    setForm({
      name: subject.name,
      teacher: subject.teacher ?? "",
      room: subject.room ?? "",
      term: subject.term ?? "",
      weekly_hours: subject.weekly_hours ? String(subject.weekly_hours) : "",
      grade_goal: subject.grade_goal ? String(subject.grade_goal) : "",
      color: subject.color,
      weekday: String(schedule?.weekday ?? 0),
      start_time: schedule?.start_time?.slice(0, 5) ?? "",
      end_time: schedule?.end_time?.slice(0, 5) ?? "",
    });
    setSubjectModal({ open: true, editing: subject });
  }

  async function confirmDeleteSubject() {
    const target = subjectToDelete;
    if (!target || deleteSubjectBusy) return;
    setDeleteSubjectBusy(true);
    try {
      await remove("subjects", target.id);
      setSelectedId(null);
      setSubjectToDelete(null);
      toast.success("Disciplina excluída");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível excluir a disciplina.");
    } finally {
      setDeleteSubjectBusy(false);
    }
  }

  async function saveSubject() {
    const name = form.name.trim();
    if (!name) {
      toast.error("Informe o nome da disciplina.");
      return;
    }

    const weeklyHours = form.weekly_hours ? Number(form.weekly_hours) : null;
    const gradeGoal = form.grade_goal ? Number(form.grade_goal) : null;
    if (
      (weeklyHours !== null &&
        (!Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 168)) ||
      (gradeGoal !== null && (!Number.isFinite(gradeGoal) || gradeGoal < 0 || gradeGoal > scale))
    ) {
      toast.error("Revise as configurações da disciplina.");
      return;
    }

    if ((form.start_time && !form.end_time) || (!form.start_time && form.end_time)) {
      toast.error("Informe o início e o fim da aula.");
      return;
    }
    if (form.start_time && form.end_time && form.end_time <= form.start_time) {
      toast.error("O fim da aula deve ser depois do início.");
      return;
    }

    let savedSubject: Subject | null = null;
    try {
      const payload = {
        name,
        teacher: form.teacher || null,
        room: form.room || null,
        term: form.term || null,
        weekly_hours: weeklyHours,
        grade_goal: gradeGoal,
        color: form.color,
        short_name: name.slice(0, 3).toUpperCase(),
      };
      const row = subjectModal.editing
        ? await update("subjects", subjectModal.editing.id, payload)
        : await insert("subjects", payload);
      savedSubject = row as Subject;
      const subjectId = savedSubject.id;
      const existingSchedules = schedules
        .filter((item) => item.subject_id === subjectId)
        .slice()
        .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));

      if (form.start_time && form.end_time) {
        const schedulePayload = {
          subject_id: subjectId,
          weekday: Number(form.weekday),
          start_time: form.start_time,
          end_time: form.end_time,
          room: form.room || null,
        };
        const primarySchedule = existingSchedules[0];
        if (primarySchedule) {
          await update("subject_schedules", primarySchedule.id, schedulePayload);
        } else {
          await insert("subject_schedules", schedulePayload);
        }
      } else if (subjectModal.editing && existingSchedules.length) {
        // This form edits only the primary schedule. Never silently erase
        // additional schedules that may have been created elsewhere.
        await remove("subject_schedules", existingSchedules[0]!.id);
      }
      setSelectedId(savedSubject.id);
      setSubjectModal({ open: false });
      toast.success("Disciplina salva");
    } catch (err) {
      if (savedSubject) {
        // The subject itself is already stored. Keep the editor attached to that
        // record so retrying the schedule step cannot create a duplicate subject.
        setSelectedId(savedSubject.id);
        setSubjectModal({ open: true, editing: savedSubject });
        toast.error(
          "A disciplina foi salva, mas o horário não. Revise o horário e tente salvar novamente.",
        );
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
    }
  }

  async function saveTopic() {
    if (!selected) return;
    const title = topicForm.title.trim();
    const mastery = Number(topicForm.mastery || 0);
    if (!title) {
      toast.error("Informe o nome do conteúdo.");
      return;
    }
    if (!Number.isFinite(mastery) || mastery < 0 || mastery > 100) {
      toast.error("O domínio deve estar entre 0 e 100.");
      return;
    }
    const payload = {
      subject_id: selected.id,
      title,
      status: topicForm.status,
      mastery,
      notes: topicForm.notes || null,
      next_review: topicForm.next_review || null,
      last_review:
        topicForm.status === "estudado" || topicForm.status === "dominado"
          ? dateKey(new Date())
          : null,
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
    const score = Number(gradeForm.score || 0);
    const maxScore = Number(gradeForm.max_score || scale);
    const weight = Number(gradeForm.weight || 1);
    if (
      !Number.isFinite(score) ||
      !Number.isFinite(maxScore) ||
      !Number.isFinite(weight) ||
      maxScore <= 0 ||
      score < 0 ||
      score > maxScore ||
      weight <= 0
    ) {
      toast.error("Revise a nota, a nota máxima e o peso.");
      return;
    }
    try {
      const payload = {
        subject_id: editingGrade?.subject_id ?? selected.id,
        title: gradeForm.title.trim() || "Avaliação",
        score,
        max_score: maxScore,
        weight,
        graded_on: editingGrade?.graded_on ?? dateKey(new Date()),
      };
      if (editingGrade) {
        await update("grades", editingGrade.id, payload);
        toast.success("Nota atualizada");
      } else {
        await insert("grades", payload);
        toast.success("Nota registrada");
      }
      setEditingGrade(null);
      setGradeForm({ title: "", score: "", max_score: "", weight: "1" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar nota");
    }
  }

  function openEditGrade(grade: Grade) {
    setEditingGrade(grade);
    setGradeForm({
      title: grade.title ?? "",
      score: String(grade.score),
      max_score: String(grade.max_score),
      weight: String(grade.weight),
    });
  }

  async function saveAttendanceEdit() {
    if (!attendanceModal) return;
    setAttendanceSaving(true);
    try {
      if (!attendanceEditDate || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceEditDate)) {
        toast.error("Informe uma data válida para a aula.");
        return;
      }
      if (attendanceEditDate > dateKey(new Date())) {
        toast.error("A frequência não pode ser registrada em uma data futura.");
        return;
      }
      const duplicate = attendance.some(
        (record) =>
          record.id !== attendanceModal.id &&
          record.subject_id === attendanceModal.subject_id &&
          record.class_date === attendanceEditDate,
      );
      if (duplicate) {
        toast.error("Já existe um registro desta disciplina nessa data.");
        return;
      }
      await update("attendance_records", attendanceModal.id, {
        status: attendanceEditStatus,
        class_date: attendanceEditDate,
      });
      toast.success("Frequência atualizada");
      setAttendanceModal(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a frequência.");
    } finally {
      setAttendanceSaving(false);
    }
  }

  async function markAttendance(status: string) {
    if (!selected) return;
    try {
      if (!attendanceDate || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
        toast.error("Selecione a data da aula.");
        return;
      }
      if (attendanceDate > dateKey(new Date())) {
        toast.error("A frequência não pode ser registrada em uma data futura.");
        return;
      }
      const existing = attendance.find(
        (record) =>
          record.subject_id === selected.id && record.class_date === attendanceDate,
      );
      if (existing) {
        await update("attendance_records", existing.id, { status });
      } else {
        await insert("attendance_records", {
          subject_id: selected.id,
          class_date: attendanceDate,
          status,
        });
      }
      toast.success(
        status === "presente"
          ? "Presença registrada"
          : status === "justificada"
            ? "Falta justificada registrada"
            : "Falta registrada",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível registrar a frequência.");
    }
  }

  function removeRecord(
    table: "topics" | "grades" | "attendance_records",
    id: string,
    label: string,
  ) {
    setRecordToDelete({ table, id, label });
  }

  async function confirmRemoveRecord() {
    const target = recordToDelete;
    if (!target || recordDeleting) return;
    setRecordDeleting(true);
    try {
      await remove(target.table, target.id);
      toast.success(target.label);
      setRecordToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível excluir o registro.");
    } finally {
      setRecordDeleting(false);
    }
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
            Crie a primeira disciplina para liberar agenda, tarefas, provas, notas e plano de
            estudos.
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
                type="button"
                key={x.id}
                onClick={() => setSelectedId(x.id)}
                className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
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
                  sub={
                    selected.grade_goal
                      ? `meta ${fmtNumber(Number(selected.grade_goal))}`
                      : "sem meta"
                  }
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
                          .map(
                            (s) => `${weekdayShort[s.weekday] ?? ""} ${s.start_time.slice(0, 5)}`,
                          )
                          .slice(0, 2)
                          .join(" · ")
                      : "—"
                  }
                  sub={selected.room ?? "sem sala"}
                />
                <Stat
                  label="Professor"
                  value={selected.teacher ?? "—"}
                  sub={selected.term ?? "sem período"}
                />
              </div>

              <Panel className="mt-4">
                <PanelHeader
                  title="Horários das aulas"
                  hint={`${subjectSchedules.length} horário(s) cadastrados`}
                  action={
                    <Button variant="ghost" onClick={openCreateSchedule}>
                      <Plus className="size-[13px]" strokeWidth={2} /> Novo horário
                    </Button>
                  }
                />
                <div className="border-t border-border">
                  {subjectSchedules.length ? (
                    subjectSchedules
                      .slice()
                      .sort(
                        (a, b) =>
                          a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
                      )
                      .map((schedule) => (
                        <div
                          key={schedule.id}
                          className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 sm:px-5"
                        >
                          <Dot color={selected.color} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-medium">
                              {weekdayLong[schedule.weekday] ?? "Dia não definido"}
                              {" · "}
                              {schedule.start_time.slice(0, 5)}–{schedule.end_time.slice(0, 5)}
                            </p>
                            <p className="text-[10.5px] text-muted-foreground">
                              {schedule.room ?? selected.room ?? "Sala não informada"}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            onClick={() => openEditSchedule(schedule)}
                            aria-label="Editar horário"
                          >
                            <Pencil className="size-[13px]" strokeWidth={1.8} />
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setScheduleToDelete(schedule)}
                            aria-label="Remover horário"
                          >
                            <Trash2 className="size-[13px]" strokeWidth={1.8} />
                          </Button>
                        </div>
                      ))
                  ) : (
                    <p className="px-5 py-5 text-[11.5px] text-muted-foreground">
                      Nenhum horário cadastrado. Adicione os dias e períodos das suas aulas.
                    </p>
                  )}
                </div>
              </Panel>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => openEdit(selected)}>
                  <Pencil className="size-[13px]" strokeWidth={1.7} /> Editar
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await update("subjects", selected.id, { archived: !selected.archived });
                      toast.success(
                        selected.archived ? "Disciplina desarquivada" : "Disciplina arquivada",
                      );
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Não foi possível alterar o arquivamento.",
                      );
                    }
                  }}
                >
                  <Archive className="size-[13px]" strokeWidth={1.7} />
                  {selected.archived ? "Desarquivar" : "Arquivar"}
                </Button>
                <Button variant="danger" onClick={() => setSubjectToDelete(selected)}>
                  <Trash2 className="size-[13px]" strokeWidth={1.7} /> Excluir
                </Button>
              </div>

              <div className="mt-5 flex gap-1 overflow-x-auto border-b border-border">
                {tabs.map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setTab(t)}
                    className={`-mb-px min-h-11 shrink-0 border-b px-3 py-2 text-[12.5px] transition-colors ${
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
                            setTopicForm({
                              title: "",
                              status: "nao_estudado",
                              mastery: "0",
                              notes: "",
                              next_review: "",
                            });
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
                            <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px]">
                              <span className="min-w-0 flex-1 basis-[10rem] break-words font-medium">
                                {t.title}
                              </span>
                              <Chip>
                                {TOPIC_STATUS.find((s) => s.key === t.status)?.label ?? t.status}
                              </Chip>
                              {t.next_review ? (
                                <Chip tone="gold">revisar {t.next_review}</Chip>
                              ) : null}
                              <span className="num ml-auto shrink-0 text-[11px] text-muted-foreground">
                                {t.mastery}%
                              </span>
                              <button
                                type="button"
                                className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground sm:size-8 hover:bg-secondary hover:text-foreground"
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
                                type="button"
                                className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground sm:size-8 hover:bg-secondary hover:text-destructive"
                                onClick={() =>
                                  void removeRecord("topics", t.id, "Conteúdo excluído")
                                }
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
                          Cadastre os conteúdos da disciplina — eles alimentam o plano de estudos,
                          revisões e simulados.
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
                            <div
                              key={t.id}
                              className="flex min-w-0 flex-col gap-1.5 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-3"
                            >
                              <span
                                className={`size-3.5 shrink-0 rounded-[4px] border ${
                                  t.status === "concluida"
                                    ? "border-success bg-success/30"
                                    : "border-border-strong"
                                }`}
                              />
                              <p className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</p>
                              <span className="num shrink-0 self-end text-[11px] text-muted-foreground sm:self-auto">
                                {formatDateTime(t.due_at)}
                              </span>
                            </div>
                          ))
                      ) : (
                        <p className="px-5 py-6 text-[12px] text-muted-foreground">
                          Nenhuma tarefa.
                        </p>
                      )}
                    </div>
                  </Panel>
                ) : null}

                {tab === "Avaliações" ? (
                  <Panel>
                    <PanelHeader
                      title="Avaliações"
                      hint={`${exams.filter((exam) => exam.subject_id === selected.id).length} prova(s) e trabalho(s)`}
                      action={
                        <Button variant="ghost" onClick={openCreateExam}>
                          <Plus className="size-[13px]" strokeWidth={2} /> Nova avaliação
                        </Button>
                      }
                    />
                    <div className="border-t border-border">
                      {exams.filter((exam) => exam.subject_id === selected.id).length ? (
                        exams
                          .filter((exam) => exam.subject_id === selected.id)
                          .slice()
                          .sort((a, b) => a.exam_at.localeCompare(b.exam_at))
                          .map((exam) => (
                            <div
                              key={exam.id}
                              className="flex min-w-0 items-start gap-2 border-b border-border px-4 py-3 last:border-0 sm:gap-3 sm:px-5"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px]">
                                  <span className="min-w-0 flex-1 basis-[10rem] break-words font-medium">
                                    {exam.title}
                                  </span>
                                  <Chip>{exam.kind === "simulado" ? "Simulado" : exam.kind}</Chip>
                                  {exam.weight ? <Chip tone="gold">{exam.weight}</Chip> : null}
                                  <span className="num text-[11px] text-muted-foreground">
                                    {formatDateTime(exam.exam_at)}
                                  </span>
                                </div>
                                {exam.content ? (
                                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                                    {exam.content}
                                  </p>
                                ) : null}
                              </div>
                              <Button
                                variant="ghost"
                                onClick={() => openEditExam(exam)}
                                aria-label={`Editar ${exam.title}`}
                              >
                                <Pencil className="size-[13px]" strokeWidth={1.8} />
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => setExamToDelete(exam)}
                                aria-label={`Excluir ${exam.title}`}
                              >
                                <Trash2 className="size-[13px]" strokeWidth={1.8} />
                              </Button>
                            </div>
                          ))
                      ) : (
                        <p className="px-5 py-6 text-[12px] text-muted-foreground">
                          Nenhuma avaliação cadastrada nesta disciplina.
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
                              <div
                                key={g.id}
                                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 text-[12.5px]"
                              >
                                <span className="min-w-0 flex-1 basis-[10rem] truncate">
                                  {g.title}
                                </span>
                                <Chip>peso {Number(g.weight)}</Chip>
                                <span className="num font-semibold">
                                  {fmtNumber(Number(g.score))} / {fmtNumber(Number(g.max_score), 0)}
                                </span>
                                <Button
                                  variant="ghost"
                                  onClick={() => openEditGrade(g)}
                                  aria-label="Editar nota"
                                >
                                  <Pencil className="size-[13px]" strokeWidth={1.8} />
                                </Button>
                                <button
                                  type="button"
                                  className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive sm:size-8"
                                  onClick={() => removeRecord("grades", g.id, "Nota excluída")}
                                  aria-label="Excluir nota"
                                >
                                  <Trash2 className="size-[13px]" strokeWidth={1.7} />
                                </button>
                              </div>
                            ))
                        ) : (
                          <p className="px-5 py-6 text-[12px] text-muted-foreground">
                            Nenhuma nota ainda.
                          </p>
                        )}
                      </div>
                    </Panel>
                    <Panel className="px-5 py-4">
                      <p className="text-[12px] font-semibold">{editingGrade ? "Editar nota" : "Registrar nota"}</p>
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
                              onChange={(e) =>
                                setGradeForm({ ...gradeForm, score: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="Máx.">
                            <TextInput
                              placeholder={String(scale)}
                              value={gradeForm.max_score}
                              onChange={(e) =>
                                setGradeForm({ ...gradeForm, max_score: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="Peso">
                            <TextInput
                              value={gradeForm.weight}
                              onChange={(e) =>
                                setGradeForm({ ...gradeForm, weight: e.target.value })
                              }
                            />
                          </Field>
                        </div>
                        <div className="flex gap-2">
                          {editingGrade ? (
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setEditingGrade(null);
                                setGradeForm({ title: "", score: "", max_score: "", weight: "1" });
                              }}
                            >
                              Cancelar
                            </Button>
                          ) : null}
                          <Button className="flex-1" onClick={saveGrade} disabled={!gradeForm.score}>
                            {editingGrade ? "Salvar alterações" : "Salvar nota"}
                          </Button>
                        </div>
                      </div>
                    </Panel>
                  </div>
                ) : null}

                {tab === "Frequência" ? (
                  <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
                    <Panel>
                      <PanelHeader
                        title="Registros de aula"
                        hint={`${attendance.filter((a) => a.subject_id === selected.id).length} aulas`}
                      />
                      <div className="border-t border-border">
                        {attendance.filter((a) => a.subject_id === selected.id).length ? (
                          attendance
                            .filter((a) => a.subject_id === selected.id)
                            .slice()
                            .reverse()
                            .map((a) => (
                              <div
                                key={a.id}
                                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 text-[12.5px]"
                              >
                                <span className="num flex-1">
                                  {formatDay(`${a.class_date}T12:00:00`)}
                                </span>
                                <Chip
                                  className="shrink-0"
                                  tone={a.status === "falta" ? "danger" : "primary"}
                                >
                                  {attendanceStatusLabel(a.status)}
                                </Chip>
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setAttendanceModal(a);
                                    setAttendanceEditStatus(a.status);
                                    setAttendanceEditDate(a.class_date);
                                  }}
                                  aria-label="Editar frequência"
                                >
                                  <Pencil className="size-[13px]" strokeWidth={1.8} />
                                </Button>
                                <button
                                  type="button"
                                  className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive sm:size-8"
                                  onClick={() =>
                                    removeRecord(
                                      "attendance_records",
                                      a.id,
                                      "Registro de frequência excluído",
                                    )
                                  }
                                  aria-label="Excluir registro de frequência"
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
                      <p className="text-[12px] font-semibold">Registrar frequência</p>
                      <div className="mt-3 flex flex-col gap-2">
                        <Field label="Data da aula">
                          <TextInput
                            type="date"
                            value={attendanceDate}
                            max={dateKey(new Date())}
                            onChange={(event) => setAttendanceDate(event.target.value)}
                          />
                        </Field>
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
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Professor">
            <TextInput
              value={form.teacher}
              onChange={(e) => setForm({ ...form, teacher: e.target.value })}
            />
          </Field>
          <Field label="Sala">
            <TextInput
              value={form.room}
              onChange={(e) => setForm({ ...form, room: e.target.value })}
            />
          </Field>
          <Field label="Semestre / bimestre">
            <TextInput
              value={form.term}
              onChange={(e) => setForm({ ...form, term: e.target.value })}
            />
          </Field>
          <Field label="Carga horária semanal">
            <TextInput
              value={form.weekly_hours}
              onChange={(e) => setForm({ ...form, weekly_hours: e.target.value })}
            />
          </Field>
          <Field label="Meta de nota">
            <TextInput
              value={form.grade_goal}
              onChange={(e) => setForm({ ...form, grade_goal: e.target.value })}
            />
          </Field>
          <Field
            label="Cor da disciplina"
            className="sm:col-span-2"
            hint="Usada em cartões, horários, eventos e indicadores"
          >
            <ColorSelector value={form.color} onChange={(color) => setForm({ ...form, color })} />
          </Field>
          {subjectModal.editing &&
          schedules.filter((item) => item.subject_id === subjectModal.editing?.id).length > 1 ? (
            <p className="sm:col-span-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
              Horários adicionais desta disciplina são preservados ao editar. Este formulário altera
              apenas o primeiro horário.
            </p>
          ) : null}
          \n{" "}
          <Field label="Dia da aula">
            <Select
              value={form.weekday}
              onChange={(e) => setForm({ ...form, weekday: e.target.value })}
            >
              {weekdayLong.map((w, i) => (
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
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setSubjectModal({ open: false })}>
            Cancelar
          </Button>
          <Button onClick={saveSubject} disabled={!form.name.trim()}>
            Salvar
          </Button>
        </div>
      </Modal>

      <Modal
        open={examModal.open}
        onClose={() => {
          if (!examSaving) setExamModal({ open: false });
        }}
        title={examModal.editing ? "Editar avaliação" : "Nova avaliação"}
        subtitle={selected ? `Avaliação de ${selected.name}` : "Avaliação da disciplina"}
        width={520}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Título" className="sm:col-span-2">
            <TextInput
              maxLength={160}
              value={examForm.title}
              onChange={(event) =>
                setExamForm((current) => ({ ...current, title: event.target.value }))
              }
            />
          </Field>
          <Field label="Data e horário">
            <TextInput
              type="datetime-local"
              value={examForm.exam_at}
              onChange={(event) =>
                setExamForm((current) => ({ ...current, exam_at: event.target.value }))
              }
            />
          </Field>
          <Field label="Tipo">
            <Select
              value={examForm.kind}
              onChange={(event) =>
                setExamForm((current) => ({ ...current, kind: event.target.value }))
              }
            >
              <option value="prova">Prova</option>
              <option value="trabalho">Trabalho</option>
              <option value="simulado">Simulado</option>
              <option value="apresentacao">Apresentação</option>
              <option value="outro">Outro</option>
            </Select>
          </Field>
          <Field label="Peso (opcional)">
            <TextInput
              maxLength={30}
              value={examForm.weight}
              onChange={(event) =>
                setExamForm((current) => ({ ...current, weight: event.target.value }))
              }
              placeholder="Ex.: 2"
            />
          </Field>
          <Field label="Conteúdo (opcional)" className="sm:col-span-2">
            <TextArea
              value={examForm.content}
              onChange={(event) =>
                setExamForm((current) => ({ ...current, content: event.target.value }))
              }
              maxLength={4000}
            />
          </Field>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            disabled={examSaving}
            onClick={() => setExamModal({ open: false })}
          >
            Cancelar
          </Button>
          <Button
            disabled={examSaving || !examForm.title.trim() || !examForm.exam_at}
            onClick={() => void saveExam()}
          >
            {examSaving ? "Salvando…" : examModal.editing ? "Salvar alterações" : "Cadastrar avaliação"}
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={examToDelete !== null}
        title="Excluir avaliação?"
        description={
          examToDelete
            ? `“${examToDelete.title}” será removida. Notas associadas permanecem registradas sem vínculo com a prova.`
            : ""
        }
        confirmLabel="Excluir avaliação"
        loading={examDeleting}
        loadingLabel="Excluindo…"
        onClose={() => {
          if (!examDeleting) setExamToDelete(null);
        }}
        onConfirm={() => void confirmDeleteExam()}
      />
      <Modal
        open={scheduleModal.open}
        onClose={() => {
          if (!scheduleSaving) setScheduleModal({ open: false });
        }}
        title={scheduleModal.editing ? "Editar horário" : "Novo horário"}
        subtitle={selected ? `Horário de ${selected.name}` : "Horário da disciplina"}
        width={480}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dia da semana">
            <Select
              value={scheduleForm.weekday}
              onChange={(event) =>
                setScheduleForm((current) => ({ ...current, weekday: event.target.value }))
              }
            >
              {weekdayLong.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sala (opcional)">
            <TextInput
              maxLength={80}
              value={scheduleForm.room}
              onChange={(event) =>
                setScheduleForm((current) => ({ ...current, room: event.target.value }))
              }
            />
          </Field>
          <Field label="Início">
            <TextInput
              type="time"
              value={scheduleForm.start_time}
              onChange={(event) =>
                setScheduleForm((current) => ({ ...current, start_time: event.target.value }))
              }
            />
          </Field>
          <Field label="Fim">
            <TextInput
              type="time"
              value={scheduleForm.end_time}
              onChange={(event) =>
                setScheduleForm((current) => ({ ...current, end_time: event.target.value }))
              }
            />
          </Field>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            disabled={scheduleSaving}
            onClick={() => setScheduleModal({ open: false })}
          >
            Cancelar
          </Button>
          <Button disabled={scheduleSaving} onClick={() => void saveSchedule()}>
            {scheduleSaving ? "Salvando…" : "Salvar horário"}
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={scheduleToDelete !== null}
        title="Remover este horário?"
        description={
          scheduleToDelete
            ? `${weekdayLong[scheduleToDelete.weekday] ?? "Este dia"} · ${scheduleToDelete.start_time.slice(0, 5)}–${scheduleToDelete.end_time.slice(0, 5)} será removido da agenda.`
            : ""
        }
        confirmLabel="Remover horário"
        loading={scheduleDeleting}
        loadingLabel="Removendo…"
        onClose={() => {
          if (!scheduleDeleting) setScheduleToDelete(null);
        }}
        onConfirm={() => void confirmDeleteSchedule()}
      />
      <Modal
        open={attendanceModal !== null}
        onClose={() => {
          if (!attendanceSaving) setAttendanceModal(null);
        }}
        title="Corrigir frequência"
        subtitle={
          attendanceModal
            ? formatDay(`${attendanceModal.class_date}T12:00:00`)
            : "Registro de frequência"
        }
        width={420}
      >
        <div className="space-y-4">
          <Field label="Data da aula">
            <TextInput
              type="date"
              value={attendanceEditDate}
              max={dateKey(new Date())}
              onChange={(event) => setAttendanceEditDate(event.target.value)}
            />
          </Field>
          <Field label="Situação da aula">
            <Select
              value={attendanceEditStatus}
              onChange={(event) => setAttendanceEditStatus(event.target.value)}
            >
              <option value="presente">Presente</option>
              <option value="falta">Falta</option>
              <option value="justificada">Falta justificada</option>
            </Select>
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              disabled={attendanceSaving}
              onClick={() => setAttendanceModal(null)}
            >
              Cancelar
            </Button>
            <Button disabled={attendanceSaving} onClick={() => void saveAttendanceEdit()}>
              {attendanceSaving ? "Salvando…" : "Salvar correção"}
            </Button>
          </div>
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
            <TextInput
              value={topicForm.title}
              onChange={(e) => setTopicForm({ ...topicForm, title: e.target.value })}
            />
          </Field>
          <Field label="Status">
            <Select
              value={topicForm.status}
              onChange={(e) => setTopicForm({ ...topicForm, status: e.target.value })}
            >
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
            <TextArea
              value={topicForm.notes}
              onChange={(e) => setTopicForm({ ...topicForm, notes: e.target.value })}
            />
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
      <ConfirmDialog
        open={recordToDelete !== null}
        title="Excluir este registro?"
        description={
          recordToDelete?.table === "topics"
            ? "O conteúdo será removido da disciplina e deixará de aparecer no plano e nas revisões."
            : recordToDelete?.table === "grades"
              ? "A nota será removida e as médias da disciplina serão recalculadas."
              : "Este registro de presença ou falta será removido da frequência da disciplina."
        }
        confirmLabel="Excluir registro"
        confirmVariant="danger"
        loading={recordDeleting}
        loadingLabel="Excluindo…"
        onClose={() => {
          if (!recordDeleting) setRecordToDelete(null);
        }}
        onConfirm={() => void confirmRemoveRecord()}
      />
      <ConfirmDialog
        open={subjectToDelete !== null}
        title={
          subjectToDelete
            ? `Excluir a disciplina "${subjectToDelete.name}"?`
            : "Excluir disciplina?"
        }
        description="Esta ação também remove conteúdos, horários, notas e registros de frequência vinculados à disciplina."
        confirmLabel="Excluir disciplina"
        confirmVariant="danger"
        loadingLabel="Excluindo…"
        onConfirm={() => void confirmDeleteSubject()}
        onClose={() => {
          if (!deleteSubjectBusy) setSubjectToDelete(null);
        }}
        loading={deleteSubjectBusy}
      />
    </Shell>
  );
}
