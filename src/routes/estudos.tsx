import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, PageTitle, Ring, Stat } from "@/components/ordys/primitives";
import { materials, notes, studyPlan, subjectByKey } from "@/lib/ordys-data";

export const Route = createFileRoute("/estudos")({
  head: () => ({
    meta: [
      { title: "Estudos e foco — ORDYS" },
      {
        name: "description",
        content:
          "Plano de estudos, sessões de foco com pomodoro, revisões espaçadas, flashcards, anotações e materiais em uma central de aprendizagem.",
      },
      { property: "og:title", content: "Estudos e foco — ORDYS" },
      {
        property: "og:description",
        content: "Estude com intenção: plano semanal, foco cronometrado e revisões no tempo certo.",
      },
    ],
  }),
  component: Estudos,
});

const groups = [
  { items: ["Plano de estudos", "Sessões de foco", "Revisões", "Flashcards", "Anotações", "Materiais"] },
];

function Estudos() {
  const [active, setActive] = useState("Plano de estudos");

  return (
    <Shell
      contextTitle="Estudos"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Estudos", active]}
    >
      <PageTitle title="Estudos" subtitle="4h54 estudadas esta semana · meta de 8h" />

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel>
          <PanelHeader title="Plano de estudos" hint="semana 10 – 16 nov" />
          <div className="border-t border-border">
            {studyPlan.map((p) => {
              const s = subjectByKey(p.subject);
              return (
                <div key={p.subject} className="px-5 py-3.5">
                  <div className="mb-2 flex items-center gap-2 text-[12.5px]">
                    <Dot color={s.color} />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">{p.target}</span>
                    <span className="num ml-auto text-[11.5px] text-muted-foreground">{p.done}%</span>
                  </div>
                  <Bar value={p.done} tone={p.done < 40 ? "warning" : "primary"} />
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel className="flex flex-col items-center px-6 py-7">
          <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Sessão de foco</p>
          <div className="mt-5">
            <Ring value={38} size={148} label="45:00" />
          </div>
          <p className="mt-5 text-[13px] font-medium">Matemática</p>
          <p className="text-[11.5px] text-muted-foreground">Lista de exercícios</p>
          <button className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-[12.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            <Play className="size-[13px]" strokeWidth={2} /> Iniciar foco
          </button>
          <div className="mt-3 flex w-full items-center justify-between text-[11px] text-muted-foreground">
            <span>Pomodoro 45 / 10</span>
            <span className="flex items-center gap-1.5">
              <RotateCcw className="size-[11px]" strokeWidth={1.6} /> 3 sessões hoje
            </span>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Horas no mês" value="11h20" sub="+12% vs. outubro" accent="success" />
        <Stat label="Revisões pendentes" value="5" sub="2 vencendo hoje" accent="warning" />
        <Stat label="Flashcards" value="184" sub="86% de acerto" />
        <Stat label="Sequência" value="9 dias" sub="melhor: 14 dias" accent="gold" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Revisões" hint="repetição espaçada" />
          <div className="border-t border-border">
            {[
              ["Funções quadráticas", "hoje", "mat"],
              ["Cinemática", "hoje", "fis"],
              ["Citologia", "amanhã", "bio"],
              ["Revolução Industrial", "em 3 dias", "his"],
            ].map(([label, when, key]) => (
              <div key={label} className="flex items-center gap-3 px-5 py-2.5">
                <Dot color={subjectByKey(key as never).color} />
                <p className="min-w-0 flex-1 truncate text-[12.5px]">{label}</p>
                <Chip tone={when === "hoje" ? "primary" : "muted"}>{when}</Chip>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Anotações" hint="vinculadas" />
          <div className="border-t border-border">
            {notes.map((n) => (
              <div key={n.title} className="px-5 py-2.5">
                <p className="truncate text-[12.5px]">{n.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Dot color={subjectByKey(n.subject).color} /> {n.linked} · {n.when}
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Materiais" hint="biblioteca" />
          <div className="border-t border-border">
            {materials.map((m) => (
              <div key={m.name} className="flex items-center gap-3 px-5 py-2.5">
                <Chip>{m.type}</Chip>
                <p className="min-w-0 flex-1 truncate text-[12.5px]">{m.name}</p>
                <span className="num text-[10.5px] text-muted-foreground">{m.size}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
