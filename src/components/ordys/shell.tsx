import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckSquare,
  GraduationCap,
  LayoutDashboard,
  LineChart,
  Search,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { notifications } from "@/lib/ordys-data";

const modules = [
  { to: "/", label: "Início", icon: LayoutDashboard },
  { to: "/disciplinas", label: "Disciplinas", icon: BookOpen },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/tarefas", label: "Tarefas", icon: CheckSquare },
  { to: "/estudos", label: "Estudos", icon: GraduationCap },
  { to: "/desempenho", label: "Desempenho", icon: LineChart },
] as const;

export function Rail() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-4">
      <Link to="/" className="mb-4 flex size-8 items-center justify-center">
        <span className="text-[13px] font-semibold tracking-[0.14em] text-primary">O</span>
      </Link>
      {modules.map((m) => {
        const active = m.to === "/" ? path === "/" : path.startsWith(m.to);
        return (
          <Link
            key={m.to}
            to={m.to}
            title={m.label}
            className={cn(
              "group relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors",
              active ? "bg-primary-soft text-primary" : "hover:bg-secondary hover:text-foreground",
            )}
          >
            {active ? (
              <span className="absolute -left-[13px] h-4 w-[2px] rounded-full bg-primary" />
            ) : null}
            <m.icon className="size-[17px]" strokeWidth={1.6} />
          </Link>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-2">
        <Link
          to="/perfil"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Perfil e configurações"
        >
          <Settings className="size-[17px]" strokeWidth={1.6} />
        </Link>
        <Link
          to="/perfil"
          className="grid size-8 place-items-center rounded-full bg-secondary text-[11px] font-semibold ring-1 ring-border"
        >
          LM
        </Link>
      </div>
    </nav>
  );
}

export type ContextGroup = { label?: string; items: string[] };

export function ContextMenu({
  title,
  groups,
  active,
  onSelect,
  footer,
}: {
  title: string;
  groups: ContextGroup[];
  active: string;
  onSelect: (item: string) => void;
  footer?: ReactNode;
}) {
  return (
    <aside className="hidden w-[216px] shrink-0 flex-col border-r border-border bg-background pt-4 lg:flex">
      <p className="px-5 pb-3 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {title}
      </p>
      <div className="flex flex-col gap-4 px-3">
        {groups.map((g, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {g.label ? (
              <p className="px-2 pt-1 pb-1.5 text-[10.5px] tracking-wide text-muted-foreground/70 uppercase">
                {g.label}
              </p>
            ) : null}
            {g.items.map((item) => (
              <button
                key={item}
                onClick={() => onSelect(item)}
                className={cn(
                  "rounded-md px-2.5 py-[7px] text-left text-[13px] transition-colors",
                  active === item
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        ))}
      </div>
      {footer ? <div className="mt-auto p-3">{footer}</div> : null}
    </aside>
  );
}

function NotificationsButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label="Notificações"
      >
        <Bell className="size-[16px]" strokeWidth={1.6} />
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
      </button>
      {open ? (
        <div className="panel absolute right-0 z-20 mt-2 w-[288px] p-1.5">
          <p className="px-2.5 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Notificações
          </p>
          {notifications.map((n) => (
            <div
              key={n.text}
              className="flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-secondary/60"
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <p className="text-[12.5px] leading-snug">{n.text}</p>
              <span className="num ml-auto text-[10.5px] text-muted-foreground">{n.time}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({ breadcrumb }: { breadcrumb: string[] }) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-4 border-b border-border px-6 py-3">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="font-semibold tracking-[0.1em]">ORDYS</span>
        {breadcrumb.map((b, i) => (
          <span key={b} className="flex items-center gap-2 text-muted-foreground">
            <span className="text-border-strong">/</span>
            <span className={i === breadcrumb.length - 1 ? "text-foreground" : ""}>{b}</span>
          </span>
        ))}
      </div>
      <div className="ml-auto hidden items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-muted-foreground md:flex">
        <Search className="size-[14px]" strokeWidth={1.6} />
        <span className="text-[12px]">Buscar disciplinas, tarefas, notas…</span>
        <span className="num ml-4 rounded border border-border px-1.5 text-[10px]">⌘K</span>
      </div>
      <NotificationsButton />
    </header>
  );
}

export function Shell({
  contextTitle,
  groups,
  active,
  onSelect,
  breadcrumb,
  children,
  contextFooter,
}: {
  contextTitle: string;
  groups: ContextGroup[];
  active: string;
  onSelect: (v: string) => void;
  breadcrumb: string[];
  children: ReactNode;
  contextFooter?: ReactNode;
}) {
  return (
    <div className="dark flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Rail />
      <ContextMenu
        title={contextTitle}
        groups={groups}
        active={active}
        onSelect={onSelect}
        footer={contextFooter}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar breadcrumb={breadcrumb} />
        <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1180px] pb-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
