import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Chip, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import { Button, Field, Select, TextInput } from "@/components/ordys/form";
import { useAuth } from "@/hooks/use-auth";
import {
  useCalendarConnections,
  useNotificationPrefs,
  useOrdysMutations,
  useProfile,
  useSubjects,
} from "@/lib/ordys-db";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil e preferências — ORDYS" },
      {
        name: "description",
        content:
          "Ajuste etapa de ensino, escala de notas, metas de estudo, limite diário de carga e as regras de notificação do ORDYS.",
      },
      { property: "og:title", content: "Perfil e preferências — ORDYS" },
      {
        property: "og:description",
        content: "Ensino médio ou universidade, metas, escala de notas e notificações inteligentes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Perfil,
});

const groups = [{ items: ["Conta", "Preferências", "Notificações", "Integrações"] }];

const prefFields: { key: string; label: string; hint: string }[] = [
  { key: "exams", label: "Provas e simulados", hint: "avisos 3, 1 e 0 dias antes" },
  { key: "tasks", label: "Tarefas", hint: "vencimento hoje e amanhã" },
  { key: "overdue", label: "Atrasos", hint: "tarefas vencidas sem conclusão" },
  { key: "classes", label: "Aulas", hint: "início das aulas do dia" },
  { key: "study_sessions", label: "Sessões de estudo", hint: "plano do dia e replanejamentos" },
  { key: "goals", label: "Metas e desempenho", hint: "média e frequência fora da meta" },
  { key: "daily_summary", label: "Resumo diário", hint: "fechamento do dia" },
  { key: "weekly_summary", label: "Resumo semanal", hint: "consolidado da semana" },
  { key: "monthly_summary", label: "Resumo mensal", hint: "evolução do mês" },
];

