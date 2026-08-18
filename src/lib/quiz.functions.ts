import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  subjectName: z.string().min(1),
  topics: z.array(z.string()).default([]),
  difficulty: z.enum(["facil", "media", "dificil"]).default("media"),
  questionCount: z.number().int().min(3).max(15).default(5),
});

export type QuizQuestion = {
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  topic: string | null;
};

export const generateQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: QuizQuestion[]; error?: string }> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { questions: [], error: "IA indisponível" };

    const prompt = [
      `Gere ${data.questionCount} questões de múltipla escolha em português do Brasil sobre a disciplina "${data.subjectName}".`,
      data.topics.length ? `Conteúdos: ${data.topics.join(", ")}.` : "",
      `Dificuldade: ${data.difficulty}.`,
      "Cada questão deve ter 4 alternativas, uma única correta e uma explicação curta.",
      'Responda APENAS com JSON no formato {"questions":[{"question":"","options":["","","",""],"correct_answer":"","explanation":"","topic":""}]}.',
    ]
      .filter(Boolean)
      .join(" ");

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-3.5-flash",
          messages: [
            { role: "system", content: "Você é um professor que cria simulados objetivos e responde só com JSON válido." },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!res.ok) return { questions: [], error: `Falha na geração (${res.status})` };
      const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = payload.choices?.[0]?.message?.content ?? "";
      const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      const parsed = z
        .object({
          questions: z.array(
            z.object({
              question: z.string(),
              options: z.array(z.string()).min(2),
              correct_answer: z.string(),
              explanation: z.string().default(""),
              topic: z.string().nullable().default(null),
            }),
          ),
        })
        .parse(JSON.parse(json));
      return { questions: parsed.questions };
    } catch {
      return { questions: [], error: "Não foi possível gerar as questões agora." };
    }
  });
