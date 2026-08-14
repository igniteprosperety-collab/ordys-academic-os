import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <section className={cn("panel", className)}>{children}</section>;
}

export function PanelHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-baseline justify-between gap-4 px-5 pt-4 pb-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {action}
    </header>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "primary" | "gold" | "success" | "warning";
}) {
  return (
    <div className="panel px-4 py-3.5">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "num mt-2 text-[19px] leading-none font-semibold tracking-tight",
          accent === "primary" && "text-primary",
          accent === "gold" && "text-gold",
          accent === "success" && "text-success",
          accent === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function Bar({ value, tone = "primary" }: { value: number; tone?: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(100, value)}%`, background: `var(--${tone})` }}
      />
    </div>
  );
}

export function Ring({
  value,
  size = 64,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} stroke="var(--secondary)" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
          stroke="var(--primary)"
          strokeDasharray={c}
          strokeDashoffset={c - (c * Math.min(100, value)) / 100}
        />
      </svg>
      <span className="num absolute inset-0 flex items-center justify-center text-[12px] font-semibold">
        {label ?? `${value}%`}
      </span>
    </div>
  );
}

export function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

export function Chip({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "gold" | "danger" | "success" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-medium tracking-wide",
        tone === "muted" && "bg-secondary text-muted-foreground",
        tone === "primary" && "bg-primary-soft text-primary",
        tone === "gold" && "bg-gold/12 text-gold",
        tone === "danger" && "bg-destructive/14 text-destructive",
        tone === "success" && "bg-success/12 text-success",
        tone === "warning" && "bg-warning/12 text-warning",
      )}
    >
      {children}
    </span>
  );
}

export function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
