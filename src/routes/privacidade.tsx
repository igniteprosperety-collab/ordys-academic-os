import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { OrdysBrandLockup } from "@/components/ordys/brand-lockup";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Ordys Academy" },
      {
        name: "description",
        content: "Como o Ordys Academy trata dados da conta, rotina acadêmica, integrações e uso do Assistente.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="dark min-h-screen bg-background px-4 py-10 text-foreground">
      <main className="mx-auto w-full max-w-[820px]">
        <Link to="/auth" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Voltar para acesso
        </Link>
        <div className="mt-7">
          <OrdysBrandLockup />
          <div className="mt-5 flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary" />
            <div>
              <h1 className="text-[24px] font-semibold tracking-tight">Política de Privacidade</h1>
              <p className="mt-1 text-[12px] text-muted-foreground">ORDYS ACADEMY · última atualização: 31 de outubro de 2026</p>
            </div>
          </div>
        </div>

        <div className="mt-7 space-y-4">
          <section className="panel px-5 py-5">
            <h2 className="text-[14px] font-semibold">1. Dados tratados</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Quando você cria uma conta e usa os recursos sincronizados, o ORDYS pode armazenar dados de identificação da conta,
              nome, data de nascimento, país, estado, cidade, instituição de ensino, etapa, ano/nível, curso, turma e preferências acadêmicas.
              O sistema também armazena os registros necessários para disciplinas, calendário, tarefas, estudos, provas, notas,
              frequência, metas, notificações e desempenho. Para limitar abuso em pedidos de recuperação de senha,
              o servidor mantém um hash SHA-256 do endereço normalizado, sem armazenar o e-mail em texto nessa tabela de controle.
              Esses hashes permanecem pseudônimos e não são vinculados ao ID da conta; o serviço de recuperação também não consulta
              a tabela de usuários para descobrir se o endereço existe, evitando revelar a existência de contas.
            </p>
          </section>

          <section className="panel px-5 py-5">
            <h2 className="text-[14px] font-semibold">2. Como os dados são usados</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Os dados são usados para autenticar sua conta, salvar e sincronizar sua rotina acadêmica, gerar recursos de organização,
              enviar notificações que você habilitou, prevenir abuso em fluxos de autenticação e recuperação de conta,
              aplicar limites de uso dos recursos de IA e apresentar análises e recursos do ORDYS.
            </p>
          </section>

          <section className="panel px-5 py-5">
            <h2 className="text-[14px] font-semibold">3. Assistente ORDYS</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Ao usar o Assistente, sua mensagem, o histórico recente da conversa e os anexos que você escolher enviar podem ser processados pela OpenAI para gerar a resposta.
              Por padrão, os registros acadêmicos salvos na sua conta não são consultados para compor o contexto da mensagem nem anexados ao conteúdo enviado à OpenAI. A data de nascimento é consultada separadamente para verificar a elegibilidade por idade e não é incluída no contexto enviado ao provedor. Antes de cada envio, você pode abrir “Dados da conta nesta mensagem”
              e selecionar, de forma opcional, as categorias que deseja incluir: Perfil e matérias (etapa, preferências acadêmicas e dados das disciplinas); Agenda (horários, tarefas e provas);
              Desempenho (notas, frequência e metas); Estudos (tópicos, plano, sessões de foco, revisões e check-ins); e Simulados (histórico e resultados).
              Somente as categorias marcadas são consultadas e acrescentadas àquela solicitação. A seleção é apagada após o envio, e a mensagem seguinte começa sem dados acadêmicos selecionados. O histórico recente da conversa também pode ser enviado junto com mensagens seguintes; por isso, informações que já apareceram em mensagens ou respostas anteriores podem continuar presentes nesse histórico mesmo quando nenhuma categoria estiver marcada.
              Se nenhuma categoria for marcada, os registros acadêmicos salvos não são enviados ao Assistente. Quando você anexa um vídeo, o aplicativo extrai até seis quadros representativos e envia esses quadros à OpenAI para análise visual. Quando a função separada de transcrição estiver habilitada, o arquivo de vídeo completo também pode ser encaminhado à OpenAI para tentar transcrever seu áudio. O processamento ocorre somente quando você aciona o recurso de IA.
              Por proteção de menores e pelas regras aplicáveis ao provedor de IA, os recursos que enviam dados à OpenAI ficam disponíveis apenas para contas com 18 anos ou mais.
              Quando a geração de simulados estiver habilitada e for acionada, o nome da disciplina escolhida e os títulos de até 12 conteúdos cadastrados nessa disciplina podem ser enviados à OpenAI para elaborar questões. Se o estudante concluir e salvar o simulado, o histórico acadêmico da conta registra enunciados, alternativas, respostas corretas e informadas, explicações e resultado.
              Em respostas, planos e mapas mentais do Assistente, além de questões de simulados, você pode acionar “Sinalizar conteúdo” para comunicar material ofensivo, perigoso, incorreto, com dados pessoais ou outro problema. Somente o conteúdo de IA selecionado, o motivo, uma descrição opcional e os dados técnicos mínimos da conta e do envio são registrados para análise. O histórico da conversa e os anexos não são incluídos no relato. A denúncia fica acessível apenas à operação autorizada do ORDYS e é removida junto com a conta.
              A conta precisa ter uma data de nascimento cadastrada para liberar esses recursos; a data informada é usada apenas para essa verificação de idade e para os recursos acadêmicos do perfil.
            </p>
          </section>

          <section className="panel px-5 py-5">
            <h2 className="text-[14px] font-semibold">4. Integrações</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Quando você conecta um calendário externo, o ORDYS trata os dados necessários para manter a integração
              solicitada. A conexão pode ser removida na área de Integrações do Perfil.
            </p>
          </section>

          <section className="panel px-5 py-5">
            <h2 className="text-[14px] font-semibold">5. Segurança</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Os dados sincronizados são transmitidos por HTTPS/TLS e o acesso ao conteúdo acadêmico é delimitado pela conta autenticada.
              Recursos internos de limitação de uso, recuperação de conta e operações privilegiadas são executados no servidor.
            </p>
          </section>

          <section className="panel px-5 py-5">
            <h2 className="text-[14px] font-semibold">6. Retenção e exclusão</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Você pode solicitar a exclusão da conta e dos dados associados em Perfil ou pela página de
              <Link to="/excluir-conta" className="ml-1 text-primary hover:underline">exclusão de conta</Link>.
              Quando a operação é concluída com sucesso, a exclusão remove os registros acadêmicos, o perfil, a conta de autenticação
              e o hash correspondente ao endereço de e-mail atual, usado para limitar solicitações de recuperação de senha. Hashes de endereços antigos não podem ser associados à conta sem enfraquecer essa proteção; eles são removidos quando uma solicitação válida posterior aciona a limpeza de registros com mais de sete dias. Essa limpeza é oportunista, não uma tarefa agendada. Registros técnicos de segurança
              podem ser mantidos apenas pelo período necessário à prevenção de abuso e às obrigações aplicáveis; cópias de segurança do provedor
              seguem o ciclo técnico de retenção do serviço. Os relatos de conteúdo de IA também são excluídos quando a conta correspondente é excluída.
            </p>
          </section>

          <section className="panel px-5 py-5">
            <h2 className="text-[14px] font-semibold">7. Contato</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Você pode solicitar confirmação de tratamento, acesso e correção dos dados, além de informações sobre compartilhamento,
              portabilidade quando aplicável, eliminação nos casos previstos em lei e revogação de consentimento. Para essas solicitações,
              use o canal de suporte informado na ficha oficial de distribuição do ORDYS. Na distribuição direta por APK, o responsável
              deverá disponibilizar também um canal de contato próprio e acessível, não restrito à ficha do Google Play.
              O nome e o contato do controlador devem permanecer identificáveis e atualizados na presença pública do serviço.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
