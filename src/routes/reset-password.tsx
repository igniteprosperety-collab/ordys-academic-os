import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button, Field, TextInput } from "@/components/ordys/form";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Definir nova senha — ORDYS" },
      {
        name: "description",
        content: "Crie uma nova senha para a sua conta ORDYS e mantenha seus dados acadêmicos protegidos.",
      },
      { property: "og:title", content: "Definir nova senha — ORDYS" },
      { property: "og:description", content: "Redefina a senha da sua conta ORDYS com segurança." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    const isRecovery = hash.includes("type=recovery");
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session || isRecovery) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Use pelo menos 8 caracteres");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Senha atualizada");
      navigate({ to: "/", replace: true });
    } catch {
      toast.error("Não foi possível atualizar a senha. Solicite um novo link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-[380px]">
        <p className="text-[13px] font-semibold tracking-[0.16em] text-primary">ORDYS</p>
        <h1 className="mt-3 text-[22px] leading-tight font-semibold tracking-tight">Definir nova senha</h1>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          {ready
            ? "Escolha uma senha forte com no mínimo 8 caracteres."
            : "Abra esta página pelo link enviado ao seu e-mail para redefinir a senha."}
        </p>

        <form onSubmit={submit} className="panel mt-6 flex flex-col gap-3.5 px-5 py-5">
          <Field label="Nova senha">
            <TextInput
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <Field label="Repetir senha">
            <TextInput
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <Button type="submit" disabled={busy || !ready} className="mt-1 w-full py-2.5">
            Salvar nova senha
          </Button>
        </form>
      </div>
    </div>
  );
}
