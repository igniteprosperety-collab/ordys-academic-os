import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/ordys/shell";
import { Chip, Panel, PanelHeader, PageTitle } from "@/components/ordys/primitives";
import { notifications } from "@/lib/ordys-data";

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil e preferências — ORDYS" },
      {
        name: "description",
        content:
          "Perfil do estudante do ensino médio ou universidade: instituição, curso, série ou semestre, notificações, aparência e privacidade.",
      },
      { property: "og:title", content: "Perfil e preferências — ORDYS" },
      {
        property: "og:description",
        content: "O ORDYS adapta as informações conforme o perfil acadêmico do estudante.",
      },
    ],
  }),
  component: Perfil,
});

const groups = [
  { items: ["Perfil", "Notificações", "Aparência", "Preferências", "Privacidade"] },
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Perfil() {
  const [active, setActive] = useState("Perfil");

  return (
    <Shell
      contextTitle="Perfil"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Perfil", active]}
    >
      <PageTitle title="Perfil" subtitle="O ORDYS adapta os campos ao seu tipo de instituição." />

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="flex items-center gap-4 px-5 py-5">
            <div className="grid size-14 place-items-center rounded-full bg-secondary text-[16px] font-semibold ring-1 ring-border">
              LM
            </div>
            <div>
              <p className="text-[15px] font-semibold">Lucas Moreira</p>
              <p className="text-[12px] text-muted-foreground">
                Colégio Santa Clara · 2º ano B · manhã
              </p>
              <div className="mt-2 flex gap-2">
                <Chip tone="primary">Ensino médio</Chip>
                <Chip tone="gold">Plano premium</Chip>
              </div>
            </div>
          </div>
          <div className="border-t border-border">
            <Row label="Instituição" value="Colégio Santa Clara" />
            <Row label="Série / turma" value="2º ano · B" />
            <Row label="Período" value="Manhã" />
            <Row label="Disciplinas ativas" value="6" />
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="Modo universitário" hint="opcional" />
            <div className="border-t border-border">
              <Row label="Curso" value="—" />
              <Row label="Semestre" value="—" />
              <Row label="Créditos" value="—" />
              <p className="px-5 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Ao mudar o tipo de instituição, o ORDYS troca série e turma por curso, semestre e
                créditos — sem alterar a interface.
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Notificações" hint="úteis, não invasivas" />
            <div className="border-t border-border">
              {notifications.map((n) => (
                <div key={n.text} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="size-1.5 rounded-full bg-primary" />
                  <p className="min-w-0 flex-1 truncate text-[12.5px]">{n.text}</p>
                  <span className="num text-[10.5px] text-muted-foreground">{n.time}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
