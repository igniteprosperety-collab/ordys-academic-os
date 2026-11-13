import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { deleteLocalProfile, getActiveLocalProfileId, isDemoMode, stopDemoMode } from "@/lib/demo-mode";
import { signOutCurrentSession } from "@/lib/ordys-session";
import { withAuthRequestTimeout } from "@/lib/auth-request-timeout";
import { isInconclusiveFunctionRequestError } from "@/lib/function-request-outcome";
import { edgeFunctionUnavailableMessage } from "@/lib/edge-function-errors";
import {
  isConfirmedAccountDeletionResponse,
  isUnconfirmedAuthIdentityDeletionPayload,
} from "@/lib/account-deletion-outcome";
import { Button, ConfirmDialog } from "@/components/ordys/form";
import { OrdysBrandLockup } from "@/components/ordys/brand-lockup";

async function isAuthIdentityDeletionUnconfirmed(error: unknown): Promise<boolean> {
  if (!error || typeof error !== "object" || !("context" in error)) return false;
  const context = (error as { context?: unknown }).context;
  if (typeof Response === "undefined" || !(context instanceof Response) || context.status !== 502) {
    return false;
  }
  const payload = await withAuthRequestTimeout(
    () => context.clone().json(),
    3_000,
  ).catch(() => null);
  return isUnconfirmedAuthIdentityDeletionPayload(payload);
}

