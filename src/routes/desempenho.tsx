import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, PageTitle, Ring, Stat } from "@/components/ordys/primitives";
import { evolution, goals, pastExams, subjectByKey, subjects } from "@/lib/ordys-data";

export const Route = createFileRoute("/desempenho")({
  head: () => ({
    meta: [
      { title: "Desempenho — ORDYS" },
      {
        name: "description",
        content:
          "Média geral, notas por disciplina, frequência, produtividade, horas estudadas, metas e evolução ao longo do período.",
      },
      { property: "og:title", content: "Desempenho — ORDYS" },
      {
        property: "og:description",
        content: "Veja como você está indo e quanto está evoluindo, em gráficos minimalistas.",
      },
    ],
  }),
  component: Desempenho,
});

const groups = [
  { items: ["Notas", "Frequência", "Produtividade", "Metas", "Evolução"] },
  { label: "Período", items: ["Bimestre atual", "Semestre", "Ano"] },
];

function Desempenho() {
  const [active, setActive] = useState("Notas");

  return (
    <Shell
      contextTitle="Desempenho"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Desempenho", active]}
    >
      <PageTitle
        title="Desempenho"
        subtitle="Seu desempenho melhorou 12% neste período."
        action={<Chip tone="gold">2º bimestre</Chip>}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Média geral" value="8,7" sub="+0,2 no bimestre" accent="primary" />
        <Stat label="Frequência" value="92,5%" sub="Física em atenção" accent="warning" />
        <Stat label="Horas estudadas" value="11h20" sub="novembro" />
        <Stat label="Tarefas concluídas" value="12 / 18" sub="72% no prazo" accent="success" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Panel>
          <PanelHeader title="Evolução da média" hint="março – novembro" />
          <div className="h-[220px] border-t border-border px-3 pt-5 pr-5">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={evolution} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="period"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <YAxis
                  domain={[6, 10]}
                  width={28}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                />
                <Area
                  type="monotone"
                  dataKey="grade"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  fill="url(#g)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Notas por disciplina" hint="média do período" />
          <div className="border-t border-border">
            {subjects.map((s) => (
              <div key={s.key} className="px-5 py-3">
                <div className="mb-1.5 flex items-center gap-2 text-[12.5px]">
                  <Dot color={s.color} />
                  <span>{s.name}</span>
                  <span className="num ml-auto font-semibold">
                    {s.average.toFixed(1).replace(".", ",")}
                  </span>
                </div>
                <Bar value={s.average * 10} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Frequência" hint="limite crítico 75%" />
          <div className="border-t border-border">
            {subjects.slice(0, 5).map((s) => (
              <div key={s.key} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
                <Dot color={s.color} />
                <span className="flex-1">{s.name}</span>
                <span className="num text-muted-foreground">{s.attendance}%</span>
                {s.attendance < 85 ? <Chip tone="warning">atenção</Chip> : null}
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Metas" hint="4 ativas" />
          <div className="border-t border-border">
            {goals.map((g) => (
              <div key={g.title} className="px-5 py-3">
                <div className="mb-1.5 flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate">{g.title}</span>
                  <span className="num text-[11px] text-muted-foreground">{g.progress}%</span>
                </div>
                <Bar value={g.progress} tone={g.progress > 90 ? "success" : "primary"} />
                <p className="mt-1.5 text-[11px] text-muted-foreground">{g.detail}</p>
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel className="flex items-center gap-5 px-5 py-5">
            <Ring value={72} size={78} />
            <div>
              <p className="text-[12.5px] font-medium">Produtividade</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                72% das tarefas entregues no prazo, 9 dias de sequência de estudo.
              </p>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Avaliações concluídas" />
            <div className="border-t border-border">
              {pastExams.map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
                  <Dot color={subjectByKey(e.subject).color} />
                  <span className="min-w-0 flex-1 truncate">
                    {subjectByKey(e.subject).name} · {e.content}
                  </span>
                  <span className="num font-semibold">
                    {e.grade?.toFixed(1).replace(".", ",")}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
