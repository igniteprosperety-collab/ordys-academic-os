import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Panel, PanelHeader, PageTitle, Ring, Stat } from "@/components/ordys/primitives";
import { Button, Field, Select } from "@/components/ordys/form";
import { generateQuiz, type QuizQuestion } from "@/lib/quiz.functions";
import {
  useOrdysMutations,
  useQuizAttempts,
  useSubjects,
  useTopics,
} from "@/lib/ordys-db";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/simulado")({
  head: () => ({
    meta: [
      { title: "Modo prova e simulados — ORDYS" },
      {
        name: "description",
        content:
          "Gere simulados de múltipla escolha a partir das suas disciplinas e conteúdos, responda em modo prova e veja acertos por conteúdo.",
      },
      { property: "og:title", content: "Modo prova e simulados — ORDYS" },
      {
        property: "og:description",
        content: "Simulados gerados pelos seus próprios conteúdos, com correção e explicação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Simulado,
});

const groups = [{ items: ["Novo simulado", "Histórico"] }];

function Simulado() {
  const [active, setActive] = useState("Novo simulado");
  const { data: subjects = [] } = useSubjects();
  const { data: attempts = [] } = useQuizAttempts();
  const { userId, refresh } = useOrdysMutations();
  const runGenerate = useServerFn(generateQuiz);

  const [subjectId, setSubjectId] = useState("");
  const { data: topics = [] } = useTopics(subjectId || null);
  const [difficulty, setDifficulty] = useState<"facil" | "media" | "dificil">("media");
  const [count, setCount] = useState("5");
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [finished, setFinished] = useState(false);

  const subject = subjects.find((s) => s.id === subjectId);
  const correct = questions.filter((q, i) => answers[i] === q.correct_answer).length;

  async function start() {
    if (!subject) return;
    setLoading(true);
    setFinished(false);
    setAnswers({});
    try {
      const res = await runGenerate({
        data: {
          subjectName: subject.name,
          topics: topics.map((t) => t.title).slice(0, 12),
          difficulty,
          questionCount: Number(count),
        },
      });
      if (res.error || !res.questions.length) {
        toast.error(res.error ?? "Nenhuma questão gerada");
        return;
      }
      setQuestions(res.questions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar simulado");
    } finally {
      setLoading(false);
    }
  }

  async function finish() {
    setFinished(true);
    if (!userId || !subject) return;
    try {
      const { data: created, error } = await supabase
        .from("quiz_attempts")
        .insert({
          user_id: userId,
          subject_id: subject.id,
          difficulty,
          question_count: questions.length,
          correct_count: correct,
          status: "concluido",
          finished_at: new Date().toISOString(),
        } as never)
        .select()
        .single();
      if (error) throw new Error(error.message);
      const attemptId = (created as { id: string }).id;
      const rows = questions.map((q, i) => ({
        user_id: userId,
        attempt_id: attemptId,
        topic_id: topics.find((t) => t.title === q.topic)?.id ?? null,
        question: q.question,
        options: q.options,
        correct_answer: q.correct_answer,
        given_answer: answers[i] ?? null,
        is_correct: answers[i] === q.correct_answer,
        explanation: q.explanation,
      }));
      await supabase.from("quiz_answers").insert(rows as never);
      refresh();
      toast.success(`Simulado salvo · ${correct}/${questions.length}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar simulado");
    }
  }

  return (
    <Shell
      contextTitle="Simulados"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Estudos", "Simulado", active]}
    >
      <PageTitle title="Modo prova" subtitle="Questões geradas a partir das suas disciplinas e conteúdos" />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Simulados feitos" value={String(attempts.length)} sub="histórico completo" accent="primary" />
        <Stat
          label="Melhor desempenho"
          value={
            attempts.length
              ? `${Math.max(
                  ...attempts.map((a) =>
                    Math.round(((a.correct_count ?? 0) / Math.max(1, a.question_count)) * 100),
                  ),
                )}%`
              : "—"
          }
          sub="acertos"
          accent="success"
        />
        <Stat
          label="Média de acertos"
          value={
            attempts.length
              ? `${Math.round(
                  (attempts.reduce((acc, a) => acc + (a.correct_count ?? 0) / Math.max(1, a.question_count), 0) /
                    attempts.length) *
                    100,
                )}%`
              : "—"
          }
          sub="todas as tentativas"
        />
      </div>

      {active === "Novo simulado" ? (
        <>
          <Panel className="mt-4 px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Disciplina">
                <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">Selecione</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Dificuldade">
                <Select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as "facil" | "media" | "dificil")}
                >
                  <option value="facil">Fácil</option>
                  <option value="media">Média</option>
                  <option value="dificil">Difícil</option>
                </Select>
              </Field>
              <Field label="Questões">
                <Select value={count} onChange={(e) => setCount(e.target.value)}>
                  {[5, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button onClick={start} disabled={!subjectId || loading}>
                  <Sparkles className="size-[13px]" strokeWidth={1.8} />
                  {loading ? "Gerando…" : "Gerar simulado"}
                </Button>
              </div>
            </div>
            {subjectId && !topics.length ? (
              <p className="mt-3 text-[11.5px] text-muted-foreground">
                Cadastre conteúdos nessa disciplina para questões mais alinhadas ao seu programa.
              </p>
            ) : null}
          </Panel>

          {questions.length ? (
            <Panel className="mt-4">
              <PanelHeader
                title={finished ? "Correção" : "Simulado em andamento"}
                hint={`${Object.keys(answers).length}/${questions.length} respondidas`}
                action={
                  finished ? (
                    <Chip tone={correct / questions.length >= 0.6 ? "success" : "danger"}>
                      {correct}/{questions.length}
                    </Chip>
                  ) : (
                    <Button onClick={finish} disabled={Object.keys(answers).length !== questions.length}>
                      Finalizar
                    </Button>
                  )
                }
              />
              <div className="border-t border-border">
                {questions.map((q, i) => (
                  <div key={i} className="border-b border-border px-5 py-4 last:border-0">
                    <p className="text-[12.5px] font-medium">
                      {i + 1}. {q.question}
                    </p>
                    <div className="mt-2.5 grid gap-1.5">
                      {q.options.map((opt) => {
                        const chosen = answers[i] === opt;
                        const isCorrect = finished && opt === q.correct_answer;
                        const isWrong = finished && chosen && opt !== q.correct_answer;
                        return (
                          <button
                            key={opt}
                            disabled={finished}
                            onClick={() => setAnswers({ ...answers, [i]: opt })}
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12px] transition-colors ${
                              isCorrect
                                ? "border-success/50 bg-success/10"
                                : isWrong
                                  ? "border-destructive/50 bg-destructive/10"
                                  : chosen
                                    ? "border-primary/40 bg-primary-soft"
                                    : "border-border bg-surface hover:border-border-strong"
                            }`}
                          >
                            {isCorrect ? <Check className="size-[13px]" strokeWidth={2} /> : null}
                            {isWrong ? <X className="size-[13px]" strokeWidth={2} /> : null}
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                    {finished && q.explanation ? (
                      <p className="mt-2 text-[11.5px] text-muted-foreground">{q.explanation}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              {finished ? (
                <div className="flex items-center gap-5 border-t border-border px-5 py-4">
                  <Ring value={(correct / questions.length) * 100} size={64} />
                  <div className="flex-1">
                    <p className="text-[12.5px] font-medium">
                      {correct} acertos de {questions.length}
                    </p>
                    <div className="mt-2">
                      <Bar value={(correct / questions.length) * 100} tone={correct / questions.length >= 0.6 ? "success" : "warning"} />
                    </div>
                  </div>
                </div>
              ) : null}
            </Panel>
          ) : null}
        </>
      ) : (
        <Panel className="mt-4">
          <PanelHeader title="Histórico de simulados" hint={`${attempts.length} tentativas`} />
          <div className="border-t border-border">
            {attempts.length ? (
              attempts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate">
                    {subjects.find((s) => s.id === a.subject_id)?.name ?? "Disciplina"}
                  </span>
                  <Chip>{a.difficulty}</Chip>
                  <span className="num text-muted-foreground">
                    {a.correct_count ?? 0}/{a.question_count}
                  </span>
                  <span className="num text-[11px] text-muted-foreground">{a.created_at.slice(0, 10)}</span>
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-[12px] text-muted-foreground">Nenhum simulado realizado ainda.</p>
            )}
          </div>
        </Panel>
      )}
    </Shell>
  );
}
