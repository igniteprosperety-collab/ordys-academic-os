import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ordys/form";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar no ORDYS — sua conta acadêmica" },
      {
        name: "description",
        content:
          "Acesse o ORDYS com sua conta Google.",
      },
      { property: "og:title", content: "Entrar no ORDYS" },
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/", replace: true });
  }, [loading, user, navigate]);

  async function google() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });

      if (result.error) throw result.error;
      if (result.redirected) return;

      navigate({ to: "/", replace: true });
    } catch {
      toast.error("Não foi possível iniciar o acesso com Google.");
      setBusy(false);
    }
  }

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-[380px]">
        <p className="text-[13px] font-semibold tracking-[0.16em] text-primary">ORDYS</p>
        <h1 className="mt-3 text-[22px] leading-tight font-semibold tracking-tight">
          Entrar no ORDYS
        </h1>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          Entre com sua conta Google para salvar seu progresso e sincronizar seus dados entre dispositivos.
        </p>

        <div className="panel mt-6 px-5 py-5">
          <Button
            type="button"
            onClick={google}
            disabled={busy}
            className="w-full py-2.5"
          >
            {busy ? "Abrindo Google…" : "Continuar com Google"}
          </Button>
        </div>

        <p className="mt-4 text-center text-[10.5px] leading-relaxed text-muted-foreground/70">
          O acesso por e-mail e senha foi removido para eliminar a dependência de envio de e-mails de autenticação.
        </p>
      </div>
    </div>
  );
}
