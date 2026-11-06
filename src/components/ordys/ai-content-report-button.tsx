import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

type AiContentReportSource = "assistant" | "quiz";
type AiContentReportReason = "offensive" | "unsafe" | "inaccurate" | "personal_data" | "other";

// Keep this control hidden until the production table, RPC and Edge Function are deployed and smoke-tested.
const AI_CONTENT_REPORTS_ENABLED = false;

type AiContentReportButtonProps = {
  source: AiContentReportSource;
  content: string;
  label?: string;
};

const reasons: Array<{ value: AiContentReportReason; label: string }> = [
  { value: "offensive", label: "Conteúdo ofensivo ou discriminatório" },
  { value: "unsafe", label: "Orientação perigosa ou inadequada" },
  { value: "inaccurate", label: "Informação incorreta ou enganosa" },
  { value: "personal_data", label: "Exposição de dados pessoais" },
  { value: "other", label: "Outro problema" },
];

export function AiContentReportButton({
  source,
  content,
  label = "Sinalizar conteúdo",
}: AiContentReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<AiContentReportReason>("offensive");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!AI_CONTENT_REPORTS_ENABLED) return null;

  async function submitReport() {
    const selectedContent = content.trim();
    if (!selectedContent) {
      toast.error("Não há conteúdo disponível para relatar.");
      return;
    }
    if (selectedContent.length > 20_000) {
      toast.error("Este conteúdo é longo demais para ser enviado como relato.");
      return;
    }
    if (details.trim().length > 600) {
      toast.error("A descrição adicional deve ter até 600 caracteres.");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("ordys-ai-report", {
        body: {
          source,
          reason,
          content: selectedContent,
          details: details.trim(),
        },
      });
      if (error) throw error;

      const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
      if (result["status"] !== "received") {
        throw new Error(typeof result["error"] === "string" ? result["error"] : "Não foi possível registrar o relato.");
      }

      toast.success("Relato enviado. Obrigado por ajudar a revisar o conteúdo.");
      setOpen(false);
      setReason("offensive");
      setDetails("");
    } catch {
      toast.error("Não foi possível enviar o relato. Verifique sua conexão e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-9 text-[11px] text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label={label}
      >
        <Flag className="size-3.5" />
        {label}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!submitting) setOpen(next);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sinalizar conteúdo gerado por IA</DialogTitle>
            <DialogDescription>
              Escolha o motivo. O ORDYS enviará somente este conteúdo e a descrição opcional para revisão.
              O restante da conversa e seus anexos não serão incluídos no relato.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block text-[12px] font-medium" htmlFor="ai-content-report-reason">
              Motivo do relato
            </label>
            <select
              id="ai-content-report-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as AiContentReportReason)}
              disabled={submitting}
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {reasons.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>

            <label className="block text-[12px] font-medium" htmlFor="ai-content-report-details">
              Informação adicional (opcional)
            </label>
            <Textarea
              id="ai-content-report-details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={600}
              rows={3}
              disabled={submitting}
              placeholder="Explique brevemente o problema."
              className="text-[12px]"
            />
            <p className="text-right text-[10px] text-muted-foreground">{details.length}/600</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitReport()} disabled={submitting}>
              {submitting ? "Enviando…" : "Enviar relato"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
