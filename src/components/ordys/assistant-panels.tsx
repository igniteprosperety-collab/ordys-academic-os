import { useMemo, useState } from "react";
import { ArrowUp, CalendarDays, CheckSquare, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button, TextInput } from "@/components/ordys/form";
import {
  subjectAverage,
  useExams,
  useFocusSessions,
  useGrades,
  useOrdysMutations,
  usePlanSessions,
  useProfile,
  useReviews,
  useSubjects,
  useTasks,
  useTopics,
} from "@/lib/ordys-db";
import { buildCandidates, dateKey, daysUntil, generateWeeklyPlan, startOfWeek, summarize, addDays } from "@/lib/ordys-engine";

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const { data: profile } = useProfile();
  const { data: subjects = [] } = useSubjects();
  const { data: tasks = [] } = useTasks();
  const { data: exams = [] } = useExams();
  const { data: plan = [] } = usePlanSessions();
  const { data: focus = [] } = useFocusSessions();
  const { data: grades = [] } = useGrades();
  const { data: topics = [] } = useTopics();
  const { data: reviews = [] } = useReviews();
  const { userId, refresh } = useOrdysMutations();

  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("Olá. Eu sou o Agente ORDYS. Posso consultar sua rotina, identificar prioridades e reorganizar seu plano.");

  const now = new Date();
  const todayKey = dateKey(now);
  const scale = Number(profile?.grade_scale_max ?? 10);

  const nextExam = useMemo(
    () => exams.filter((e) => (daysUntil(e.exam_at) ?? -1) >= 0).sort((a, b) => a.exam_at.localeCompare(b.exam_at))[0],
    [exams],
  );
  const openTasks = useMemo(() => tasks.filter((t) => t.status !== "concluida"), [tasks]);
  const overdue = useMemo(
    () => openTasks.filter((t) => (daysUntil(t.due_at) ?? 0) < 0),
    [openTasks],
  );
  const week = useMemo(
    () => summarize({ from: startOfWeek(now), to: addDays(startOfWeek(now), 6) }, { focus, tasks, plan, grades, attendance: [] }),
    [focus, tasks, plan, grades, now.toDateString()],
  );

  function respond(query: string) {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    if (!q) return;

    if (q.includes("hoje") || q.includes("rotina")) {
      const todaySessions = plan.filter((p) => p.session_date === todayKey && p.status === "planejada");
      const dueToday = openTasks.filter((t) => t.due_at && dateKey(new Date(t.due_at)) === todayKey);
      const lines = [
        todaySessions.length ? `• ${todaySessions.length} sessão(ões) de estudo planejadas.` : "• Nenhuma sessão de estudo planejada para hoje.",
        dueToday.length ? `• ${dueToday.length} tarefa(s) vencem hoje.` : "• Nenhuma tarefa vence hoje.",
        nextExam ? `• Próxima avaliação: ${subjects.find((s) => s.id === nextExam.subject_id)?.name ?? nextExam.title} em ${Math.max(0, daysUntil(nextExam.exam_at) ?? 0)} dia(s).` : "• Nenhuma avaliação próxima cadastrada.",
      ];
      setAnswer(lines.join("\n"));
      return;
    }

    if (q.includes("prova") || q.includes("avalia")) {
      if (!nextExam) {
        setAnswer("Não há prova ou avaliação futura cadastrada.");
        return;
      }
      const subject = subjects.find((s) => s.id === nextExam.subject_id);
      const left = daysUntil(nextExam.exam_at) ?? 0;
      setAnswer(`${nextExam.title} · ${subject?.name ?? "Disciplina"}\nData: ${new Date(nextExam.exam_at).toLocaleString("pt-BR")}\nPrazo: ${left} dia(s).\n${nextExam.content ?? "Revise os conteúdos cadastrados para esta disciplina."}`);
      return;
    }

    if (q.includes("atras") || q.includes("pendên")) {
      setAnswer(
        overdue.length
          ? `Há ${overdue.length} tarefa(s) atrasada(s):\n${overdue.slice(0, 5).map((t) => `• ${t.title}`).join("\n")}`
          : "Você não tem tarefas atrasadas.",
      );
      return;
    }

    if (q.includes("estudar") || q.includes("prioridade") || q.includes("agora")) {
      const candidates = buildCandidates({
        userId: userId ?? "guest",
        profile: profile ?? null,
        subjects,
        topics,
        tasks,
        exams,
        grades,
        reviews,
        existing: plan,
      });
      const c = candidates[0];
      if (!c) {
        setAnswer("Não encontrei uma prioridade objetiva com os dados atuais. Cadastre conteúdos, tarefas ou provas para eu priorizar.");
      } else {
        setAnswer(`Prioridade agora:\n${c.reason}\n\nTempo sugerido: ${c.duration_minutes} minutos.`);
      }
      return;
    }

    if (q.includes("progresso") || q.includes("desempenho")) {
      const averages = subjects.map((s) => subjectAverage(grades, s.id, scale)).filter((v): v is number => v !== null);
      const overall = averages.length ? averages.reduce((a, b) => a + b, 0) / averages.length : null;
      setAnswer(`Estudo nesta semana: ${week.minutes} min em ${week.focusCount} sessão(ões).\nMédia geral: ${overall === null ? "sem notas suficientes" : overall.toFixed(1)} / ${scale}.\nPlano: ${week.completedPlanCount}/${week.plannedCount} sessão(ões) concluídas.`);
      return;
    }

    setAnswer("Entendi o pedido, mas para agir com segurança use termos como: hoje, prova, estudar agora, atrasadas ou progresso.");
  }

  async function generatePlan() {
    if (!userId) return;
    try {
      const result = await generateWeeklyPlan({
        userId,
        profile: profile ?? null,
        subjects,
        topics: [],
        tasks,
        exams,
        grades,
        reviews: [],
        existing: plan,
      });
      refresh();
      setAnswer(`Plano atualizado. ${result} sessão(ões) foram planejadas com base nos dados disponíveis.`);
      toast.success("Plano atualizado pelo Agente ORDYS");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o plano.");
    }
  }

  return (
    <div className="ordys-motion-scale fixed right-3 bottom-3 z-50 w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-4 text-primary" strokeWidth={1.7} />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold">Agente ORDYS</p>
          <p className="text-[10.5px] text-muted-foreground">assistente local · sem chave de IA</p>
        </div>
        <button aria-label="Fechar agente" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary">
          <X className="size-4" strokeWidth={1.7} />
        </button>
      </div>

      <div className="max-h-[280px] overflow-y-auto px-4 py-4">
        <div className="whitespace-pre-line rounded-xl bg-secondary/60 px-3.5 py-3 text-[12px] leading-relaxed">{answer}</div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {[
            { icon: CalendarDays, text: "O que tenho hoje?", value: "hoje" },
            { icon: CheckSquare, text: "Tarefas atrasadas", value: "tarefas atrasadas" },
            { icon: Sparkles, text: "O que estudar agora?", value: "o que estudar agora" },
            { icon: ArrowUp, text: "Ver meu progresso", value: "progresso" },
          ].map(({ icon: Icon, text, value }) => (
            <button key={value} onClick={() => respond(value)} className="ordys-pressable min-h-10 rounded-lg border border-border bg-background/40 px-2.5 text-left text-[10.5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <Icon className="mr-1.5 inline size-3" strokeWidth={1.7} />{text}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-1.5">
          <TextInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                respond(input);
                setInput("");
              }
            }}
            placeholder="Pergunte sobre sua rotina…"
            className="min-h-10"
          />
          <Button onClick={() => { respond(input); setInput(""); }} className="size-10 shrink-0 px-0" aria-label="Enviar">
            <ArrowUp className="size-4" strokeWidth={1.8} />
          </Button>
        </div>
        <Button variant="ghost" onClick={generatePlan} className="mt-2 w-full min-h-10">
          <Sparkles className="size-3.5" strokeWidth={1.7} /> Reorganizar meu plano
        </Button>
      </div>
    </div>
  );
}
