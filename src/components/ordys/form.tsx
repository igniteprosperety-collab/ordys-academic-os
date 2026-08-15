import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[10.5px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, className)} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(control, "min-h-[72px] resize-y", className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(control, "appearance-none", className)}>
      {children}
    </select>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "ghost" &&
          "border border-border bg-surface text-muted-foreground hover:text-foreground",
        variant === "danger" && "border border-destructive/40 text-destructive hover:bg-destructive/10",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div className="dark fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/70 px-4 py-10 backdrop-blur-sm">
      <div className="panel w-full" style={{ maxWidth: width }}>
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-[13.5px] font-semibold tracking-tight">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="size-[15px]" strokeWidth={1.7} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
