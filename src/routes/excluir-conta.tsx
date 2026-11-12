import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { deleteLocalProfile, getActiveLocalProfileId, isDemoMode, stopDemoMode } from "@/lib/demo-mode";
import { signOutCurrentSession } from "@/lib/ordys-session";
import { edgeFunctionUnavailableMessage } from "@/lib/edge-function-errors";
import { Button, ConfirmDialog } from "@/components/ordys/form";
import { OrdysBrandLockup } from "@/components/ordys/brand-lockup";

export const Route = createFileRoute("/excluir-conta")({
  head: () => ({
    meta: [
      { title: "Excluir conta — Ordys Academy" },
      {
        name: "description",
        content: "Solicite a exclusão permanente da conta e dos dados associados ao Ordys Academy.",
      },
    ],
  }),
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  const { user, loading, isDemo } = useAuth();
  const localProfileMode = isDemo || isDemoMode();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [deleteDialogStep, setDeleteDialogStep] = useState<0 | 1 | 2>(0);
  const [accountDeletedNeedsRestart, setAccountDeletedNeedsRestart] = useState(false);

  async function deleteAccount() {
    if (!user || busy) return;
    let accountDeleted = false;
    setBusy(true);
    try {
      if (isDemo || isDemoMode()) {
        const profileId = getActiveLocalProfileId();
        if (profileId) deleteLocalProfile(profileId);
        stopDemoMode();
        setDeleteDialogStep(0);
        toast.success("Dados locais deste perfil foram excluídos.");
        navigate({ to: "/auth", replace: true });
        return;
      }

      const { error } = await supabase.functions.invoke("ordys-delete-account", { body: {} });
      if (error) throw error;
      accountDeleted = true;
      setDeleteDialogStep(0);
      await queryClient.cancelQueries();
      await signOutCurrentSession();
      toast.success("Sua conta e seus dados foram excluídos.");
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      if (accountDeleted) {
        console.error("[account-delete] account deleted but local sign-out could not be confirmed", error);
        await queryClient.cancelQueries().catch(() => undefined);
        queryClient.clear();
        setAccountDeletedNeedsRestart(true);
        toast.error(
          "A conta foi excluída, mas não foi possível confirmar o encerramento da sessão neste dispositivo. Tente novamente.",
        );
      } else {
        toast.error(edgeFunctionUnavailableMessage(error, "account-deletion") ??
          (error instanceof Error ? error.message : "Não foi possível concluir a exclusão."));
      }
    } finally {
      setBusy(false);
    }
  }

  async function retryDeletedAccountSessionCleanup() {
    if (busy) return;
    setBusy(true);
    try {
      await queryClient.cancelQueries();
      await signOutCurrentSession();
      queryClient.clear();
      toast.success("Sessão encerrada. A conta já foi excluída.");
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      console.error("[account-delete] retry local sign-out failed", error);
      queryClient.clear();
      toast.error("A conta já foi excluída, mas a sessão deste aparelho ainda não foi encerrada. Verifique a conexão e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  if (accountDeletedNeedsRestart) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
        <main className="w-full max-w-[480px] panel px-6 py-7">
          <OrdysBrandLockup />
          <h1 className="mt-5 text-[21px] font-semibold tracking-tight">Conta excluída</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Seus dados do ORDYS foram excluídos. O aplicativo não conseguiu confirmar o encerramento da sessão neste dispositivo.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Não solicite outra exclusão. Tente encerrar novamente a sessão deste aparelho.
          </p>
          <Button className="mt-5 w-full" onClick={retryDeletedAccountSessionCleanup} disabled={busy}>
            {busy ? "Encerrando sessão…" : "Tentar encerrar sessão"}
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-background px-4 py-10 text-foreground">
      <main className="mx-auto w-full max-w-[600px]">
        <Link to="/auth" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Voltar para acesso
        </Link>

        <div className="mt-7">
          <OrdysBrandLockup />
          <h1 className="mt-5 text-[24px] font-semibold tracking-tight">Excluir conta</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            Você pode encerrar sua conta e remover os dados associados ao ORDYS. A exclusão é permanente e não pode ser desfeita.
          </p>
        </div>

        <section className="mt-6 panel px-5 py-5">
          {loading ? (
            <p className="text-[12px] text-muted-foreground">Verificando acesso…</p>
          ) : user ? (
            <>
              <p className="text-[12px] text-muted-foreground">
                {localProfileMode ? "Perfil local neste dispositivo." : <>Conta autenticada: <span className="text-foreground">{user.email ?? "e-mail da conta"}</span></>}
              </p>
              <Button className="mt-5 w-full" onClick={() => setDeleteDialogStep(1)} disabled={busy}>
                <Trash2 className="size-4" />
                {localProfileMode ? "Excluir perfil local" : "Excluir permanentemente minha conta"}
              </Button>
              <ConfirmDialog
                open={deleteDialogStep === 1}
                title={localProfileMode ? "Excluir este perfil local?" : "Excluir permanentemente sua conta?"}
                description={localProfileMode
                  ? "O perfil e os dados salvos localmente neste aparelho serão removidos."
                  : "A exclusão removerá sua conta e os dados acadêmicos associados. Você precisará confirmar novamente antes de iniciar a operação."}
                confirmLabel="Continuar"
                confirmVariant="danger"
                loadingLabel="Preparando…"
                onConfirm={() => setDeleteDialogStep(2)}
                onClose={() => setDeleteDialogStep(0)}
              />
              <ConfirmDialog
                open={deleteDialogStep === 2}
                title={localProfileMode ? "Confirmar exclusão do perfil?" : "Confirmar exclusão definitiva?"}
                description={localProfileMode
                  ? "Esta ação remove permanentemente apenas o perfil local selecionado neste dispositivo."
                  : "Esta ação é irreversível. A conta e os dados associados serão excluídos após a confirmação do servidor."}
                confirmLabel={localProfileMode ? "Excluir perfil" : "Excluir minha conta"}
                confirmVariant="danger"
                loadingLabel={localProfileMode ? "Excluindo perfil…" : "Excluindo conta…"}
                onConfirm={() => void deleteAccount()}
                onClose={() => {
                  if (!busy) setDeleteDialogStep(0);
                }}
                loading={busy}
              />
            </>
          ) : (
            <>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Entre na sua conta para confirmar a exclusão com segurança.
              </p>
              <Button className="mt-5 w-full" onClick={() => navigate({ to: "/auth" })}>
                Entrar no ORDYS
              </Button>
            </>
          )}
        </section>

        <p className="mt-4 text-center text-[10.5px] leading-relaxed text-muted-foreground/70">
          Consulte também a <Link to="/privacidade" className="text-primary hover:underline">Política de Privacidade</Link>.
        </p>
      </main>
    </div>
  );
}