async function getAccountDeletionConflictCode(error: unknown): Promise<string | null> {
  if (!error || typeof error !== "object" || !("context" in error)) return null;
  const context = (error as { context?: unknown }).context;
  if (typeof Response === "undefined" || !(context instanceof Response) || context.status !== 409) {
    return null;
  }
  const payload = await withAuthRequestTimeout(
    () => context.clone().json(),
    3_000,
  ).catch(() => null) as { code?: unknown } | null;
  return typeof payload?.code === "string" ? payload.code : null;
}

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
  const deleteActionInFlightRef = useRef(false);
  const [deleteDialogStep, setDeleteDialogStep] = useState<0 | 1 | 2>(0);
  const [accountDeletedNeedsRestart, setAccountDeletedNeedsRestart] = useState(false);
  const [deleteOutcomeUnknown, setDeleteOutcomeUnknown] = useState(false);
  const [accountDeletionPartial, setAccountDeletionPartial] = useState(false);
  const [checkoutCancellationPending, setCheckoutCancellationPending] = useState(false);
  const [checkoutCreationInProgress, setCheckoutCreationInProgress] = useState(false);
  const [accountDeletionInProgress, setAccountDeletionInProgress] = useState(false);

  async function deleteAccount() {
    if (!user || busy || deleteActionInFlightRef.current) return;
    deleteActionInFlightRef.current = true;
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

      const { data, error } = await withAuthRequestTimeout(() =>
        supabase.functions.invoke("ordys-delete-account", { body: {} }),
      );
      if (error) throw error;
      if (!isConfirmedAccountDeletionResponse(data)) {
        // A 2xx envelope without the endpoint's explicit deleted=true contract
        // cannot be treated as proof of completed destructive cleanup.
        throw new Error("O servidor não confirmou a conclusão da exclusão da conta.");
      }
      accountDeleted = true;
      setDeleteDialogStep(0);
      await queryClient.cancelQueries();
      await signOutCurrentSession();
      toast.success("Sua conta e seus dados foram excluídos.");
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      const conflictCode = accountDeleted ? null : await getAccountDeletionConflictCode(error);
      if (accountDeleted) {
        console.error("[account-delete] account deleted but local sign-out could not be confirmed", error);
        await queryClient.cancelQueries().catch(() => undefined);
        queryClient.clear();
        setAccountDeletedNeedsRestart(true);
        toast.error(
          "A conta foi excluída, mas não foi possível confirmar o encerramento da sessão neste dispositivo. Tente novamente.",
        );
      } else if (conflictCode === "checkout_creation_in_progress") {
        setDeleteDialogStep(0);
        setCheckoutCreationInProgress(true);
        toast.message("Uma contratação ainda está sendo iniciada. Nenhum dado foi apagado.");
      } else if (conflictCode === "account_deletion_in_progress") {
        setDeleteDialogStep(0);
        setAccountDeletionInProgress(true);
        toast.message("Já existe uma solicitação de exclusão em processamento. Nenhum dado foi apagado.");
      } else if (
        conflictCode === "checkout_cancellation_processing" ||
        conflictCode === "billing_cancellation_processing" ||
        conflictCode === "billing_reconciliation_required"
      ) {
        setDeleteDialogStep(0);
        setCheckoutCancellationPending(true);
        toast.message("O estado ou cancelamento das cobranças está aguardando confirmação do Asaas. Nenhum dado foi apagado.");
      } else if (await isAuthIdentityDeletionUnconfirmed(error)) {
        await queryClient.cancelQueries().catch(() => undefined);
        queryClient.clear();
        setDeleteDialogStep(0);
        setAccountDeletionPartial(true);
        toast.error("Os dados do Ordys foram removidos, mas a exclusão do login não foi confirmada. Verifique o acesso antes de repetir.");
      } else if (isInconclusiveFunctionRequestError(error)) {
        // A transport failure or server-side timeout may happen after the
        // deletion request has already reached the Edge Function. Do not allow
        // a second destructive request until the account state is verified.
        await queryClient.cancelQueries().catch(() => undefined);
        queryClient.clear();
        setDeleteOutcomeUnknown(true);
        toast.error(
          "O servidor não confirmou o resultado da exclusão. A solicitação pode ter sido concluída; verifique o acesso antes de tentar novamente.",
        );
      } else {
        toast.error(edgeFunctionUnavailableMessage(error, "account-deletion") ??
          (error instanceof Error ? error.message : "Não foi possível concluir a exclusão."));
      }
    } finally {
      deleteActionInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function verifyDeletionAccess() {
    if (busy || deleteActionInFlightRef.current) return;
    deleteActionInFlightRef.current = true;
    setBusy(true);
    try {
      // Drop the possibly stale local session before asking the person to
      // verify the account again. /auth redirects authenticated users home.
      await queryClient.cancelQueries();
      await signOutCurrentSession();
      queryClient.clear();
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      console.error("[account-delete] could not clear the session for verification", error);
      toast.error(
        "Não foi possível encerrar a sessão deste aparelho. O resultado da exclusão continua sem confirmação; tente verificar novamente.",
      );
    } finally {
      deleteActionInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function retryDeletedAccountSessionCleanup() {
    if (busy || deleteActionInFlightRef.current) return;
    deleteActionInFlightRef.current = true;
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
      deleteActionInFlightRef.current = false;
      setBusy(false);
    }
  }

  if (accountDeletionPartial) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
        <main className="w-full max-w-[480px] panel px-6 py-7">
          <OrdysBrandLockup />
          <h1 className="mt-5 text-[21px] font-semibold tracking-tight">Exclusão parcialmente concluída</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Os dados do Ordys foram removidos, mas o servidor não confirmou se a conta de login foi excluída. O acesso pode continuar ativo.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Não repita a exclusão agora. Encerre a sessão e verifique o acesso. Se ainda conseguir entrar, solicite novamente a exclusão para concluir o encerramento da conta.
          </p>
          <Button className="mt-5 w-full" onClick={verifyDeletionAccess} disabled={busy}>
            {busy ? "Encerrando sessão…" : "Encerrar sessão e verificar"}
          </Button>
        </main>
      </div>
    );
  }

  if (deleteOutcomeUnknown) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
        <main className="w-full max-w-[480px] panel px-6 py-7">
          <OrdysBrandLockup />
          <h1 className="mt-5 text-[21px] font-semibold tracking-tight">Resultado não confirmado</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            O servidor demorou a responder. A exclusão pode ter sido concluída ou interrompida antes de terminar.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Não envie outro pedido de exclusão agora. Verifique primeiro se sua conta ainda permite acesso.
          </p>
          <Button className="mt-5 w-full" onClick={verifyDeletionAccess} disabled={busy}>
            {busy ? "Preparando acesso…" : "Verificar acesso"}
          </Button>
        </main>
      </div>
    );
  }

  if (checkoutCreationInProgress) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
        <main className="w-full max-w-[480px] panel px-6 py-7">
          <OrdysBrandLockup />
          <h1 className="mt-5 text-[21px] font-semibold tracking-tight">Contratação em andamento</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Uma contratação ainda está sendo criada. O Ordys não excluirá sua conta enquanto não puder confirmar o estado do Checkout.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Aguarde a atualização da cobrança e tente novamente. Nenhum dado foi apagado.
          </p>
          <Button className="mt-5 w-full" onClick={() => navigate({ to: "/perfil" })}>
            Voltar ao perfil
          </Button>
        </main>
      </div>
    );
  }

  if (accountDeletionInProgress) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
        <main className="w-full max-w-[480px] panel px-6 py-7">
          <OrdysBrandLockup />
          <h1 className="mt-5 text-[21px] font-semibold tracking-tight">Exclusão em processamento</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Já existe uma solicitação de exclusão desta conta em andamento. O Ordys bloqueou uma segunda operação para evitar cancelamentos duplicados.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Aguarde a conclusão ou a conciliação com o Asaas antes de tentar novamente. Nenhum dado foi apagado por esta tentativa.
          </p>
          <Button className="mt-5 w-full" onClick={() => navigate({ to: "/perfil" })}>
            Voltar ao perfil
          </Button>
        </main>
      </div>
    );
  }

  if (checkoutCancellationPending) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
        <main className="w-full max-w-[480px] panel px-6 py-7">
          <OrdysBrandLockup />
          <h1 className="mt-5 text-[21px] font-semibold tracking-tight">Cancelamento não confirmado</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            O Ordys não conseguiu confirmar o estado ou o encerramento de todas as cobranças no Asaas. Não repetirá automaticamente operações de cancelamento cujo resultado é incerto.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Sua conta e seus dados ainda não foram excluídos. Não envie outra solicitação de exclusão enquanto os cancelamentos pendentes não forem conciliados com o Asaas.
          </p>
          <Button className="mt-5 w-full" onClick={() => navigate({ to: "/perfil" })}>
            Voltar ao perfil
          </Button>
        </main>
      </div>
    );
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
        <Link
          to="/auth"
          onClick={(event) => {
            if (deleteActionInFlightRef.current) event.preventDefault();
          }}
          aria-disabled={busy}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-secondary hover:text-foreground ${busy ? "pointer-events-none opacity-50" : ""}`}
        >
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