function Perfil() {
  const [active, setActive] = useState("Conta");
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { data: prefs } = useNotificationPrefs();
  const { data: subjects = [] } = useSubjects();
  const { data: connections = [] } = useCalendarConnections();
  const { upsertProfile, upsertNotificationPrefs, refresh } = useOrdysMutations();
  const [permission, setPermission] = useState<string>("default");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function secureSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function disconnect(id: string) {
    const { error } = await supabase.from("calendar_connections").delete().eq("id", id);
    if (error) {
      toast.error("Não foi possível desconectar agora");
      return;
    }
    refresh();
    toast.success("Integração desconectada e credenciais removidas");
  }

  async function deleteAccountData() {
    if (!window.confirm("Excluir permanentemente todos os seus dados do ORDYS? Isso não pode ser desfeito.")) return;
    const { error } = await supabase.rpc("delete_own_data");
    if (error) {
      toast.error("Não foi possível excluir os dados agora");
      return;
    }
    toast.success("Seus dados foram excluídos");
    await secureSignOut();
  }

  const [form, setForm] = useState({
    full_name: "",
    stage: "medio",
    timezone: "America/Sao_Paulo",
    grade_scale_max: "10",
    grade_pass: "6",
    attendance_target: "75",
    weekly_study_target_minutes: "480",
    daily_load_limit_minutes: "240",
  });

  useEffect(() => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name ?? "",
      stage: profile.stage,
      timezone: profile.timezone,
      grade_scale_max: String(profile.grade_scale_max),
      grade_pass: String(profile.grade_pass),
      attendance_target: String(profile.attendance_target),
      weekly_study_target_minutes: String(profile.weekly_study_target_minutes),
      daily_load_limit_minutes: String(profile.daily_load_limit_minutes),
    });
  }, [profile]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  async function save() {
    try {
      await upsertProfile({
        full_name: form.full_name || null,
        stage: form.stage,
        timezone: form.timezone,
        grade_scale_max: Number(form.grade_scale_max),
        grade_pass: Number(form.grade_pass),
        attendance_target: Number(form.attendance_target),
        weekly_study_target_minutes: Number(form.weekly_study_target_minutes),
        daily_load_limit_minutes: Number(form.daily_load_limit_minutes),
      });
      toast.success("Preferências salvas");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  }

  async function togglePref(key: string, value: boolean | string) {
    await upsertNotificationPrefs({ [key]: value } as never);
  }

  async function requestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("Este navegador não suporta notificações.");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      new Notification("ORDYS", { body: "Notificações ativadas neste dispositivo." });
      toast.success("Notificações ativadas");
    } else {
      toast.error("Permissão negada pelo navegador");
    }
  }

  const isUniversity = form.stage === "superior";

  return (
    <Shell
      contextTitle="Perfil"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Perfil", active]}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title="Perfil e preferências" subtitle={user?.email ?? ""} />
        <Button variant="ghost" onClick={secureSignOut}>
          <LogOut className="size-[13px]" strokeWidth={1.8} /> Sair
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Etapa" value={isUniversity ? "Universidade" : "Ensino médio"} sub="ajusta a linguagem do app" accent="primary" />
        <Stat label="Disciplinas" value={String(subjects.length)} sub="ativas" />
        <Stat label="Escala de notas" value={`0 – ${form.grade_scale_max}`} sub={`aprovação ${form.grade_pass}`} />
        <Stat label="Meta semanal" value={`${Math.round(Number(form.weekly_study_target_minutes) / 60)}h`} sub={`limite diário ${Math.round(Number(form.daily_load_limit_minutes) / 60)}h`} accent="success" />
      </div>

      {active === "Conta" || active === "Preferências" ? (
        <Panel className="mt-4 px-5 py-5">
          <p className="text-[13px] font-semibold">Configurações do estudante</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            A etapa define os termos usados (bimestre/semestre) e o cálculo padrão de aprovação.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Nome">
              <TextInput value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="Etapa de ensino">
              <Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                <option value="medio">Ensino médio</option>
                <option value="superior">Ensino superior</option>
              </Select>
            </Field>
            <Field label="Fuso horário">
              <TextInput value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            </Field>
            <Field label="Nota máxima">
              <TextInput
                value={form.grade_scale_max}
                onChange={(e) => setForm({ ...form, grade_scale_max: e.target.value })}
              />
            </Field>
            <Field label="Nota de aprovação">
              <TextInput value={form.grade_pass} onChange={(e) => setForm({ ...form, grade_pass: e.target.value })} />
            </Field>
            <Field label="Frequência mínima (%)">
              <TextInput
                value={form.attendance_target}
                onChange={(e) => setForm({ ...form, attendance_target: e.target.value })}
              />
            </Field>
            <Field label="Meta semanal de estudo (min)">
              <TextInput
                value={form.weekly_study_target_minutes}
                onChange={(e) => setForm({ ...form, weekly_study_target_minutes: e.target.value })}
              />
            </Field>
            <Field label="Limite diário de estudo (min)">
              <TextInput
                value={form.daily_load_limit_minutes}
                onChange={(e) => setForm({ ...form, daily_load_limit_minutes: e.target.value })}
              />
            </Field>
          </div>
          <Button className="mt-4" onClick={save}>
            Salvar preferências
          </Button>
        </Panel>
      ) : null}

      {active === "Notificações" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <Panel>
            <PanelHeader title="Regras de notificação" hint="apenas o que é relevante" />
            <div className="border-t border-border">
              <div className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium">Notificações ativas</p>
                  <p className="text-[11px] text-muted-foreground">Desative para silenciar tudo</p>
                </div>
                <Toggle value={prefs?.enabled ?? true} onChange={(v) => togglePref("enabled", v)} />
              </div>
              {prefFields.map((f) => (
                <div key={f.key} className="flex items-center gap-3 border-t border-border px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px]">{f.label}</p>
                    <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                  </div>
                  <Toggle
                    value={(prefs as Record<string, boolean> | undefined)?.[f.key] ?? true}
                    onChange={(v) => togglePref(f.key, v)}
                  />
                </div>
              ))}
            </div>
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel className="px-5 py-5">
              <p className="text-[13px] font-semibold">Horário de silêncio</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Início">
                  <TextInput
                    type="time"
                    defaultValue={(prefs?.quiet_start ?? "22:00:00").slice(0, 5)}
                    onBlur={(e) => togglePref("quiet_start", e.target.value)}
                  />
                </Field>
                <Field label="Fim">
                  <TextInput
                    type="time"
                    defaultValue={(prefs?.quiet_end ?? "07:00:00").slice(0, 5)}
                    onBlur={(e) => togglePref("quiet_end", e.target.value)}
                  />
                </Field>
              </div>
            </Panel>
            <Panel className="px-5 py-5">
              <p className="text-[13px] font-semibold">Notificações do navegador</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Permite avisos no sistema operacional enquanto o ORDYS estiver aberto.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Chip tone={permission === "granted" ? "success" : permission === "denied" ? "danger" : "muted"}>
                  {permission}
                </Chip>
                <Button variant="ghost" onClick={requestPermission}>
                  <Bell className="size-[13px]" strokeWidth={1.8} /> Ativar
                </Button>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      {active === "Integrações" ? (
        <Panel className="mt-4">
          <PanelHeader title="Integrações de agenda" hint="eventos externos" />
          <div className="border-t border-border px-5 py-4">
            <p className="text-[12px] text-muted-foreground">
              Eventos importados aparecem na agenda junto das aulas, provas e sessões de estudo. Tokens de acesso ficam
              apenas no servidor e nunca são exibidos aqui. Ao desconectar, as credenciais guardadas são removidas.
            </p>
            <div className="mt-3 space-y-2">
              {connections.length ? (
                connections.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 text-[12.5px]">
                    <span className="flex-1">{c.provider}</span>
                    <span className="text-muted-foreground">{c.account_email ?? "—"}</span>
                    <Chip tone={c.status === "conectado" ? "success" : "muted"}>{c.status}</Chip>
                    <Button variant="ghost" onClick={() => disconnect(c.id)}>
                      Desconectar
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-[12px] text-muted-foreground">Nenhuma conexão ativa.</p>
              )}
            </div>
          </div>
        </Panel>
      ) : null}

      {active === "Conta" ? (
        <Panel className="mt-4">
          <PanelHeader title="Privacidade e dados" hint="apenas você" />
          <div className="space-y-3 border-t border-border px-5 py-4">
            <p className="text-[12px] text-muted-foreground">
              Todos os seus dados acadêmicos (notas, frequência, anotações, simulados e hábitos de estudo) são privados e
              acessíveis somente pela sua conta autenticada.
            </p>
            <Button variant="ghost" onClick={deleteAccountData}>
              Excluir todos os meus dados
            </Button>
          </div>
        </Panel>
      ) : null}
    </Shell>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      aria-pressed={value}
      className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-primary" : "bg-secondary"}`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-background transition-all ${
          value ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
