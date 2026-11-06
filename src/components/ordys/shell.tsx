import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
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
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications, useOrdysMutations, useProfile } from "@/lib/ordys-db";
import { QuickCapture } from "@/components/ordys/quick-capture";
import { Chip } from "@/components/ordys/primitives";
import { ConfirmDialog } from "@/components/ordys/form";
import { stopDemoMode } from "@/lib/demo-mode";
import { OrdysBrandLockup } from "@/components/ordys/brand-lockup";
import { signOutCurrentSession } from "@/lib/ordys-session";
import { toast } from "sonner";

const modules = [
  { to: "/", label: "Início", icon: LayoutDashboard },
  { to: "/disciplinas", label: "Disciplinas", icon: BookOpen },
  { to: "/agenda", label: "Calendário", icon: CalendarDays },
  { to: "/tarefas", label: "Tarefas", icon: CheckSquare },
  { to: "/estudos", label: "Estudos", icon: GraduationCap },
  { to: "/simulado", label: "Simulados", icon: FileQuestion },
  { to: "/desempenho", label: "Desempenho", icon: LineChart },
  { to: "/assistente", label: "Agente ORDYS", icon: Sparkles },
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
      className="flex w-[60px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-background py-4"
    >
      <Link to="/" className="mb-4" aria-label="ORDYS Academy — Início">
        <OrdysBrandLockup compact />
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
            {active ? <span className="absolute left-0 h-4 w-[2px] rounded-full bg-primary" /> : null}
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
          className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold ring-1 ring-border sm:size-8"
        >
          {initials || "O"}
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
      <p className="px-5 pb-3 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{title}</p>
      <div className="flex flex-col gap-4 px-3">
        {groups.map((g, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {g.label ? <p className="px-2 pt-1 pb-1.5 text-[10.5px] tracking-wide text-muted-foreground/70 uppercase">{g.label}</p> : null}
            {g.items.map((item) => (
              <button type="button"
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
        <button type="button"
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

  async function markRead(id: string) {
    try {
      await update("notifications", id, { read_at: new Date().toISOString() });
    } catch (error) {
      console.error("[notifications] mark read failed", error);
      throw error;
    }
  }

  async function markAllRead() {
    try {
      await Promise.all(
        rows
          .filter((n) => !n.read_at)
          .map((n) => update("notifications", n.id, { read_at: new Date().toISOString() })),
      );
    } catch (error) {
      console.error("[notifications] mark all read failed", error);
      throw error;
    }
  }

  async function dismiss(id: string) {
    try {
      await update("notifications", id, { dismissed_at: new Date().toISOString() });
    } catch (error) {
      console.error("[notifications] dismiss failed", error);
      throw error;
    }
  }

  return (
    <div className="relative">
      <button type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9"
        aria-label={unread ? `Alertas (${unread} não lidos)` : "Alertas"}
      >
        <Bell className="size-[16px]" strokeWidth={1.6} />
        {unread ? <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" /> : null}
      </button>
      {open ? (
        <div className="panel fixed inset-x-3 top-[calc(4rem+env(safe-area-inset-top))] z-30 mt-0 p-1.5 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:w-[330px]">
          <div className="flex items-center justify-between gap-3 px-2.5 py-2">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Centro de alertas</p>
            {unread ? (
              <button type="button"
                onClick={() =>
                  void markAllRead().catch(() => {
                    // Error was logged by the helper; keep the panel usable.
                  })
                }
                className="min-h-11 px-2 text-left text-[11px] text-primary sm:min-h-9"
              >
                Marcar todas como lidas
              </button>
            ) : null}
          </div>
          <div className="flex gap-1 overflow-x-auto px-1.5 pb-2">
            {categories.map((c) => (
              <button type="button"
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
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-border-strong" : "bg-primary")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] leading-snug">{n.title}</p>
                      {n.body ? <p className="mt-0.5 text-[11px] text-muted-foreground">{n.body}</p> : null}
                      <div className="mt-1.5 flex flex-wrap gap-3 text-[10.5px] text-muted-foreground">
                        {n.link ? (
                          <button type="button"
                            className="text-primary"
                            onClick={() => {
                              void markRead(n.id).catch(() => undefined);
                              setOpen(false);
                              navigate({ to: n.link! });
                            }}
                          >
                            Abrir
                          </button>
                        ) : null}
                        {!n.read_at ? <button type="button" className="min-h-11 px-1 text-left sm:min-h-9" onClick={() => void markRead(n.id).catch(() => undefined)}>Marcar como lida</button> : null}
                        <button type="button" className="min-h-11 px-1 text-left sm:min-h-9" onClick={() => void dismiss(n.id).catch(() => undefined)}>Dispensar</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-2.5 py-4 text-[12px] text-muted-foreground">Nenhum alerta por aqui. Assim que houver prazos, provas ou revisões próximas, eles aparecem aqui.</p>
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
  const { isDemo } = useAuth();
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  async function signOut() {
    if (signOutBusy) return;
    setSignOutBusy(true);
    try {
      await queryClient.cancelQueries();
      if (isDemo) {
        stopDemoMode();
      } else {
        await signOutCurrentSession();
      }
      queryClient.clear();
      setSignOutDialogOpen(false);
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      console.error("[auth] sign out failed", error);
      toast.error("Não foi possível confirmar o encerramento da sessão. Verifique sua conexão e tente novamente.");
    } finally {
      setSignOutBusy(false);
    }
  }

  return (
    <header className="flex min-w-0 shrink-0 items-center gap-3 border-b border-border px-4 pt-[calc(0.625rem+env(safe-area-inset-top))] pb-2.5 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px]">
        <span className="shrink-0 font-semibold tracking-[0.1em]">ORDYS</span>
        {breadcrumb.map((b, i) => (
          <span key={b} className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className="text-border-strong">/</span>
            <span className={cn("truncate", i === breadcrumb.length - 1 && "text-foreground")}>{b}</span>
          </span>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {isDemo ? <Chip tone="muted" className="hidden sm:inline-flex">sem conta</Chip> : null}
        <QuickCapture />
        <NotificationsButton />
        <button type="button"
          onClick={() => setSignOutDialogOpen(true)}
          title={isDemo ? "Sair do modo sem conta" : "Sair da conta"}
          aria-label={isDemo ? "Sair do modo sem conta" : "Sair da conta"}
          className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9"
        >
          <LogOut className="size-[15px]" strokeWidth={1.6} />
        </button>
        <ConfirmDialog
          open={signOutDialogOpen}
          title={isDemo ? "Sair do modo sem conta?" : "Sair da sua conta?"}
          description={isDemo
            ? "O progresso local deste dispositivo não será apagado. Você poderá acessá-lo novamente ao entrar por este dispositivo."
            : "A sessão será encerrada neste dispositivo. Seus dados salvos na conta permanecerão disponíveis quando você entrar novamente."}
          confirmLabel="Sair"
          confirmVariant="primary"
          loadingLabel="Encerrando…"
          onConfirm={() => void signOut()}
          onClose={() => {
            if (!signOutBusy) setSignOutDialogOpen(false);
          }}
          loading={signOutBusy}
        />
      </div>
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
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, user, navigate]);

  if (loading || !user) {
    return <div className="dark h-screen h-[100dvh] w-full bg-background" />;
  }

  return (
    <div className="dark flex h-screen h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <Rail />
      <ContextMenu title={contextTitle} groups={groups} active={active} onSelect={onSelect} footer={contextFooter} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar breadcrumb={breadcrumb} />
        <ContextTabs groups={groups} active={active} onSelect={onSelect} />
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1180px] pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
