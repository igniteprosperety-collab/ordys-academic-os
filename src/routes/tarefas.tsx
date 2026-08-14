import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Shell } from "@/components/ordys/shell";
import { Bar, Chip, Dot, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import { subjectByKey, tasks, type Task } from "@/lib/ordys-data";

export const Route = createFileRoute("/tarefas")({
  head: () => ({
    meta: [
      { title: "Tarefas — ORDYS" },
      {
        name: "description",
        content:
          "Gerencie tarefas acadêmicas com prazo, prioridade, subtarefas, anexos e estados: não iniciada, em andamento, concluída ou atrasada.",
      },
      { property: "og:title", content: "Tarefas — ORDYS" },
      {
        property: "og:description",
        content: "Hoje, esta semana, próximas, atrasadas e concluídas — sem esforço para entender.",
      },
    ],
  }),
  component: Tarefas,
});

const groups = [
  { items: ["Todas", "Hoje", "Esta semana", "Próximas", "Atrasadas", "Concluídas"] },
  { label: "Por prioridade", items: ["Alta", "Média", "Baixa"] },
];

const statusLabel: Record<Task["status"], string> = {
  nao_iniciada: "Não iniciada",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  atrasada: "Atrasada",
};

function filterTasks(active: string) {
  switch (active) {
    case "Hoje":
      return tasks.filter((t) => t.bucket === "hoje");
    case "Esta semana":
      return tasks.filter((t) => t.bucket === "hoje" || t.bucket === "semana");
    case "Próximas":
      return tasks.filter((t) => t.bucket === "proximas");
    case "Atrasadas":
      return tasks.filter((t) => t.status === "atrasada");
    case "Concluídas":
      return tasks.filter((t) => t.status === "concluida");
    case "Alta":
    case "Média":
    case "Baixa":
      return tasks.filter((t) => t.priority === active.toLowerCase().replace("é", "é"));
    default:
      return tasks;
  }
}

function Tarefas() {
  const [active, setActive] = useState("Todas");
  const list = filterTasks(active);
  const [open, setOpen] = useState(tasks[1]!.id);
  const selected = tasks.find((t) => t.id === open)!;

  return (
    <Shell
      contextTitle="Tarefas"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Tarefas", active]}
    >
      <PageTitle
        title="Tarefas"
        subtitle="6 abertas · 2 atrasadas · 12 concluídas neste período"
        action={
          <button className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            <Plus className="size-[13px]" strokeWidth={2} /> Nova tarefa
          </button>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Hoje" value="1" sub="vence às 22:00" accent="primary" />
        <Stat label="Esta semana" value="2" sub="História e Matemática" />
        <Stat label="Atrasadas" value="2" sub="Física e Literatura" accent="warning" />
        <Stat label="No prazo" value="72%" sub="+8% no mês" accent="success" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title={active} hint={`${list.length} tarefas`} />
          <div className="border-t border-border">
            {list.map((t) => {
              const s = subjectByKey(t.subject);
              return (
                <button
                  key={t.id}
                  onClick={() => setOpen(t.id)}
                  className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-secondary/40 ${
                    open === t.id ? "bg-secondary/50" : ""
                  }`}
                >
                  <span
                    className={`grid size-4 shrink-0 place-items-center rounded-[5px] border ${
                      t.status === "concluida"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border-strong"
                    }`}
                  >
                    {t.status === "concluida" ? <span className="text-[9px]">✓</span> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-[13px] ${
                        t.status === "concluida" ? "text-muted-foreground line-through" : ""
                      }`}
                    >
                      {t.title}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Dot color={s.color} /> {s.name} · {t.due} · {t.subtasks[0]}/{t.subtasks[1]}{" "}
                      subtarefas
                    </p>
                  </div>
                  <Chip
                    tone={
                      t.status === "atrasada"
                        ? "danger"
                        : t.status === "concluida"
                          ? "success"
                          : t.priority === "alta"
                            ? "gold"
                            : "muted"
                    }
                  >
                    {statusLabel[t.status]}
                  </Chip>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Detalhes" hint={subjectByKey(selected.subject).name} />
          <div className="border-t border-border px-5 py-4">
            <p className="text-[14px] font-medium">{selected.title}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone="primary">{selected.due}</Chip>
              <Chip tone="gold">prioridade {selected.priority}</Chip>
              <Chip>{statusLabel[selected.status]}</Chip>
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
              Produzir análise das causas e consequências da Revolução Industrial, com fontes citadas
              e conclusão pessoal. Entrega digital pela plataforma da escola.
            </p>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-[11.5px] text-muted-foreground">
                <span>Subtarefas</span>
                <span className="num">
                  {selected.subtasks[0]}/{selected.subtasks[1]}
                </span>
              </div>
              <Bar value={(selected.subtasks[0] / selected.subtasks[1]) * 100} />
              <div className="mt-3 space-y-2">
                {["Levantar fontes", "Fichamento", "Estrutura do texto", "Redação final"].map(
                  (st, i) => (
                    <div key={st} className="flex items-center gap-2.5 text-[12.5px]">
                      <span
                        className={`grid size-3.5 place-items-center rounded-[4px] border ${
                          i < selected.subtasks[0]
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border-strong"
                        }`}
                      >
                        {i < selected.subtasks[0] ? <span className="text-[8px]">✓</span> : null}
                      </span>
                      <span className={i < selected.subtasks[0] ? "text-muted-foreground" : ""}>
                        {st}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>

            <div className="mt-5 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
              2 anexos · 1 anotação vinculada · sem recorrência
            </div>
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
