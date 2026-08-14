import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUpRight, Clock, Play } from "lucide-react";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, Ring, Stat } from "@/components/ordys/primitives";
import {
  attentionItems,
  exams,
  studyPlan,
  subjectByKey,
  subjects,
  tasks,
  today,
  weekDays,
} from "@/lib/ordys-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ORDYS — Sistema operacional da sua vida acadêmica" },
      {
        name: "description",
        content:
          "ORDYS reúne agenda, tarefas, estudos, notas e desempenho em um único painel premium para estudantes do ensino médio e da universidade.",
      },
      { property: "og:title", content: "ORDYS — Discipline your day. Learn with purpose." },
      {
        property: "og:description",
        content:
          "Painel acadêmico inteligente: o que você tem hoje, o que precisa fazer e como está evoluindo.",
      },
    ],
  }),
  component: Home,
});

const groups = [
  { items: ["Hoje", "Semana", "Atenção", "Progresso"] },
  { label: "Atalhos", items: ["Sessão de foco", "Nova tarefa", "Notificações"] },
];

function Home() {
  const [active, setActive] = useState("Hoje");
  const nextExamIndex = 0;
  const nextExam = exams[nextExamIndex]!;
  const late = tasks.filter((t) => t.status === "atrasada").length;

  return (
    <Shell
      contextTitle="Início"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Início", active]}
      contextFooter={
        <div className="panel px-3 py-3">
          <p className="text-[11px] text-muted-foreground">Semana atual</p>
          <p className="num mt-1 text-[15px] font-semibold">4h54 <span className="text-[11px] font-normal text-muted-foreground">de 8h</span></p>
          <div className="mt-2">
            <Bar value={61} />
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] leading-tight font-semibold tracking-tight">Olá, Lucas</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Aqui está sua rotina acadêmica. Terça, 11 de novembro.
          </p>
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
          <Play className="size-[13px]" strokeWidth={2} />
          Iniciar foco
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Próxima aula" value="10:30" sub="Matemática · Sala 204" accent="primary" />
        <Stat label="Próxima tarefa" value="Hoje 22:00" sub="Lista de exercícios · MAT" />
        <Stat label="Próxima prova" value="Em 3 dias" sub="Matemática · peso 3" />
        <Stat label="Pendências" value={`${late} atrasadas`} sub="6 tarefas abertas" accent="warning" />
        <Stat label="Média geral" value="8,7" sub="+0,2 neste período" accent="success" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Panel>
          <PanelHeader
            title="Visão do dia"
            hint="7 blocos"
            action={<Chip tone="primary">Agora · 10:12</Chip>}
          />
          <div className="border-t border-border">
            {today.map((b, i) => {
              const s = subjectByKey(b.subject);
              const current = i === 2;
              return (
                <div
                  key={b.start}
                  className="flex items-center gap-4 px-5 py-2.5 transition-colors hover:bg-secondary/40"
                >
                  <span className="num w-[74px] text-[12px] text-muted-foreground">
                    {b.start}–{b.end}
                  </span>
                  <span className="h-7 w-[2px] rounded-full" style={{ background: s.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{b.label}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {b.room} · {b.kind === "aula" ? s.teacher : "Bloco de estudo"}
                    </p>
                  </div>
                  {current ? <Chip tone="primary">em 18 min</Chip> : null}
                  {b.kind === "estudo" ? <Chip>foco</Chip> : null}
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="O que precisa da sua atenção" />
            <div className="border-t border-border">
              {attentionItems.map((a) => (
                <div key={a.text} className="flex gap-3 px-5 py-3">
                  <span
                    className="mt-[6px] size-1.5 shrink-0 rounded-full"
                    style={{ background: `var(--${a.tone})` }}
                  />
                  <div>
                    <p className="text-[12.5px] leading-snug">{a.text}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{a.meta}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Semana" hint="10 – 16 nov" />
            <div className="grid grid-cols-7 gap-1.5 border-t border-border px-4 py-4">
              {weekDays.map((d) => (
                <div key={d.date} className="flex flex-col items-center gap-2">
                  <span className="text-[10.5px] text-muted-foreground">{d.label}</span>
                  <span
                    className={`num grid size-7 place-items-center rounded-md text-[12px] ${
                      d.active ? "bg-primary text-primary-foreground" : "bg-secondary"
                    }`}
                  >
                    {d.date}
                  </span>
                  <div className="flex h-10 w-full flex-col justify-end gap-[3px]">
                    {Array.from({ length: d.load }).map((_, i) => (
                      <span key={i} className="h-[3px] rounded-full bg-primary/35" />
                    ))}
                    {d.exams ? <span className="h-[3px] rounded-full bg-gold" /> : null}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Tarefas de hoje" action={<Chip>3 abertas</Chip>} />
          <div className="border-t border-border">
            {tasks.slice(0, 4).map((t) => {
              const s = subjectByKey(t.subject);
              return (
                <div key={t.id} className="flex items-start gap-3 px-5 py-2.5">
                  <span className="mt-[3px] size-3.5 shrink-0 rounded-[4px] border border-border-strong" />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px]">{t.title}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Dot color={s.color} /> {s.name} · {t.due}
                    </p>
                  </div>
                  {t.status === "atrasada" ? <Chip tone="danger">atrasada</Chip> : null}
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Próxima prova" />
          <div className="border-t border-border px-5 py-4">
            <p className="text-[14px] font-semibold">{subjectByKey(nextExam.subject).name}</p>
            <p className="num mt-1 text-[12px] text-muted-foreground">{nextExam.date}</p>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              {nextExam.content}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Chip tone="gold">{nextExam.weight}</Chip>
              <Chip tone="primary">em {nextExam.inDays} dias</Chip>
            </div>
            <p className="mt-4 border-t border-border pt-3 text-[12px] text-muted-foreground">
              Você precisa melhorar <span className="text-foreground">0,6 ponto</span> para atingir
              sua meta de 9,0.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Progresso" hint="este período" />
          <div className="flex items-center gap-5 border-t border-border px-5 py-4">
            <Ring value={72} size={72} />
            <div className="flex-1 space-y-2.5">
              {studyPlan.slice(0, 3).map((p) => {
                const s = subjectByKey(p.subject);
                return (
                  <div key={p.subject}>
                    <div className="mb-1 flex items-center justify-between text-[11.5px]">
                      <span className="flex items-center gap-1.5">
                        <Dot color={s.color} /> {s.name}
                      </span>
                      <span className="num text-muted-foreground">{p.done}%</span>
                    </div>
                    <Bar value={p.done} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-[11.5px] text-muted-foreground">
            <Clock className="size-[13px]" strokeWidth={1.6} />
            11h estudadas em novembro
            <ArrowUpRight className="ml-auto size-[13px] text-success" strokeWidth={1.8} />
            <span className="text-success">+12%</span>
          </div>
        </Panel>
      </div>

      <Panel className="mt-4">
        <PanelHeader title="Disciplinas" hint="6 ativas · 2º semestre" />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border lg:grid-cols-3">
          {subjects.map((s) => (
            <div key={s.key} className="bg-surface px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Dot color={s.color} />
                <p className="text-[13px] font-medium">{s.name}</p>
                <span className="num ml-auto text-[13px] font-semibold">
                  {s.average.toFixed(1).replace(".", ",")}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {s.teacher} · próxima aula {s.nextClass}
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Bar value={s.attendance} tone={s.attendance < 85 ? "warning" : "primary"} />
                <span className="num text-[10.5px] text-muted-foreground">{s.attendance}%</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <p className="mt-8 text-center text-[11px] tracking-[0.14em] text-muted-foreground/70 uppercase">
        Ordys · Discipline your day. Learn with purpose.
      </p>
    </Shell>
  );
}
