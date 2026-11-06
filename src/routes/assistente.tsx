import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrainCircuit, CheckCircle2, ExternalLink, FilePlus2, Lock, Network, Search, Send, Sparkles } from "lucide-react";
import { Shell } from "@/components/ordys/shell";
import { AttachmentList, ConfigurationCard, MindMapCard } from "@/components/ordys/assistant-panels";
import { prepareOrdysAttachments, type OrdysAttachment, ORDYS_ATTACHMENT_LIMITS } from "@/lib/ordys-assistant-media";
import {
  applyOrdysConfiguration,
  askOrdysAssistant,
  cancelOrdysResearch,
  pollOrdysResearch,
  type OrdysAssistantMessage,
  type OrdysAssistantMode,
  type OrdysCitation,
  type OrdysConfigurationPlan,
  type OrdysMindMap,
} from "@/lib/ordys-assistant-client";
import { cn } from "@/lib/utils";
import { AiContentReportButton } from "@/components/ordys/ai-content-report-button";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/lib/ordys-db";
import { canUseOrdysAi } from "@/lib/ai-eligibility";
import { ORDYS_PLUS_AI_ENABLED, ORDYS_PLUS_LOCK_SHORT_MESSAGE } from "@/lib/ordys-ai-access";
import {
  ORDYS_CONTEXT_SCOPE_OPTIONS,
  type OrdysAcademicContextScope,
} from "@/lib/ordys-assistant-context";

export const Route = createFileRoute("/assistente")({
  head: () => ({
    meta: [
      { title: "Agente Ordys Academy — orientação e pesquisa" },
      {
        name: "description",
        content:
          "Use o Agente Ordys Academy para orientação, pesquisa, organização da rotina e mapas mentais.",
      },
      { property: "og:title", content: "Agente Ordys Academy" },
      {
        property: "og:description",
        content: "Orientação, pesquisa e organização da rotina acadêmica.",
      },
    ],
  }),
  component: AssistantPage,
});

const modes: Array<{ key: OrdysAssistantMode; label: string; description: string; icon: typeof Sparkles; requiresPlus?: boolean }> = [
  { key: "assist", label: "Orientação", description: "Explicação, estudo e organização.", icon: Sparkles },
  { key: "research", label: "Pesquisa", description: "Busca atual com fontes verificáveis.", icon: Search, requiresPlus: true },
  { key: "deep", label: "Pesquisa profunda", description: "Investigação multi-etapas e comparação de fontes.", icon: BrainCircuit, requiresPlus: true },
  { key: "configure", label: "Configurar rotina", description: "Transforma sua descrição em dados do ORDYS.", icon: FilePlus2, requiresPlus: true },
  { key: "mindmap", label: "Mapa mental", description: "Organiza o conteúdo em uma estrutura visual.", icon: Network, requiresPlus: true },
];

const starterPrompts: Record<OrdysAssistantMode, string[]> = {
  assist: [
    "Explique este conteúdo passo a passo e me diga o que revisar.",
    "Monte um plano de estudo para esta matéria.",
    "Me ajude a entender onde estou errando.",
  ],
  research: [
    "Quais fontes confiáveis devo consultar para começar?",
    "Monte um roteiro de investigação e diga o que devo verificar.",
    "Compare as principais explicações sobre este tema.",
  ],
  deep: [
    "Investigue este tema por ângulos diferentes e compare as evidências.",
    "Procure fontes independentes e possíveis divergências.",
    "Faça uma pesquisa profunda sobre este assunto.",
  ],
  configure: [
    "Tenho Matemática segunda e quarta às 8h e Português terça às 10h.",
    "Quero cadastrar minhas matérias, horários e próximas provas.",
    "Vou te passar minha rotina escolar para configurar o ORDYS.",
  ],
  mindmap: [
    "Crie um mapa mental deste tema com os conceitos principais.",
    "Transforme minhas anotações em um mapa mental.",
    "Organize este conteúdo do geral para o específico.",
  ],
};

