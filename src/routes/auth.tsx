import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/use-auth";
import { Button, Field, TextInput } from "@/components/ordys/form";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar no ORDYS — sua conta acadêmica" },
      {
        name: "description",
        content:
          "Acesse o ORDYS para manter disciplinas, tarefas, provas, sessões de foco e desempenho salvos com segurança na sua conta.",
      },
      { property: "og:title", content: "Entrar no ORDYS" },
      {
        property: "og:description",
        content: "Seus dados acadêmicos, sempre salvos e disponíveis em qualquer dispositivo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

// Client-side throttle (o backend de autenticação também aplica limites).
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 60_000;

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const attempts = useRef(0);
  const blockedUntil = useRef(0);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/", replace: true });
  }, [loading, user, navigate]);

  function throttled() {
    if (Date.now() < blockedUntil.current) {
      const secs = Math.ceil((blockedUntil.current - Date.now()) / 1000);
      toast.error(`Muitas tentativas. Aguarde ${secs}s.`);
      return true;
    }
    return false;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (throttled()) return;
    setBusy(true);
    try {
      if (mode === "criar") {
        if (password.length < 8) {
          toast.error("Use uma senha com pelo menos 8 caracteres");
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name.trim().slice(0, 80) },
          },
        });
        if (error) throw error;
        toast.success("Conta criada. Verifique seu e-mail para confirmar o acesso.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        attempts.current += 1;
        if (attempts.current >= MAX_ATTEMPTS) {
          blockedUntil.current = Date.now() + COOLDOWN_MS;
          attempts.current = 0;
        }
        // Mensagem genérica: não revela se o e-mail existe.
        toast.error("E-mail ou senha inválidos");
        return;
      }
      attempts.current = 0;
      navigate({ to: "/", replace: true });
    } catch {
      toast.error("Não foi possível continuar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    if (!email) {
      toast.error("Informe seu e-mail primeiro");
      return;
    }
    if (throttled()) return;
    blockedUntil.current = Date.now() + 30_000;
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // Sempre a mesma resposta, exista ou não a conta.
    toast.success("Se existir uma conta com este e-mail, o link de redefinição foi enviado.");
  }

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Não foi possível entrar com Google");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-[380px]">
        <p className="text-[13px] font-semibold tracking-[0.16em] text-primary">ORDYS</p>
        <h1 className="mt-3 text-[22px] leading-tight font-semibold tracking-tight">
          {mode === "entrar" ? "Entrar na sua conta" : "Criar sua conta"}
        </h1>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          Suas disciplinas, tarefas, provas e sessões de estudo ficam salvas na sua conta.
        </p>

        <form onSubmit={submit} className="panel mt-6 flex flex-col gap-3.5 px-5 py-5">
          {mode === "criar" ? (
            <Field label="Nome">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
            </Field>
          ) : null}
          <Field label="E-mail">
            <TextInput
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@escola.com"
            />
          </Field>
          <Field label="Senha">
            <TextInput
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <Button type="submit" disabled={busy} className="mt-1 w-full py-2.5">
            {mode === "entrar" ? "Entrar" : "Criar conta"}
          </Button>
          <Button type="button" variant="ghost" onClick={google} className="w-full py-2.5">
            Continuar com Google
          </Button>
        </form>

        <button
          onClick={() => setMode(mode === "entrar" ? "criar" : "entrar")}
          className="mt-4 w-full text-center text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {mode === "entrar" ? "Não tem conta? Criar agora" : "Já tem conta? Entrar"}
        </button>
      </div>
    </div>
  );
}
