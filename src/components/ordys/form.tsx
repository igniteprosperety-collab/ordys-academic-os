import { useEffect, useId, useRef, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const control =
  "w-full min-h-11 rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50 sm:min-h-9";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string | undefined;
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
    <button type="button"
      {...props}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9",
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
  const dialogId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const focusables = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => element.offsetParent !== null);
        if (!focusables.length) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={subtitle ? `${dialogId}-description` : undefined}
      className="dark fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/70 px-3 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-4 sm:py-10"
    >
      <div ref={dialogRef} tabIndex={-1} className="panel w-full outline-none" style={{ maxWidth: width }}>
        <header className="flex min-w-0 items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={`${dialogId}-title`} className="truncate text-[13.5px] font-semibold tracking-tight">{title}</h2>
            {subtitle ? (
              <p id={`${dialogId}-description`} className="mt-0.5 break-words text-[11.5px] text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <button type="button"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground sm:size-8"
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

/** Confirmação obrigatória para ações destrutivas. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Excluir",
  confirmVariant = "danger",
  loadingLabel = "Removendo…",
  onConfirm,
  onClose,
  loading,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  loadingLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={description} width={420}>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} disabled={loading}>
          {loading ? loadingLabel : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/** Estado vazio com orientação e, quando faz sentido, uma ação. */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="px-5 py-8 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[420px] text-[12px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      {actionLabel && onAction ? (
        <div className="mt-4 flex justify-center">
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      ) : null}
    </div>
  );
}