const accept = [
  "image/*",
  "video/*",
  ".pdf",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
].join(",");

function renderRichText(text: string) {
  const pattern = /\[Fonte\s+(\d+)\]\((https?:\/\/[^)\s]+)\)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const [full, number, url] = match;
    nodes.push(text.slice(lastIndex, match.index));
    nodes.push(<a key={`${url}-${match.index}`} href={url} target="_blank" rel="noreferrer" className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">[Fonte {number}]</a>);
    lastIndex = match.index + full.length;
  }
  nodes.push(text.slice(lastIndex));
  return nodes.map((node, index) => typeof node === "string" ? node.split("\n").map((part, lineIndex) => <span key={`${index}-${lineIndex}`}>{lineIndex ? <br /> : null}{part}</span>) : node);
}

function AssistantPage() {
  const [mode, setMode] = useState<OrdysAssistantMode>("assist");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<OrdysAssistantMessage[]>([]);
  const [citations, setCitations] = useState<OrdysCitation[]>([]);
  const [attachments, setAttachments] = useState<OrdysAttachment[]>([]);
  const [academicContextScopes, setAcademicContextScopes] = useState<OrdysAcademicContextScope[]>([]);
  const [configuration, setConfiguration] = useState<OrdysConfigurationPlan | null>(null);
  const [mindMap, setMindMap] = useState<OrdysMindMap | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparingFiles, setPreparingFiles] = useState(false);
  const [applyingConfig, setApplyingConfig] = useState(false);
  const [status, setStatus] = useState("");
  const { isDemo } = useAuth();
  const { data: profile, isLoading: profileLoading, error: profileError } = useProfile();
  const aiEligibility = canUseOrdysAi(profile?.birth_date);
  const profileFailed = Boolean(profileError) && !profile;
  const aiUnavailable = profileLoading || profileFailed || !aiEligibility.allowed;
  const pollTimer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
  }, []);

  async function selectFiles(fileList: FileList | null) {
    if (!fileList?.length || preparingFiles) return;
    if (attachments.length + fileList.length > ORDYS_ATTACHMENT_LIMITS.maxFiles) {
      setStatus(`O Ordys aceita até ${ORDYS_ATTACHMENT_LIMITS.maxFiles} anexos por mensagem.`);
      return;
    }
    setPreparingFiles(true);
    setStatus("Preparando anexos…");
    try {
      const prepared = await prepareOrdysAttachments(fileList);
      setAttachments((current) => [...current, ...prepared]);
      setStatus(`${prepared.length} anexo(s) preparado(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível preparar os anexos.");
    } finally {
      setPreparingFiles(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(messageOverride?: string) {
    if (isDemo) {
      setStatus("O Assistente com IA exige uma conta ORDYS. Entre na conta para usar este recurso.");
      return;
    }
    if (profileLoading) {
      setStatus("Validando sua conta e carregando seu perfil. Tente novamente em instantes.");
      return;
    }
    if (profileFailed) {
      setStatus("Não foi possível carregar seu perfil. Verifique a conexão e tente novamente.");
      return;
    }
    if (!aiEligibility.allowed) {
      setStatus(aiEligibility.reason);
      return;
    }
    const message = (messageOverride ?? input).trim();
    if ((!message && !attachments.length) || busy || preparingFiles) return;

    const submittedAttachments = attachments;
    const submittedAcademicContext = academicContextScopes;
    const hasVideoAttachments = submittedAttachments.some((file) => file.kind === "video");
    const visibleMessageBase = message || `Analise os anexos enviados: ${submittedAttachments.map((file) => file.name).join(", ")}.`;
    const visibleMessage = hasVideoAttachments && !ORDYS_PLUS_AI_ENABLED
      ? `${visibleMessageBase}\n\nObservação: nesta versão, o áudio dos vídeos não é transcrito; a análise considera apenas os quadros extraídos.`
      : visibleMessageBase;
    setBusy(true);
    setCitations([]);
    setConfiguration(null);
    setMindMap(null);
    setStatus(mode === "deep" ? "Preparando pesquisa profunda…" : mode === "research" ? "Pesquisando e verificando fontes…" : mode === "configure" ? "Estruturando sua rotina…" : mode === "mindmap" ? "Organizando o mapa mental…" : "Organizando a orientação…");
    setMessages((current) => [...current, { role: "user", content: visibleMessage }]);
    setInput("");
    setAttachments([]);
    // Consent is per message: the next request starts with no account context selected.
    setAcademicContextScopes([]);

    try {
      const result = await askOrdysAssistant({
        message,
        mode,
        history: messages,
        attachments: submittedAttachments,
        academicContext: submittedAcademicContext,
      });
      if (result.status === "processing" && result.responseId) {
        setStatus("Pesquisa profunda em andamento: investigando múltiplas fontes…");
        await poll(result.responseId);
      } else if (result.status === "completed" && mode === "configure" && result.configuration) {
        setConfiguration(result.configuration);
        finish(result.configuration.summary || "Preparei uma configuração para a sua rotina.", []);
      } else if (result.status === "completed" && mode === "mindmap" && result.mindMap) {
        setMindMap(result.mindMap);
        finish("Preparei o mapa mental a partir do conteúdo enviado.", []);
      } else {
        finish(result.answer ?? "Não houve conteúdo suficiente para concluir.", result.citations ?? []);
      }
    } catch (error) {
      finish(error instanceof Error ? error.message : "Não foi possível concluir a solicitação.", []);
    }
  }

  async function poll(responseId: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 4 * 60 * 1000) {
      let result;
      try {
        result = await pollOrdysResearch(responseId);
      } catch (error) {
        try {
          const cancelled = await cancelOrdysResearch(responseId);
          if (cancelled.status === "completed") {
            finish(cancelled.answer ?? "A pesquisa terminou sem conteúdo.", cancelled.citations ?? []);
            return;
          }
        } catch {
          // Keep the server-side ownership record if cancellation cannot be confirmed.
        }
        finish(error instanceof Error ? error.message : "Não foi possível consultar a pesquisa.", []);
        return;
      }
      if (result.status === "completed") {
        finish(result.answer ?? "A pesquisa terminou sem conteúdo.", result.citations ?? []);
        return;
      }
      if (result.status === "failed") {
        finish(result.error ?? "A pesquisa não pôde ser concluída.", []);
        return;
      }
      setStatus("Pesquisa profunda em andamento… verificando novas evidências.");
      await new Promise<void>((resolve) => { pollTimer.current = window.setTimeout(resolve, 2200); });
    }

    try {
      const cancelled = await cancelOrdysResearch(responseId);
      if (cancelled.status === "completed") {
        finish(cancelled.answer ?? "A pesquisa terminou sem conteúdo.", cancelled.citations ?? []);
        return;
      }
      finish(
        cancelled.error ?? "A pesquisa ultrapassou o tempo limite e foi encerrada. Tente novamente com um escopo menor.",
        [],
      );
    } catch {
      finish("A pesquisa ultrapassou o tempo limite, mas não foi possível confirmar o cancelamento. Tente novamente mais tarde.", []);
    }
  }

  function finish(text: string, sources: OrdysCitation[]) {
    setMessages((current) => [...current, { role: "assistant", content: text }]);
    setCitations(sources);
    setBusy(false);
    setStatus("");
  }

  async function applyConfiguration() {
    if (!configuration || applyingConfig || configuration.questions.length || profileLoading || profileFailed || !aiEligibility.allowed) return;
    setApplyingConfig(true);
    setStatus("Aplicando a configuração no seu ORDYS…");
    try {
      const result = await applyOrdysConfiguration(configuration) as { status?: string; error?: string; applied?: string[] };
      const applied = result.applied?.length ? result.applied.join(" · ") : "Nenhuma alteração confirmada.";

      if (result.status === "completed") {
        setMessages((current) => [...current, { role: "assistant", content: `Configuração concluída. ${applied}` }]);
        setConfiguration(null);
        setStatus("");
        return;
      }

      if (result.status === "partial") {
        setMessages((current) => [...current, {
          role: "assistant",
          content: `Configuração aplicada parcialmente. ${applied}${result.error ? `\n\n${result.error}` : ""}`,
        }]);
        setStatus(result.error ?? "Parte da configuração foi aplicada. Revise e tente novamente.");
        return;
      }

      setStatus(result.error ?? "Não foi possível aplicar a configuração.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível aplicar a configuração.");
    } finally {
      setApplyingConfig(false);
    }
  }

  const active = modes.find((item) => item.key === mode)!;

  return (
    <Shell
      contextTitle="Assistente"
      groups={[
        { items: ["Orientação", "Pesquisa", "Pesquisa profunda", "Configurar rotina", "Mapa mental"] },
        { label: "Método", items: ["Verificar fontes", "Encontrar evidências", "Próximos passos"] },
      ]}
      active={active.label}
      onSelect={(item) => {
        const selected = modes.find((candidate) => candidate.label === item);
        if (selected) setMode(selected.key);
      }}
      breadcrumb={["Assistente", active.label]}
    >
      <div className="mx-auto max-w-[1020px]">
        <header className="border-b border-border pb-5">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Assistente Ordys</p>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Pesquise. Verifique. Aprenda.</h1>
          <p className="mt-2 max-w-[760px] text-[13px] leading-6 text-muted-foreground">O Ordys orienta a investigação, entende conteúdos enviados, organiza rotinas e transforma informações acadêmicas em estruturas úteis para o estudante.</p>
        </header>

        {!isDemo && profileLoading ? (
          <section className="mt-6 rounded-xl border border-border bg-surface px-4 py-3 text-[12px]">
            <p className="font-medium">Validando seu perfil</p>
            <p className="mt-1 leading-5 text-muted-foreground">Aguarde enquanto o ORDYS carrega sua data de nascimento e verifica a disponibilidade dos recursos de IA.</p>
          </section>
        ) : null}
        {!isDemo && profileFailed ? (
          <section className="mt-6 rounded-xl border border-border bg-surface px-4 py-3 text-[12px]">
            <p className="font-medium">Não foi possível carregar seu perfil</p>
            <p className="mt-1 leading-5 text-muted-foreground">Verifique sua conexão e tente novamente antes de usar os recursos de IA.</p>
            <Link to="/perfil" className="mt-2 inline-block text-primary hover:underline">Abrir Perfil</Link>
          </section>
        ) : null}
        {!isDemo && !profileLoading && !profileFailed && !aiEligibility.allowed ? (
          <section className="mt-6 rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-[12px]">
            <p className="font-medium">Recursos de IA temporariamente indisponíveis</p>
            <p className="mt-1 leading-5 text-muted-foreground">{aiEligibility.reason}</p>
            <Link to="/perfil" className="mt-2 inline-block text-primary hover:underline">Abrir Perfil</Link>
          </section>
        ) : null}

        <section className="mt-6 grid gap-2 md:grid-cols-5">
          {modes.map((item) => {
            const Icon = item.icon;
            const selected = mode === item.key;
            const locked = Boolean(item.requiresPlus && !ORDYS_PLUS_AI_ENABLED);
            return (
              <button key={item.key} type="button" onClick={() => setMode(item.key)} disabled={isDemo || aiUnavailable || locked} title={locked ? ORDYS_PLUS_LOCK_SHORT_MESSAGE : item.description} className={cn("min-h-11 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55", selected ? "border-primary/40 bg-primary-soft" : "border-border bg-surface hover:bg-secondary/50")}>
                <div className="flex items-center gap-2.5"><span className={cn("grid size-8 place-items-center rounded-lg", selected ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground")}><Icon className="size-4" strokeWidth={1.7} /></span><span className="text-[13px] font-semibold">{item.label}</span>{locked ? <Lock className="ml-auto size-3.5 text-muted-foreground" /> : null}</div>
                <p className="mt-2 text-[11.5px] leading-5 text-muted-foreground">{locked ? ORDYS_PLUS_LOCK_SHORT_MESSAGE : item.description}</p>
              </button>
            );
          })}
        </section>

        <details className="mt-4 rounded-xl border border-border bg-surface px-4 py-3">
          <summary className="min-h-11 cursor-pointer select-none py-2 text-[12px] font-medium">
            Dados da conta nesta mensagem
            <span className="ml-2 text-[10.5px] font-normal text-muted-foreground">
              {academicContextScopes.length ? `${academicContextScopes.length} categoria(s) selecionada(s)` : "opcional · nenhuma selecionada"}
            </span>
          </summary>
          <p className="mb-3 max-w-[760px] text-[11px] leading-5 text-muted-foreground">
            Por padrão, seus registros acadêmicos salvos não são incluídos no contexto enviado ao Assistente. A data de nascimento é consultada separadamente para validar a idade e não é enviada à OpenAI. Marque somente o que deseja incluir nesta mensagem: as categorias escolhidas serão consultadas e enviadas à OpenAI nesta solicitação. A seleção é apagada após o envio. O histórico recente desta conversa também pode acompanhar as próximas mensagens, inclusive trechos já compartilhados. Desmarcar categorias não apaga informações que já estejam nesse histórico.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ORDYS_CONTEXT_SCOPE_OPTIONS.map((option) => (
              <label key={option.value} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={academicContextScopes.includes(option.value)}
                  disabled={isDemo || aiUnavailable || busy || preparingFiles}
                  onChange={(event) => setAcademicContextScopes((current) =>
                    event.target.checked
                      ? [...current, option.value]
                      : current.filter((scope) => scope !== option.value)
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-4 text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </details>

        <section className="mt-6 rounded-2xl border border-border bg-surface p-4 sm:p-5">
          {isDemo ? (
            <div className="mb-5 rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-[12px]">
              <p className="font-medium">Assistente com IA disponível com conta</p>
              <p className="mt-1 leading-5 text-muted-foreground">
                O modo sem conta mantém seus dados neste dispositivo, mas recursos de IA precisam de uma sessão autenticada para proteger seu uso e aplicar os limites do servidor.
              </p>
              <Link to="/auth" className="mt-2 inline-block text-primary hover:underline">Entrar ou criar conta</Link>
            </div>
          ) : null}
          <div className="min-h-[340px]">
            {!messages.length ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                <div className="grid size-12 place-items-center rounded-full bg-secondary">{mode === "deep" ? <BrainCircuit className="size-5 text-primary" /> : mode === "research" ? <Search className="size-5 text-primary" /> : mode === "mindmap" ? <Network className="size-5 text-primary" /> : <Sparkles className="size-5 text-primary" />}</div>
                <h2 className="mt-4 text-[16px] font-semibold">{mode === "configure" ? "Passe sua rotina para o Ordys" : mode === "mindmap" ? "Transforme conteúdo em mapa mental" : "Como você quer estudar?"}</h2>
                <p className="mt-1 max-w-[560px] text-[12px] leading-5 text-muted-foreground">{mode === "configure" ? "Escreva ou cole suas matérias, horários, provas e preferências. O Ordys prepara as alterações e mostra o que será feito antes de aplicar." : mode === "mindmap" ? "Envie texto, imagens ou documentos. O Ordys monta uma estrutura visual com os conceitos encontrados no material." : "Você pode escrever a dúvida ou anexar materiais acadêmicos. O modo escolhido define como o conteúdo será tratado."}</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">{starterPrompts[mode].map((prompt) => <button key={prompt} type="button" onClick={() => void submit(prompt)} disabled={isDemo || aiUnavailable} className="min-h-11 rounded-full border border-border px-3 py-2 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">{prompt}</button>)}</div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cn("flex max-w-[90%] flex-col gap-1", message.role === "user" ? "items-end" : "items-start")}>
                      <div className={cn("max-w-full break-words whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13px] leading-6", message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-background text-foreground")}>{message.role === "assistant" ? renderRichText(message.content) : message.content}</div>
                      {message.role === "assistant" ? (
                        <AiContentReportButton source="assistant" content={message.content} />
                      ) : null}
                    </div>
                  </div>
                ))}
                {busy ? <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-[12px] text-muted-foreground"><span className="size-2 animate-pulse rounded-full bg-primary" />{status || "Processando…"}</div> : null}
                {configuration ? (
                  <>
                    <ConfigurationCard plan={configuration} applying={applyingConfig} onApply={() => void applyConfiguration()} />
                    <AiContentReportButton source="assistant" label="Sinalizar plano" content={JSON.stringify(configuration, null, 2)} />
                  </>
                ) : null}
                {mindMap ? (
                  <>
                    <MindMapCard map={mindMap} />
                    <AiContentReportButton source="assistant" label="Sinalizar mapa mental" content={JSON.stringify(mindMap, null, 2)} />
                  </>
                ) : null}
              </div>
            )}
          </div>

          {citations.length ? <div className="mt-5 border-t border-border pt-4"><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"><CheckCircle2 className="size-3.5" /> Fontes consultadas</div><div className="grid gap-2 sm:grid-cols-2">{citations.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="group flex min-h-11 min-w-0 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 hover:bg-secondary"><span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-[10px] font-semibold text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 truncate text-[11.5px]">{source.title}</span><ExternalLink className="size-3.5 shrink-0 text-muted-foreground" /></a>)}</div></div> : null}

          <div className="mt-5 border-t border-border pt-4">
            <AttachmentList attachments={attachments} onRemove={(id) => setAttachments((current) => current.filter((file) => file.id !== id))} />
            {status && !busy && !preparingFiles ? <p className="mb-2 text-[10.5px] text-muted-foreground">{status}</p> : null}
            <input ref={fileInput} type="file" multiple accept={accept} disabled={isDemo || aiUnavailable || busy || preparingFiles} className="hidden" onChange={(event) => void selectFiles(event.target.files)} />
            <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2 focus-within:border-primary/40">
              <button type="button" onClick={() => fileInput.current?.click()} disabled={isDemo || aiUnavailable || busy || preparingFiles} className="grid size-11 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary disabled:opacity-40" aria-label="Adicionar arquivo"><FilePlus2 className="size-4" /></button>
              <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} rows={2} disabled={isDemo || aiUnavailable || busy || preparingFiles} placeholder={mode === "deep" ? "Descreva a pesquisa que você quer investigar…" : mode === "research" ? "Pergunte sobre um tema que precise de fontes…" : mode === "configure" ? "Ex.: Matemática seg/qua 08:00–09:30, prova de Biologia sexta…" : mode === "mindmap" ? "Descreva o conteúdo ou envie um material…" : "Pergunte sobre estudo, organização ou um conteúdo…"} className="min-h-[48px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground" />
              <button type="button" onClick={() => void submit()} disabled={isDemo || aiUnavailable || busy || preparingFiles || (!input.trim() && !attachments.length)} className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40" aria-label="Enviar mensagem"><Send className="size-4" strokeWidth={1.7} /></button>
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">{preparingFiles ? "Preparando anexos…" : `Até ${ORDYS_ATTACHMENT_LIMITS.maxFiles} anexos · 8 MB por arquivo · imagens, vídeos, PDF e documentos.`}</p>
          </div>
        </section>
      </div>
    </Shell>
  );
}
