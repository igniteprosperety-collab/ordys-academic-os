import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, Lock, UserPlus, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  addLocalProfile,
  getActiveLocalProfile,
  getLocalProfiles,
  startDemoMode,
  switchLocalProfile,
} from "@/lib/demo-mode";
import { Button, Field, TextInput } from "@/components/ordys/form";
import { OrdysBrandLockup } from "@/components/ordys/brand-lockup";
import { resolveSignupSessionOutcome } from "@/lib/signup-confirmation";
import {
  NATIVE_AUTH_EVENT,
  ORDYS_NATIVE_AUTH_REDIRECT_URI,
  expireNativeGoogleSignIn,
  startGoogleSignIn,
  type NativeAuthEventDetail,
} from "@/lib/native-auth";

type AuthMode = "login" | "signup";

function authRedirect(path: string) {
  const configured = import.meta.env["VITE_PUBLIC_APP_URL"]?.trim().replace(/\/$/, "");
  const base = configured || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${path}`;
}

function readableAuthError(message: string) {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (text.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (text.includes("user already registered")) return "Este e-mail já está cadastrado.";
  if (text.includes("password should be at least")) return "Use uma senha mais forte.";
  if (text.includes("email address not authorized")) {
    return "O envio de confirmação de e-mail está restrito na configuração atual do projeto.";
  }
  if (text.includes("email rate limit") || text.includes("rate limit")) {
    return "O serviço de e-mail atingiu o limite de envio. Aguarde alguns minutos e tente novamente.";
  }
  if (text.includes("smtp") || text.includes("email sending")) {
    return "O serviço de e-mail do projeto não conseguiu enviar a mensagem de confirmação agora.";
  }
  if (text.includes("network")) return "Não foi possível conectar. Verifique sua internet.";
  return "Não foi possível concluir essa ação agora.";
}

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Acessar o Ordys Academy — sua conta acadêmica" },
      {
        name: "description",
        content:
          "Entre ou crie sua conta no Ordys Academy para salvar e sincronizar sua rotina acadêmica.",
      },
      { property: "og:title", content: "Acessar o Ordys Academy" },
      {
        property: "og:description",
        content: "Sua rotina acadêmica organizada em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const googleTimeoutRef = useRef<number | null>(null);
  const [authCooldownUntil, setAuthCooldownUntil] = useState(0);
  const [authAttempts, setAuthAttempts] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [localName, setLocalName] = useState("");
  const [showLocalSetup, setShowLocalSetup] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [localProfiles, setLocalProfiles] = useState(getLocalProfiles());
  const [selectedLocalProfileId, setSelectedLocalProfileId] = useState(
    getActiveLocalProfile()?.id ?? "",
  );

  const activeLocal = useMemo(
    () =>
      localProfiles.find((profile) => profile.id === selectedLocalProfileId) ??
      localProfiles[0] ??
      null,
    [localProfiles, selectedLocalProfileId],
  );

  useEffect(() => {
    if (!loading && user) navigate({ to: "/", replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const clearGoogleTimeout = () => {
      if (googleTimeoutRef.current !== null) {
        window.clearTimeout(googleTimeoutRef.current);
        googleTimeoutRef.current = null;
      }
    };

    const onNativeAuth = (event: Event) => {
      const detail = (event as CustomEvent<NativeAuthEventDetail>).detail;
      if (!detail) return;

      clearGoogleTimeout();
      setBusy(false);
      setGoogleBusy(false);

      if (detail.purpose === "recovery") {
        if (detail.status === "success") {
          navigate({ to: "/redefinir-senha", replace: true });
          return;
        }
        if (detail.status === "cancelled") {
          toast.message("Recuperação cancelada. Você pode solicitar um novo link.");
          return;
        }
        toast.error(
          detail.message ?? "Não foi possível concluir a recuperação. Solicite um novo link.",
        );
        return;
      }

      if (detail.status === "success") {
        navigate({ to: "/", replace: true });
        return;
      }

      if (detail.status === "cancelled") {
        toast.message("Acesso com Google cancelado. Você pode tentar novamente.");
        return;
      }

      toast.error(detail.message ?? "Não foi possível concluir o acesso com Google.");
    };

    window.addEventListener(NATIVE_AUTH_EVENT, onNativeAuth);
    return () => {
      clearGoogleTimeout();
      window.removeEventListener(NATIVE_AUTH_EVENT, onNativeAuth);
    };
  }, [navigate]);

  function clearAuthForm() {
    setEmail("");
    setPassword("");
    setFullName("");
    setShowPassword(false);
  }

  async function submitAuth() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      toast.error("Informe seu e-mail.");
      return;
    }
    if (cleanEmail.length > 320) {
      toast.error("O e-mail deve ter no máximo 320 caracteres.");
      return;
    }

    if (authCooldownUntil > Date.now()) {
      const seconds = Math.max(1, Math.ceil((authCooldownUntil - Date.now()) / 1000));
      toast.error(`Aguarde ${seconds}s antes de tentar novamente.`);
      return;
    }

    if (!password) {
      toast.error("Informe sua senha.");
      return;
    }

    if (mode === "signup" && password.length < 8) {
      toast.error("Use uma senha com pelo menos 8 caracteres.");
      return;
    }

    const cleanName = fullName.trim();
    if (mode === "signup" && !cleanName) {
      toast.error("Informe seu nome.");
      return;
    }
    if (mode === "signup" && cleanName.length > 120) {
      toast.error("O nome deve ter no máximo 120 caracteres.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) {
          const nextAttempts = authAttempts + 1;
          setAuthAttempts(nextAttempts);
          if (nextAttempts >= 5) {
            setAuthCooldownUntil(Date.now() + 60_000);
            setAuthAttempts(0);
          }
          throw error;
        }
        setAuthAttempts(0);
        setAuthCooldownUntil(0);
        toast.success("Acesso realizado.");
        navigate({ to: "/", replace: true });
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { full_name: cleanName },
          emailRedirectTo: Capacitor.isNativePlatform()
            ? ORDYS_NATIVE_AUTH_REDIRECT_URI
            : authRedirect("/auth"),
        },
      });
      if (error) throw error;

      if (data.session) {
        setAuthAttempts(0);
        setAuthCooldownUntil(0);
        toast.success("Conta criada.");
        navigate({ to: "/", replace: true });
        return;
      }

      // Try the supplied password even if the signup response lacks a
      // confirmation timestamp: a database trigger may have confirmed the
      // account before Auth returns its user snapshot.
      if (data.user?.email) {
        const outcome = await resolveSignupSessionOutcome(
          data.user.email_confirmed_at,
          async () => {
            const { error: signInError } = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password,
            });
            return { error: signInError };
          },
        );

        if (outcome === "signed-in") {
          setAuthAttempts(0);
          setAuthCooldownUntil(0);
          toast.success("Conta criada e acesso iniciado.");
          navigate({ to: "/", replace: true });
          return;
        }

        if (outcome === "login-required") {
          setConfirmationEmail("");
          setMode("login");
          setEmail(cleanEmail);
          setPassword("");
          setFullName("");
          toast.message("Sua conta já está confirmada. Entre com seu e-mail e senha.");
          return;
        }

        if (outcome === "retry-login") {
          setConfirmationEmail("");
          setMode("login");
          setEmail(cleanEmail);
          setPassword("");
          setFullName("");
          toast.message(
            "Conta criada. Não foi possível iniciar a sessão automaticamente. Tente entrar novamente; se a confirmação estiver habilitada, confira seu e-mail.",
          );
          return;
        }
      }

      toast.success("Conta criada. Confira seu e-mail para confirmar o cadastro.");
      setConfirmationEmail(cleanEmail);
      setMode("login");
      clearAuthForm();
    } catch (error) {
      toast.error(readableAuthError(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (busy) return;

    if (googleTimeoutRef.current !== null) {
      window.clearTimeout(googleTimeoutRef.current);
      googleTimeoutRef.current = null;
    }

    setBusy(true);
    setGoogleBusy(true);
    googleTimeoutRef.current = window.setTimeout(() => {
      googleTimeoutRef.current = null;
      if (Capacitor.isNativePlatform()) {
        // The native event listener owns the single timeout message and state reset.
        expireNativeGoogleSignIn();
        return;
      }
      setBusy(false);
      setGoogleBusy(false);
      toast.error("A tentativa de acesso expirou. Tente novamente.");
    }, 60_000);

    try {
      if (Capacitor.isNativePlatform()) {
        await startGoogleSignIn(authRedirect("/"));
        return;
      }

      await startGoogleSignIn(authRedirect("/"));
      return;
    } catch (error) {
      if (!Capacitor.isNativePlatform()) {
        toast.error(readableAuthError(error instanceof Error ? error.message : String(error)));
      }
      if (googleTimeoutRef.current !== null) {
        window.clearTimeout(googleTimeoutRef.current);
        googleTimeoutRef.current = null;
      }
      setBusy(false);
      setGoogleBusy(false);
    }
  }

  function continueWithoutAccount() {
    if (localProfiles.length) {
      try {
        switchLocalProfile(selectedLocalProfileId || localProfiles[0]!.id);
        const active = getActiveLocalProfile();
        toast.success(`Modo sem conta · ${active?.name ?? "perfil"}`);
        navigate({ to: "/", replace: true });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Não foi possível abrir o perfil.");
      }
      return;
    }
    setLocalName("");
    setShowLocalSetup(true);
  }

  function createLocalProfile() {
    try {
      const name = localName.trim();
      if (!name) {
        toast.error("Informe seu nome.");
        return;
      }
      addLocalProfile(name);
      setLocalProfiles(getLocalProfiles());
      setSelectedLocalProfileId(getActiveLocalProfile()?.id ?? "");
      startDemoMode();
      toast.success("Perfil local criado. Seu progresso ficará salvo neste dispositivo.");
      navigate({ to: "/", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o perfil.");
    }
  }

  return (
    <div className="dark flex min-h-screen min-h-[100dvh] items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-[410px]">
        <OrdysBrandLockup />
        <div className="mt-5 text-center">
          <h1 className="text-[24px] font-semibold tracking-tight">
            {mode === "login" ? "Entrar no ORDYS" : "Criar sua conta"}
          </h1>
          <p className="mx-auto mt-2 max-w-[360px] text-[12.5px] leading-relaxed text-muted-foreground">
            {mode === "login"
              ? "Salve sua rotina e mantenha seu progresso sincronizado em seus dispositivos."
              : "Crie sua conta para manter sua rotina acadêmica salva e sincronizada."}
          </p>
        </div>

        <div className="mt-6 panel px-5 py-5">
          <div className="grid grid-cols-2 rounded-lg border border-border p-1">
            <button
              type="button"
              className={`min-h-11 rounded-md px-3 py-2 text-[12px] font-medium transition-colors ${mode === "login" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
              onClick={() => {
                setMode("login");
                clearAuthForm();
              }}
              aria-pressed={mode === "login"}
            >
              Entrar
            </button>
            <button
              type="button"
              className={`min-h-11 rounded-md px-3 py-2 text-[12px] font-medium transition-colors ${mode === "signup" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
              onClick={() => {
                setMode("signup");
                clearAuthForm();
              }}
              aria-pressed={mode === "signup"}
            >
              Criar conta
            </button>
          </div>

          {mode === "signup" ? (
            <div className="space-y-3">
              <Field label="Nome">
                <div className="relative">
                  <UserPlus className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <TextInput
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Seu nome"
                    maxLength={120}
                    className="pl-9"
                    autoComplete="name"
                    disabled={busy}
                  />
                </div>
              </Field>
            </div>
          ) : null}

          <div className="mt-3">
            <Field label="E-mail">
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <TextInput
                  type="email"
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="voce@exemplo.com"
                  className="pl-9"
                  autoComplete={mode === "login" ? "email" : "email"}
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitAuth();
                  }}
                />
              </div>
            </Field>
          </div>

          <div className="mt-3">
            <Field
              label="Senha"
              hint={mode === "signup" ? "Use pelo menos 8 caracteres." : undefined}
            >
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <TextInput
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Sua senha"
                  className="pr-10 pl-9"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitAuth();
                  }}
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

          {confirmationEmail ? (
            <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-3">
              <p className="text-[11.5px] font-medium">Confirmação pendente</p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                Verifique também Spam, Promoções e Lixeira. Se a mensagem não aparecer, você pode
                solicitar outro e-mail.
              </p>
              <Button
                type="button"
                variant="ghost"
                className="mt-2 w-full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const { error } = await supabase.auth.resend({
                      type: "signup",
                      email: confirmationEmail,
                      options: {
                        emailRedirectTo: Capacitor.isNativePlatform()
                          ? ORDYS_NATIVE_AUTH_REDIRECT_URI
                          : authRedirect("/auth"),
                      },
                    });
                    if (error) throw error;
                    toast.success("Novo e-mail de confirmação enviado.");
                  } catch (error) {
                    toast.error(readableAuthError(error instanceof Error ? error.message : String(error)));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reenviar confirmação
              </Button>
            </div>
          ) : null}

          <Button
            type="button"
            className="mt-4 w-full py-2.5"
            onClick={submitAuth}
            disabled={busy}
          >
            {busy ? "Processando…" : mode === "login" ? "Entrar" : "Criar conta"}
          </Button>

          {mode === "login" ? (
            <Link
              to="/redefinir-senha"
              className="mt-3 block text-center text-[11.5px] text-primary hover:underline"
            >
              Esqueci minha senha
            </Link>
          ) : null}

          <div className="my-4 flex items-center gap-3 text-[10.5px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>ou entre com</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button type="button" onClick={google} disabled={busy} className="w-full py-2.5">
            {googleBusy ? "Abrindo Google…" : "Continuar com Google"}
          </Button>

          <div className="my-4 h-px bg-border" />

          <Button
            type="button"
            variant="ghost"
            onClick={continueWithoutAccount}
            disabled={busy}
            className="w-full py-2.5"
          >
            Usar sem conta neste dispositivo
          </Button>

          {localProfiles.length ? (
            <div className="mt-3 rounded-lg border border-border px-3 py-3">
              <p className="text-[11.5px] font-medium">Perfis locais</p>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                Cada pessoa pode manter um progresso separado neste aparelho.
              </p>
              <select
                className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary sm:h-9"
                value={selectedLocalProfileId}
                onChange={(event) => setSelectedLocalProfileId(event.target.value)}
                aria-label="Selecionar perfil local"
              >
                {localProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={continueWithoutAccount}
                  disabled={busy}
                >
                  Entrar no perfil
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowLocalSetup(true)}
                  disabled={busy}
                >
                  Novo perfil
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex justify-center gap-4 text-[10.5px] text-muted-foreground/70">
            <Link to="/privacidade" className="hover:text-foreground hover:underline">Política de Privacidade</Link>
            <Link to="/excluir-conta" className="hover:text-foreground hover:underline">Excluir conta</Link>
          </div>

          <p className="mt-4 text-center text-[10.5px] leading-relaxed text-muted-foreground/70">
            Com uma conta, o ORDYS pode guardar e sincronizar seus dados. No modo sem conta, o
            progresso fica apenas neste aparelho.
          </p>
        </div>

        {showLocalSetup ? (
          <div className="mt-3 panel px-5 py-5 ordys-motion-enter">
            <p className="text-[13px] font-semibold">Novo perfil local</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              Apenas um nome é necessário. Nenhum e-mail será usado.
            </p>
            <div className="mt-4">
              <Field label="Nome">
                <TextInput
                  autoFocus
                  value={localName}
                  onChange={(event) => setLocalName(event.target.value)}
                  placeholder="Seu nome"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createLocalProfile();
                  }}
                />
              </Field>
            </div>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" onClick={createLocalProfile} disabled={!localName.trim()}>
                Começar
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowLocalSetup(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}

        {activeLocal && !showLocalSetup ? (
          <button
            type="button"
            className="mt-4 min-h-11 w-full rounded-md px-2 text-center text-[11.5px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={continueWithoutAccount}
          >
            Continuar como {activeLocal.name}
          </button>
        ) : null}
      </div>
    </div>
  );
}
