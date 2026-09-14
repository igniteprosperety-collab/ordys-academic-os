import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckSquare,
  FileQuestion,
  GraduationCap,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications, useOrdysMutations, useProfile } from "@/lib/ordys-db";
import { QuickCapture } from "@/components/ordys/quick-capture";
import { Button } from "@/components/ordys/form";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const modules = [
  { to: "/", label: "Início", icon: LayoutDashboard },
  { to: "/disciplinas", label: "Disciplinas", icon: BookOpen },
  { to: "/agenda", label: "Calendário", icon: CalendarDays },
  { to: "/tarefas", label: "Tarefas", icon: CheckSquare },
  { to: "/estudos", label: "Estudos", icon: GraduationCap },
  { to: "/simulado", label: "Simulados", icon: FileQuestion },
  { to: "/desempenho", label: "Desempenho", icon: LineChart },
] as const;

const isActive = (path: string, to: string) => (to === "/" ? path === "/" : path.startsWith(to));

export function Rail() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: profile } = useProfile();
  const initials = (profile?.full_name ?? "ORDYS")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <nav
      aria-label="Navegação principal"
      className="hidden w-[60px] shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-4 md:flex"
    >
      <Link to="/" className="mb-4 flex size-8 items-center justify-center" aria-label="ORDYS — Início">
        <span className="text-[13px] font-semibold tracking-[0.14em] text-primary">O</span>
      </Link>
      {modules.map((m) => {
        const active = isActive(path, m.to);
        return (
          <Link
            key={m.to}
            to={m.to}
            title={m.label}
            aria-label={m.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
          className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Configurações"
          aria-label="Configurações"
        >
          <Settings className="size-[17px]" strokeWidth={1.6} />
        </Link>
        <Link
          to="/perfil"
          aria-label="Seu perfil"
          className="grid size-8 place-items-center rounded-full bg-secondary text-[11px] font-semibold ring-1 ring-border"
        >
          {initials || "O"}
        </Link>
      </div>
    </nav>
  );
}

function MobileMenu() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
          aria-label="Abrir navegação"
        >
          <Menu className="size-5" strokeWidth={1.7} />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="dark w-[min(88vw,320px)] overflow-y-auto p-0 text-foreground">
        <SheetHeader className="border-b border-border px-5 py-5 text-left">
          <SheetTitle className="text-[15px] tracking-[0.12em] text-primary">ORDYS ACADEMY</SheetTitle>
          <SheetDescription>A clareza por trás da sua rotina.</SheetDescription>
        </SheetHeader>
        <nav aria-label="Navegação principal" className="grid gap-1 p-3">
        {[...modules, { to: "/perfil", label: "Configurações", icon: Settings } as const].map((m) => {
          const active = isActive(path, m.to);
          return (
            <SheetClose key={m.to} asChild>
              <Link
                to={m.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors",
                  active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <m.icon className="size-[18px] shrink-0" strokeWidth={1.7} />
                <span>{m.label}</span>
              </Link>
            </SheetClose>
          );
        })}
        </nav>
      </SheetContent>
    </Sheet>
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
                aria-pressed={active === item}
                className={cn(
                  "rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
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

/** Mesmos filtros da coluna lateral, acessíveis em telas pequenas. */
function ContextTabs({
  groups,
  active,
  onSelect,
}: {
  groups: ContextGroup[];
  active: string;
  onSelect: (item: string) => void;
}) {
  const items = groups.flatMap((g) => g.items);
  if (!items.length) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto border-b border-border px-4 py-2 lg:hidden">
      {items.map((item) => (
        <button
          key={item}
          onClick={() => onSelect(item)}
          aria-pressed={active === item}
          className={cn(
            "min-h-11 shrink-0 rounded-lg border px-3 text-[12.5px] transition-colors",
            active === item
              ? "border-primary/40 bg-primary-soft text-foreground"
              : "border-border bg-surface text-muted-foreground",
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

const categories = [
  { key: "todas", label: "Todas" },
  { key: "tarefas", label: "Tarefas" },
  { key: "agenda", label: "Calendário" },
  { key: "estudos", label: "Estudos" },
  { key: "desempenho", label: "Desempenho" },
];

function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState("todas");
  const { data: rows = [] } = useNotifications();
  const { update } = useOrdysMutations();
  const navigate = useNavigate();

  const visible = rows.filter((n) => cat === "todas" || n.category === cat);
  const unread = rows.filter((n) => !n.read_at).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label={unread ? `Alertas (${unread} não lidos)` : "Alertas"}
      >
        <Bell className="size-[16px]" strokeWidth={1.6} />
        {unread ? <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" /> : null}
      </button>
      {open ? (
        <div className="panel fixed inset-x-3 z-30 mt-2 p-1.5 sm:absolute sm:inset-x-auto sm:right-0 sm:w-[330px]">
          <div className="flex items-center justify-between gap-3 px-2.5 py-2">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Centro de alertas
            </p>
            {unread ? (
              <button
                onClick={() =>
                  rows
                    .filter((n) => !n.read_at)
                    .forEach((n) => update("notifications", n.id, { read_at: new Date().toISOString() }))
                }
                className="text-[11px] text-primary"
              >
                Marcar todas como lidas
              </button>
            ) : null}
          </div>
          <div className="flex gap-1 overflow-x-auto px-1.5 pb-2">
            {categories.map((c) => (
              <button
                key={c.key}
                onClick={() => setCat(c.key)}
                aria-pressed={cat === c.key}
                className={cn(
                  "min-h-11 shrink-0 rounded-md px-2 text-[11px] transition-colors",
                  cat === c.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {visible.length ? (
              visible.map((n) => (
                <div key={n.id} className="rounded-md px-2.5 py-2 hover:bg-secondary/60">
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        n.read_at ? "bg-border-strong" : "bg-primary",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] leading-snug">{n.title}</p>
                      {n.body ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{n.body}</p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap gap-3 text-[10.5px] text-muted-foreground">
                        {n.link ? (
                          <button
                            className="text-primary"
                            onClick={() => {
                              update("notifications", n.id, { read_at: new Date().toISOString() });
                              setOpen(false);
                              navigate({ to: n.link! });
                            }}
                          >
                            Abrir
                          </button>
                        ) : null}
                        {!n.read_at ? (
                          <button onClick={() => update("notifications", n.id, { read_at: new Date().toISOString() })}>
                            Marcar como lida
                          </button>
                        ) : null}
                        <button
                          onClick={() => update("notifications", n.id, { dismissed_at: new Date().toISOString() })}
                        >
                          Dispensar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-2.5 py-4 text-[12px] text-muted-foreground">
                Nenhum alerta por aqui. Assim que houver prazos, provas ou revisões próximas, eles aparecem aqui.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({ breadcrumb }: { breadcrumb: string[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5 sm:px-6">
      <MobileMenu />
      <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
        <span className="shrink-0 font-semibold tracking-[0.1em]">ORDYS</span>
        {breadcrumb.map((b, i) => (
          <span key={b} className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className="text-border-strong">/</span>
            <span className={cn("truncate", i === breadcrumb.length - 1 && "text-foreground")}>{b}</span>
          </span>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <QuickCapture />
        <NotificationsButton />
        <button
          onClick={signOut}
          title="Sair da conta"
          aria-label="Sair da conta"
          className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <LogOut className="size-[15px]" strokeWidth={1.6} />
        </button>
      </div>
    </header>
  );
}

function AuthWall() {
  return (
    <div className="dark flex min-h-screen w-full items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-[360px] text-center">
        <p className="text-[13px] font-semibold tracking-[0.16em] text-primary">ORDYS</p>
        <h1 className="mt-3 text-[20px] font-semibold tracking-tight">Entre para continuar</h1>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Disciplinas, tarefas, provas, sessões de foco e desempenho ficam salvos na sua conta.
        </p>
        <Link to="/auth" className="mt-5 inline-block">
          <Button>Entrar no ORDYS</Button>
        </Link>
      </div>
    </div>
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
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="dark h-screen w-full bg-background" />;
  }
  if (!user) return <AuthWall />;

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
        <ContextTabs groups={groups} active={active} onSelect={onSelect} />
        <main className="flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1180px] pb-24 md:pb-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
