import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Shell } from "@/components/ordys/shell";
import { Chip, Dot, Panel, PanelHeader, PageTitle } from "@/components/ordys/primitives";
import { exams, subjectByKey, subjects, today, weekDays } from "@/lib/ordys-data";

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — ORDYS" },
      {
        name: "description",
        content:
          "Dia, semana e mês em um só calendário: aulas, provas, trabalhos, tarefas e compromissos pessoais identificados por disciplina.",
      },
      { property: "og:title", content: "Agenda — ORDYS" },
      {
        property: "og:description",
        content: "Calendário acadêmico completo com visualizações de dia, semana e mês.",
      },
    ],
  }),
  component: Agenda,
});

const groups = [{ items: ["Hoje", "Semana", "Mês", "Aulas", "Provas", "Eventos"] }];
const hours = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"];

function Agenda() {
  const [active, setActive] = useState("Semana");

  return (
    <Shell
      contextTitle="Agenda"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Agenda", active]}
    >
      <PageTitle
        title="Agenda"
        subtitle="10 – 16 de novembro · 26 blocos, 2 avaliações"
        action={
          <button className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] transition-colors hover:bg-secondary">
            <Plus className="size-[13px]" strokeWidth={1.8} /> Novo evento
          </button>
        }
      />

      <div className="mt-5 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 lg:w-fit">
        {["Dia", "Semana", "Mês"].map((v) => (
          <button
            key={v}
            onClick={() => setActive(v === "Dia" ? "Hoje" : v)}
            className={`rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
              (active === "Hoje" && v === "Dia") || active === v
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <Panel className="mt-4 overflow-hidden">
        <PanelHeader
          title="Semana"
          hint="aulas identificadas por disciplina"
          action={
            <div className="flex flex-wrap gap-2">
              {subjects.slice(0, 4).map((s) => (
                <span key={s.key} className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <Dot color={s.color} /> {s.short}
                </span>
              ))}
            </div>
          }
        />
        <div className="grid grid-cols-[52px_repeat(7,1fr)] border-t border-border text-[11px]">
          <div />
          {weekDays.map((d) => (
            <div
              key={d.date}
              className={`border-l border-border px-2 py-2 text-center ${d.active ? "bg-primary-soft" : ""}`}
            >
              <p className="text-muted-foreground">{d.label}</p>
              <p className="num text-[13px] font-medium">{d.date}</p>
            </div>
          ))}
          {hours.map((h, hi) => (
            <div key={h} className="col-span-8 grid grid-cols-[52px_repeat(7,1fr)] border-t border-border">
              <div className="num py-2 pr-2 text-right text-muted-foreground">{h}:00</div>
              {weekDays.map((d, di) => {
                const block = today[(hi + di) % today.length]!;
                const show = (hi + di) % 3 === 0 && hi < 10;
                const s = subjectByKey(block.subject);
                const exam = di === 2 && hi === 3;
                return (
                  <div key={d.date} className="min-h-[34px] border-l border-border p-[3px]">
                    {exam ? (
                      <div className="h-full rounded-md border border-gold/40 bg-gold/10 px-1.5 py-1">
                        <p className="truncate text-[10px] font-medium text-gold">Prova · MAT</p>
                      </div>
                    ) : show ? (
                      <div
                        className="h-full rounded-md px-1.5 py-1"
                        style={{
                          background: "color-mix(in oklab, var(--primary) 12%, transparent)",
                          borderLeft: `2px solid ${s.color}`,
                        }}
                      >
                        <p className="truncate text-[10px]">{s.short}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Hoje" hint="terça, 11 nov" />
          <div className="border-t border-border">
            {today.map((b) => {
              const s = subjectByKey(b.subject);
              return (
                <div key={b.start} className="flex items-center gap-4 px-5 py-2.5">
                  <span className="num w-[70px] text-[12px] text-muted-foreground">{b.start}</span>
                  <span className="h-6 w-[2px] rounded-full" style={{ background: s.color }} />
                  <p className="min-w-0 flex-1 truncate text-[12.5px]">{b.label}</p>
                  <span className="text-[11px] text-muted-foreground">{b.room}</span>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Provas e entregas" hint="próximos 30 dias" />
          <div className="border-t border-border">
            {exams.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                <Dot color={subjectByKey(e.subject).color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px]">
                    {subjectByKey(e.subject).name} — {e.title}
                  </p>
                  <p className="num mt-0.5 text-[11px] text-muted-foreground">{e.date}</p>
                </div>
                <Chip tone={e.inDays <= 3 ? "gold" : "muted"}>em {e.inDays} dias</Chip>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
