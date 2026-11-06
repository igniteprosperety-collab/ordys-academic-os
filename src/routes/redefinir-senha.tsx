import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { Mail, Lock, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { signOutCurrentSession } from "@/lib/ordys-session";
import { Button, Field, TextInput } from "@/components/ordys/form";
import { OrdysBrandLockup } from "@/components/ordys/brand-lockup";
import { resolveRecoveryScreenMode } from "@/lib/password-recovery-session";
import {
  markNativeRecoveryPending,
  ORDYS_NATIVE_AUTH_REDIRECT_URI,
} from "@/lib/native-auth";

function authRedirect(path: string) {
  const configured = import.meta.env["VITE_PUBLIC_APP_URL"]?.trim().replace(/\/$/, "");
  const base = configured || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${path}`;
}

function readableAuthError(message: string) {
  const text = message.toLowerCase();
  if (text.includes("expired") || text.includes("invalid")) {
    return "Este link não é mais válido. Solicite uma nova recuperação.";
  }
  if (text.includes("rate limit") || text.includes("muitas solicitações")) {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  if (text.includes("network")) return "Não foi possível conectar. Verifique sua internet.";
  if (text.includes("password")) {
    return "Não foi possível atualizar a senha. Verifique os requisitos e tente novamente.";
  }
  return "Não foi possível concluir essa ação agora.";
}

export const Route = createFileRoute("/redefinir-senha")({
  head: () => ({
    meta: [
      { title: "Redefinir senha — Ordys Academy" },
      {
        name: "description",
        content: "Recupere o acesso ou defina uma nova senha para sua conta Ordys Academy.",
      },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [requestMode, setRequestMode] = useState(true);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [sent, setSent] = useState(false);
  const [recoveryCooldownUntil, setRecoveryCooldownUntil] = useState(0);
  const [passwordUpdatedNeedsRetry, setPasswordUpdatedNeedsRetry] = useState(false);
  const [otherSessionsRevoked, setOtherSessionsRevoked] = useState(false);

  useEffect(() => {
    let mounted = true;
    let authStateChanged = false;

    const syncSession = async () => {
      const result = await resolveRecoveryScreenMode(() => supabase.auth.getSession());
      if (!mounted || authStateChanged) return;
      if (result.status === "fallback") {
        console.warn(
          "[auth] recovery session could not be verified; showing the recovery request form",
        );
      }
      setRequestMode(result.mode === "request");
      setChecking(false);
    };

    void syncSession();

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY") {
        authStateChanged = true;
        setRequestMode(false);
        setChecking(false);
        return;
      }
      if (event === "SIGNED_OUT") {
        authStateChanged = true;
        setRequestMode(true);
        setChecking(false);
        return;
      }
      if (session && event !== "USER_UPDATED") {
        authStateChanged = true;
        setRequestMode(false);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function requestRecovery() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      toast.error("Informe seu e-mail.");
      return;
    }
    if (cleanEmail.length > 320) {
      toast.error("O e-mail deve ter no máximo 320 caracteres.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      toast.error("Informe um e-mail válido.");
      return;
    }

    if (recoveryCooldownUntil > Date.now()) {
      const seconds = Math.max(1, Math.ceil((recoveryCooldownUntil - Date.now()) / 1000));
      toast.error(`Aguarde ${seconds}s antes de solicitar outro link.`);
      return;
    }

    setBusy(true);
    try {
      if (Capacitor.isNativePlatform()) {
        markNativeRecoveryPending();
      }

      const redirectTo = Capacitor.isNativePlatform()
        ? ORDYS_NATIVE_AUTH_REDIRECT_URI
        : authRedirect("/redefinir-senha");

      const { data: recoveryResult, error: recoveryError } = await supabase.functions.invoke(
        "ordys-password-recovery",
        {
          body: {
            email: cleanEmail,
            redirectTo,
          },
        },
      );

      if (recoveryError) {
        if (Capacitor.isNativePlatform()) {
          window.localStorage.removeItem("ordys:native-recovery-pending-v1");
        }
        let message = recoveryError.message;
        const context = (recoveryError as Error & { context?: unknown }).context;
        if (context instanceof Response) {
          const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
          if (typeof payload?.error === "string" && payload.error.trim()) {
            message = payload.error;
          }
        }
        throw new Error(message);
      }

      if (
        !recoveryResult ||
        typeof recoveryResult !== "object" ||
        (recoveryResult as { status?: unknown }).status !== "completed"
      ) {
        if (Capacitor.isNativePlatform()) {
          window.localStorage.removeItem("ordys:native-recovery-pending-v1");
        }
        const message = recoveryResult && typeof recoveryResult === "object" &&
          typeof (recoveryResult as { error?: unknown }).error === "string"
          ? (recoveryResult as { error: string }).error
          : "Não foi possível concluir a recuperação agora.";
        throw new Error(message);
      }

      setRecoveryCooldownUntil(Date.now() + 60_000);
      setSent(true);
    } catch (error) {
      toast.error(readableAuthError(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  async function finishPasswordRecovery() {
    let revokedOtherSessions = otherSessionsRevoked;

    try {
      if (!revokedOtherSessions) {
        // Revoke every other device first. The "others" scope retains this
        // device's session when the server request fails, allowing a safe retry.
        await signOutCurrentSession({ scope: "others" });
        revokedOtherSessions = true;
        setOtherSessionsRevoked(true);
      }

      // Only clear this device after the server has confirmed the other-session revoke.
      await signOutCurrentSession();
      toast.success("Senha atualizada. Entre novamente com sua nova senha.");
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      console.error("[auth] password updated but session cleanup is incomplete", error);
      setPasswordUpdatedNeedsRetry(true);
      setOtherSessionsRevoked(revokedOtherSessions);
      toast.error(
        revokedOtherSessions
          ? "As sessões dos outros dispositivos foram revogadas, mas ainda não foi possível encerrar a sessão neste aparelho. Tente novamente."
          : "Sua senha foi atualizada, mas não foi possível confirmar a revogação das sessões em outros dispositivos. Sua sessão atual foi mantida para permitir nova tentativa.",
      );
    }
  }

  async function retryPasswordSessionCleanup() {
    setBusy(true);
    try {
      await finishPasswordRecovery();
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword() {
    if (password.length < 8) {
      toast.error("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      toast.error("As senhas não conferem.");
      return;
    }

    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setRequestMode(true);
        toast.error("O link de recuperação não está mais válido. Solicite um novo link.");
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      await finishPasswordRecovery();
    } catch (error) {
      toast.error(readableAuthError(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  if (passwordUpdatedNeedsRetry) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
        <main className="w-full max-w-[480px] panel px-6 py-7">
          <OrdysBrandLockup />
          <h1 className="mt-5 text-[21px] font-semibold tracking-tight">Senha atualizada</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            {otherSessionsRevoked
              ? "As sessões dos outros dispositivos foram revogadas. Falta apenas encerrar a sessão deste aparelho."
              : "Não foi possível confirmar a revogação das sessões em outros dispositivos. A sessão deste aparelho foi mantida para permitir uma nova tentativa."}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Não é necessário redefinir sua senha novamente. Mantenha esta tela aberta e tente concluir o encerramento das sessões.
          </p>
          <Button
            type="button"
            className="mt-5 w-full"
            onClick={retryPasswordSessionCleanup}
            disabled={busy}
          >
            {busy ? "Tentando novamente…" : otherSessionsRevoked ? "Encerrar sessão neste aparelho" : "Tentar novamente"}
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="dark flex min-h-screen min-h-[100dvh] items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-[410px]">
        <button
          type="button"
          onClick={() => navigate({ to: "/auth" })}
          className="mb-5 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Voltar para acesso
        </button>

        <div className="text-center">
          <OrdysBrandLockup />
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight">
            {requestMode ? "Recuperar acesso" : "Redefinir senha"}
          </h1>
        </div>

        <div className="mt-6 panel px-5 py-5">
          {checking ? (
            <p className="text-center text-[12px] text-muted-foreground">Verificando acesso…</p>
          ) : requestMode ? (
            sent ? (
              <div className="text-center">
                <p className="text-[13px] font-semibold">Confira seu e-mail</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  Se houver uma conta do ORDYS com esse e-mail, enviaremos as instruções de recuperação. Verifique também a pasta de spam.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-5 w-full"
                  onClick={() => {
                    setSent(false);
                    setEmail("");
                  }}
                >
                  Usar outro e-mail
                </Button>
              </div>
            ) : (
              <>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Informe o e-mail da sua conta e enviaremos um link para recuperar o acesso.
                </p>

                <div className="mt-5">
                  <Field label="E-mail">
                    <div className="relative">
                      <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                      <TextInput
                        type="email"
                        maxLength={320}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void requestRecovery();
                        }}
                        placeholder="voce@exemplo.com"
                        autoComplete="email"
                        className="pl-9"
                        disabled={busy}
                      />
                    </div>
                  </Field>
                </div>

                <Button
                  type="button"
                  className="mt-5 w-full py-2.5"
                  onClick={requestRecovery}
                  disabled={busy}
                >
                  {busy ? "Enviando…" : "Enviar link de recuperação"}
                </Button>
              </>
            )
          ) : (
            <>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                Escolha uma nova senha para voltar a acessar sua conta.
              </p>

              <div className="mt-5">
                <Field label="Nova senha" hint="Use pelo menos 8 caracteres.">
                  <div className="relative">
                    <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <TextInput
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="pr-10 pl-9"
                      autoComplete="new-password"
                      placeholder="Nova senha"
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground sm:size-8"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </Field>
              </div>

              <div className="mt-3">
                <Field label="Confirmar senha">
                  <div className="relative">
                    <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <TextInput
                      type={showConfirmation ? "text" : "password"}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void updatePassword();
                      }}
                      className="pr-10 pl-9"
                      autoComplete="new-password"
                      placeholder="Repita sua senha"
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmation((value) => !value)}
                      className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground sm:size-8"
                      aria-label={showConfirmation ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showConfirmation ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </Field>
              </div>

              <Button
                type="button"
                className="mt-5 w-full py-2.5"
                onClick={updatePassword}
                disabled={busy || !password || !confirmation}
              >
                {busy ? "Atualizando…" : "Atualizar senha"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
