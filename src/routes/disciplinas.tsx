import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import { materials, notes, subjects, tasks } from "@/lib/ordys-data";

export const Route = createFileRoute("/disciplinas")({
  head: () => ({
    meta: [
      { title: "Disciplinas — ORDYS" },
      {
        name: "description",
        content:
          "Cada disciplina com professor, sala, horários, notas, frequência, conteúdos, avaliações e materiais em uma única área no ORDYS.",
      },
      { property: "og:title", content: "Disciplinas — ORDYS" },
      {
        property: "og:description",
        content: "Notas, frequência, conteúdos e materiais organizados por disciplina.",
      },
    ],
  }),
  component: Disciplinas,
});

const groups = [
  { items: ["Todas", "Minhas disciplinas", "Materiais", "Notas", "Frequência", "Professores"] },
];

const tabs = ["Visão geral", "Conteúdos", "Tarefas", "Avaliações", "Materiais", "Notas"];

function Disciplinas() {
  const [active, setActive] = useState("Todas");
  const [selected, setSelected] = useState(subjects[0].key);
  const [tab, setTab] = useState(tabs[0]);
  const s = subjects.find((x) => x.key === selected)!;

  return (
    <Shell
      contextTitle="Disciplinas"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Disciplinas", s.name]}
    >
      <PageTitle title="Disciplinas" subtitle="6 disciplinas ativas · Colégio Santa Clara · 2º ano B" />

      <div className="mt-5 flex flex-wrap gap-2">
        {subjects.map((x) => (
          <button
            key={x.key}
            onClick={() => setSelected(x.key)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
              x.key === selected
                ? "border-primary/40 bg-primary-soft text-foreground"
                : "border-border bg-surface text-muted-foreground hover:text-foreground"
            }`}
          >
            <Dot color={x.color} />
            {x.name}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Média atual" value={s.average.toFixed(1).replace(".", ",")} sub="meta 9,0" accent="primary" />
        <Stat label="Frequência" value={`${s.attendance}%`} sub={s.attendance < 85 ? "atenção" : "regular"} accent={s.attendance < 85 ? "warning" : "success"} />
        <Stat label="Próxima aula" value={s.nextClass} sub={s.room} />
        <Stat label="Professor" value={s.teacher.replace("Prof. ", "")} sub="atendimento ter 14h" />
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Panel>
          <PanelHeader title="Conteúdos do período" hint="8 de 12 concluídos" />
          <div className="border-t border-border">
            {[
              ["Funções quadráticas", 100],
              ["Logaritmos", 80],
              ["Progressões aritméticas", 55],
              ["Progressões geométricas", 20],
              ["Trigonometria no triângulo", 0],
            ].map(([label, v]) => (
              <div key={label as string} className="px-5 py-3">
                <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
                  <span>{label}</span>
                  <span className="num text-[11px] text-muted-foreground">{v}%</span>
                </div>
                <Bar value={v as number} />
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="Tarefas da disciplina" />
            <div className="border-t border-border">
              {tasks.slice(0, 3).map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="size-3.5 shrink-0 rounded-[4px] border border-border-strong" />
                  <p className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</p>
                  <span className="num text-[11px] text-muted-foreground">{t.due}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Materiais" hint="organizados por disciplina" />
            <div className="border-t border-border">
              {materials.slice(0, 3).map((m) => (
                <div key={m.name} className="flex items-center gap-3 px-5 py-2.5">
                  <Chip>{m.type}</Chip>
                  <p className="min-w-0 flex-1 truncate text-[12.5px]">{m.name}</p>
                  <span className="num text-[11px] text-muted-foreground">{m.size}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Anotações" />
            <div className="border-t border-border">
              {notes.slice(0, 3).map((n) => (
                <div key={n.title} className="px-5 py-2.5">
                  <p className="text-[12.5px]">{n.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {n.linked} · {n.when}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
