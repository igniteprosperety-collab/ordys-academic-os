import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Browser } from "@capacitor/browser";
import { Bell, CreditCard, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/ordys/shell";
import { Chip, Panel, PanelHeader, PageTitle, Stat } from "@/components/ordys/primitives";
import { Button, ConfirmDialog, Field, Select, TextInput } from "@/components/ordys/form";
import { useAuth } from "@/hooks/use-auth";
import {
  useCalendarConnections,
  useNotificationPrefs,
  useOrdysMutations,
  useProfile,
  useSubjects,
} from "@/lib/ordys-db";
import { supabase } from "@/integrations/supabase/client";
import { getNativeNotificationPermission, nativeNotificationsDisabled, isNativeAndroid, requestNativeNotificationPermission, syncNativeAcademicNotifications } from "@/lib/native-notifications";
import { addLocalProfile, getActiveLocalProfileId, getLocalProfiles, stopDemoMode, switchLocalProfile } from "@/lib/demo-mode";
import { signOutCurrentSession } from "@/lib/ordys-session";
import { calculateAgeInTimeZone } from "@/lib/ai-eligibility";

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil e preferências — Ordys Academy" },
      {
        name: "description",
        content:
          "Ajuste etapa de ensino, escala de notas, metas de estudo, limite diário de carga e as regras de notificação do Ordys Academy.",
      },
      { property: "og:title", content: "Perfil e preferências — Ordys Academy" },
      {
        property: "og:description",
        content: "Etapa de ensino, metas, escala de notas e notificações inteligentes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Perfil,
});

const groups = [{ items: ["Conta", "Preferências", "Notificações", "Integrações", "Assinatura"] }];

type BillingPlan = {
  plan_code: "plus_monthly" | "plus_yearly";
  title: string;
  description: string;
  billing_cycle: "MONTHLY" | "YEARLY";
  price_cents: number;
  currency: "BRL";
};

type BillingSubscription = {
  planCode: string;
  status: "pending" | "active" | "past_due" | "cancelled" | "suspended";
  amountCents: number;
  currency: "BRL";
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  cancelledAt: string | null;
  hasAccess: boolean;
};

type BillingOverview = {
  enabled: boolean;
  plans: BillingPlan[];
  subscription: BillingSubscription | null;
};

async function billingErrorMessage(error: unknown, fallback: string) {
  const context = error && typeof error === "object" && "context" in error
    ? (error as { context?: unknown }).context
    : null;

  if (context instanceof Response) {
    try {
      const payload: unknown = await context.clone().json();
      if (payload && typeof payload === "object" && "error" in payload) {
        const message = (payload as { error?: unknown }).error;
        if (typeof message === "string" && message.trim()) return message;
      }
    } catch {
      // Preserve the SDK error when the response body is not valid JSON.
    }
  }

  return error instanceof Error && error.message ? error.message : fallback;
}


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
  const { user, isDemo } = useAuth();
  const { data: profile } = useProfile();
  const { data: prefs } = useNotificationPrefs();
  const { data: subjects = [] } = useSubjects();
  const { data: connections = [] } = useCalendarConnections();
  const { upsertProfile, upsertNotificationPrefs, remove, refresh } = useOrdysMutations();
  const [permission, setPermission] = useState<string>("default");
  const [newLocalProfileName, setNewLocalProfileName] = useState("");
  const [billingOverview, setBillingOverview] = useState<BillingOverview | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [cancelBillingDialogOpen, setCancelBillingDialogOpen] = useState(false);
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const localProfiles = getLocalProfiles();
  const activeLocalProfileId = getActiveLocalProfileId();

  async function secureSignOut() {
    if (signOutBusy) return;
    setSignOutBusy(true);
    try {
      await queryClient.cancelQueries();
      if (isDemo) {
        stopDemoMode();
      } else {
        await signOutCurrentSession();
      }
      queryClient.clear();
      setSignOutDialogOpen(false);
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      console.error("[auth] sign out failed", error);
      toast.error("Não foi possível confirmar o encerramento da sessão. Verifique sua conexão e tente novamente.");
    } finally {
      setSignOutBusy(false);
    }
  }

  const refreshBillingOverview = useCallback(async () => {
    setBillingLoading(true);
    setBillingError("");
    try {
      const { data, error } = await supabase.functions.invoke("ordys-billing-status", { body: {} });
      if (error) throw error;
      if (!data || typeof data !== "object" || typeof data.enabled !== "boolean") {
        throw new Error("O serviço de assinaturas retornou uma resposta inválida.");
      }
      const result = data as BillingOverview;
      setBillingOverview({
        enabled: result.enabled,
        plans: Array.isArray(result.plans) ? result.plans : [],
        subscription: result.subscription ?? null,
      });
    } catch (error) {
      setBillingError(await billingErrorMessage(error, "Não foi possível consultar sua assinatura."));
    } finally {
      setBillingLoading(false);
    }
  }, []);

  async function startBillingCheckout(planCode: BillingPlan["plan_code"]) {
    if (billingBusy) return;
    setBillingBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("ordys-billing-checkout", { body: { planCode } });
      if (error) throw error;
      const checkoutUrl = data && typeof data.checkoutUrl === "string" ? data.checkoutUrl : "";
      if (!checkoutUrl) {
        throw new Error(data && typeof data.error === "string" ? data.error : "O provedor não retornou um link seguro de pagamento.");
      }
      const parsedUrl = new URL(checkoutUrl);
      if (
        parsedUrl.protocol !== "https:" ||
        parsedUrl.hostname.toLowerCase() !== "asaas.com" ||
        parsedUrl.pathname !== "/checkoutSession/show" ||
        !parsedUrl.searchParams.get("id")
      ) throw new Error("O link de pagamento não pertence ao checkout seguro do Asaas.");
      if (isNativeAndroid()) await Browser.open({ url: parsedUrl.toString() });
      else window.location.assign(parsedUrl.toString());
    } catch (error) {
      toast.error(await billingErrorMessage(error, "Não foi possível iniciar a assinatura."));
    } finally {
      setBillingBusy(false);
    }
  }

  async function cancelBillingSubscription() {
    if (billingBusy) return;
    setBillingBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("ordys-billing-manage", { body: { action: "cancel" } });
      if (error) throw error;
      if (data?.cancelled !== true) {
        throw new Error(typeof data?.error === "string" ? data.error : "Não foi possível cancelar a assinatura.");
      }
      setCancelBillingDialogOpen(false);
      const accessUntil = typeof data?.accessUntil === "string" ? Date.parse(data.accessUntil) : 0;
      if (billingOverview?.subscription?.status === "suspended") {
        toast.success("Cobranças futuras interrompidas. A suspensão do acesso por estorno ou contestação permanece até análise.");
      } else if (Number.isFinite(accessUntil) && accessUntil > Date.now()) {
        const formattedDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(accessUntil));
        toast.success(`Cobranças futuras interrompidas. O Ordys Plus permanece disponível até ${formattedDate}.`);
      } else {
        toast.success("Cobranças futuras interrompidas. Não há um período pago com acesso ativo.");
      }
      await refreshBillingOverview();
    } catch (error) {
      toast.error(await billingErrorMessage(error, "Não foi possível cancelar a assinatura."));
    } finally {
      setBillingBusy(false);
    }
  }


  async function disconnect(id: string) {
    try {
      await remove("calendar_connections", id);
      toast.success("Integração desconectada.");
    } catch {
      toast.error("Não foi possível desconectar agora");
    }
  }

  const [form, setForm] = useState({
    full_name: "",
    birth_date: "",
    country: "",
    state: "",
    city: "",
    school_name: "",
    education_level: "",
    course: "",
    class_name: "",
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
      birth_date: profile.birth_date ?? "",
      country: profile.country ?? "",
      state: profile.state ?? "",
      city: profile.city ?? "",
      school_name: profile.school_name ?? "",
      education_level: profile.education_level ?? "",
      course: profile.course ?? "",
      class_name: profile.class_name ?? "",
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
    if (isNativeAndroid()) {
      void getNativeNotificationPermission().then(setPermission).catch(() => setPermission("default"));
      return;
    }
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);
  useEffect(() => {
    if (active !== "Assinatura" || isDemo || !user?.id) return;
    void refreshBillingOverview();
  }, [active, isDemo, user?.id, refreshBillingOverview]);


  async function save() {
    const cleanProfile = {
      full_name: form.full_name.trim(),
      birth_date: form.birth_date.trim(),
      country: form.country.trim(),
      state: form.state.trim(),
      city: form.city.trim(),
      school_name: form.school_name.trim(),
      education_level: form.education_level.trim(),
      course: form.course.trim(),
      class_name: form.class_name.trim(),
      timezone: form.timezone.trim(),
    };

    if (cleanProfile.birth_date) {
      const birthDate = new Date(cleanProfile.birth_date + "T00:00:00");
      if (
        Number.isNaN(birthDate.getTime()) ||
        birthDate > new Date() ||
        birthDate < new Date("1900-01-01T00:00:00")
      ) {
        toast.error("Informe uma data de nascimento entre 01/01/1900 e hoje.");
        return;
      }
    }
    const allowedStages = new Set(["fundamental", "medio", "superior", "pos", "outro"]);
    const maxLengths: Record<string, number> = {
      full_name: 120,
      country: 100,
      state: 100,
      city: 120,
      school_name: 180,
      education_level: 100,
      course: 160,
      class_name: 80,
      timezone: 64,
    };
    for (const [key, max] of Object.entries(maxLengths)) {
      if (cleanProfile[key as keyof typeof cleanProfile].length > max) {
        if (key === "full_name") {
          toast.error("O nome deve ter no máximo 120 caracteres.");
        } else {
          toast.error(`O campo ${key.replaceAll("_", " ")} deve ter no máximo ${max} caracteres.`);
        }
        return;
      }
    }
    if (cleanProfile.full_name.length === 0 && form.full_name.trim() !== "") {
      toast.error("O nome não pode conter apenas espaços.");
      return;
    }
    if (cleanProfile.timezone.length < 1) {
      toast.error("Informe um fuso horário válido.");
      return;
    }
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: cleanProfile.timezone }).format();
    } catch {
      toast.error("Informe um fuso horário válido.");
      return;
    }
    if (!allowedStages.has(form.stage)) {
      toast.error("Selecione uma etapa de ensino válida.");
      return;
    }

    const gradeScaleMax = Number(form.grade_scale_max);
    const gradePass = Number(form.grade_pass);
    const attendanceTarget = Number(form.attendance_target);
    const weeklyStudyTarget = Number(form.weekly_study_target_minutes);
    const dailyLoadLimit = Number(form.daily_load_limit_minutes);

    if (
      ![gradeScaleMax, gradePass, attendanceTarget, weeklyStudyTarget, dailyLoadLimit].every(Number.isFinite) ||
      gradeScaleMax < 1 ||
      gradeScaleMax > 100 ||
      gradePass < 0 ||
      gradePass > gradeScaleMax ||
      attendanceTarget < 0 ||
      attendanceTarget > 100 ||
      weeklyStudyTarget < 0 ||
      weeklyStudyTarget > 10080 ||
      dailyLoadLimit < 0 ||
      dailyLoadLimit > 1440
    ) {
      toast.error("Revise as configurações acadêmicas: use valores dentro dos limites permitidos.");
      return;
    }

    try {
      await upsertProfile({
        full_name: cleanProfile.full_name || null,
        birth_date: cleanProfile.birth_date || null,
        country: cleanProfile.country || null,
        state: cleanProfile.state || null,
        city: cleanProfile.city || null,
        school_name: cleanProfile.school_name || null,
        education_level: cleanProfile.education_level || null,
        course: cleanProfile.course || null,
        class_name: cleanProfile.class_name || null,
        stage: form.stage,
        timezone: cleanProfile.timezone,
        grade_scale_max: gradeScaleMax,
        grade_pass: gradePass,
        attendance_target: attendanceTarget,
        weekly_study_target_minutes: weeklyStudyTarget,
        daily_load_limit_minutes: dailyLoadLimit,
      });
      toast.success("Preferências salvas");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  }

  async function togglePref(key: string, value: boolean | string) {
    try {
      await upsertNotificationPrefs({ [key]: value } as never);
      if (isNativeAndroid()) {
        await syncNativeAcademicNotifications();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a preferência.");
    }
  }

  async function requestPermission() {
    try {
      if (isNativeAndroid()) {
        const result = await requestNativeNotificationPermission();
        setPermission(result);
        if (result === "granted") {
          await syncNativeAcademicNotifications();
          toast.success("Notificações do Android ativadas");
        } else {
          toast.error("Permissão de notificações não concedida");
        }
        return;
      }

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível ativar as notificações.");
    }
  }

  const stageLabels: Record<string, string> = {
    fundamental: "Ensino fundamental",
    medio: "Ensino médio",
    superior: "Universidade",
    pos: "Pós-graduação",
    outro: "Outra etapa",
  };
  const stageLabel = stageLabels[form.stage] ?? "Ensino médio";

  const derivedAge = calculateAgeInTimeZone(form.birth_date, form.timezone);


  function createLocalProfile() {
    try {
      const name = newLocalProfileName.trim();
      if (!name) {
        toast.error("Informe um nome.");
        return;
      }
      addLocalProfile(name);
      setNewLocalProfileName("");
      toast.success(`Perfil "${name}" criado.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar o perfil.");
    }
  }

  function changeLocalProfile(profileId: string) {
    if (!profileId || profileId === activeLocalProfileId) return;
    try {
      switchLocalProfile(profileId);
      toast.success("Perfil alterado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível trocar de perfil.");
    }
  }

  return (
    <Shell
      contextTitle="Perfil"
      groups={groups}
      active={active}
      onSelect={setActive}
      breadcrumb={["Perfil", active]}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title="Perfil e preferências" subtitle={isDemo ? "Modo local · salvo neste dispositivo" : user?.email ?? ""} />
        <Button variant="ghost" onClick={() => setSignOutDialogOpen(true)}>
          <LogOut className="size-[13px]" strokeWidth={1.8} /> Sair
        </Button>
        <ConfirmDialog
          open={signOutDialogOpen}
          title={isDemo ? "Sair do modo sem conta?" : "Sair da sua conta?"}
          description={isDemo
            ? "O progresso local deste dispositivo não será apagado. Você poderá acessá-lo novamente ao entrar por este dispositivo."
            : "A sessão será encerrada neste dispositivo. Seus dados salvos na conta permanecerão disponíveis quando você entrar novamente."}
          confirmLabel="Sair"
          confirmVariant="primary"
          loadingLabel="Encerrando…"
          onConfirm={() => void secureSignOut()}
          onClose={() => {
            if (!signOutBusy) setSignOutDialogOpen(false);
          }}
          loading={signOutBusy}
        />
      </div>

      {isDemo ? (
        <Panel className="mt-4 px-5 py-5">
          <p className="text-[13px] font-semibold">Perfis neste dispositivo</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Cada pessoa mantém seu próprio progresso. Os dados não são compartilhados entre perfis.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Perfil ativo">
              <Select value={activeLocalProfileId ?? ""} onChange={(e) => changeLocalProfile(e.target.value)}>
                {localProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <p className="pb-2 text-[10.5px] text-muted-foreground/70">{localProfiles.length} {localProfiles.length === 1 ? "perfil" : "perfis"}</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <TextInput
              value={newLocalProfileName}
              onChange={(e) => setNewLocalProfileName(e.target.value)}
              placeholder="Nome do novo perfil"
              onKeyDown={(e) => {
                if (e.key === "Enter") createLocalProfile();
              }}
            />
            <Button onClick={createLocalProfile} disabled={!newLocalProfileName.trim()}>
              Adicionar perfil
            </Button>
          </div>
          <p className="mt-3 text-[10.5px] text-muted-foreground/70">
            Modo local não usa e-mail e não sincroniza entre dispositivos. Para sincronizar, entre com Google.
          </p>
        </Panel>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Etapa" value={stageLabel} sub="ajusta a linguagem do app" accent="primary" />
        <Stat label="Disciplinas" value={String(subjects.length)} sub="ativas" />
        <Stat label="Escala de notas" value={`0 – ${form.grade_scale_max}`} sub={`aprovação ${form.grade_pass}`} />
        <Stat label="Meta semanal" value={`${Math.round(Number(form.weekly_study_target_minutes) / 60)}h`} sub={`limite diário ${Math.round(Number(form.daily_load_limit_minutes) / 60)}h`} accent="success" />
      </div>

      {active === "Conta" || active === "Preferências" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel className="px-5 py-5">
            <PanelHeader title="Conta e identidade" hint="dados básicos" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {user?.email ? (
                <Field label="E-mail da conta">
                  <TextInput value={user.email} readOnly aria-readonly="true" />
                </Field>
              ) : null}
              <Field label="Nome">
                <TextInput value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} autoComplete="name" />
              </Field>
              <Field label="Data de nascimento">
                <TextInput type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
              </Field>
              {derivedAge !== null ? (
                <Field label="Idade">
                  <TextInput value={String(derivedAge)} readOnly aria-readonly="true" />
                </Field>
              ) : null}
            </div>
          </Panel>

          <Panel className="px-5 py-5">
            <PanelHeader title="Localização" hint="onde você estuda" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="País">
                <TextInput value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Brasil" autoComplete="country-name" />
              </Field>
              <Field label="Estado">
                <TextInput value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="SP" autoComplete="address-level1" />
              </Field>
              <Field label="Cidade">
                <TextInput value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} autoComplete="address-level2" />
              </Field>
              <Field label="Fuso horário">
                <TextInput value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              </Field>
            </div>
          </Panel>

          <Panel className="px-5 py-5 lg:col-span-2">
            <PanelHeader title="Vínculo acadêmico" hint="instituição e etapa de ensino" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Escola / instituição">
                <TextInput value={form.school_name} onChange={(e) => setForm({ ...form, school_name: e.target.value })} autoComplete="organization" />
              </Field>
              <Field label="Etapa de ensino">
                <Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                  <option value="fundamental">Ensino fundamental</option>
                  <option value="medio">Ensino médio</option>
                  <option value="superior">Ensino superior</option>
                  <option value="pos">Pós-graduação</option>
                  <option value="outro">Outra etapa</option>
                </Select>
              </Field>
              <Field label="Ano / nível">
                <TextInput value={form.education_level} onChange={(e) => setForm({ ...form, education_level: e.target.value })} placeholder="Ex.: 2º ano" />
              </Field>
              <Field label="Curso">
                <TextInput value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} placeholder="Ex.: Engenharia" />
              </Field>
              <Field label="Turma">
                <TextInput value={form.class_name} onChange={(e) => setForm({ ...form, class_name: e.target.value })} placeholder="Ex.: 2B" />
              </Field>
            </div>
          </Panel>

          <Panel className="px-5 py-5 lg:col-span-2">
            <PanelHeader title="Configurações acadêmicas" hint="regras usadas pelo ORDYS" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Nota máxima">
                <TextInput value={form.grade_scale_max} onChange={(e) => setForm({ ...form, grade_scale_max: e.target.value })} />
              </Field>
              <Field label="Nota de aprovação">
                <TextInput value={form.grade_pass} onChange={(e) => setForm({ ...form, grade_pass: e.target.value })} />
              </Field>
              <Field label="Frequência mínima (%)">
                <TextInput value={form.attendance_target} onChange={(e) => setForm({ ...form, attendance_target: e.target.value })} />
              </Field>
              <Field label="Meta semanal de estudo (min)">
                <TextInput value={form.weekly_study_target_minutes} onChange={(e) => setForm({ ...form, weekly_study_target_minutes: e.target.value })} />
              </Field>
              <Field label="Limite diário de estudo (min)">
                <TextInput value={form.daily_load_limit_minutes} onChange={(e) => setForm({ ...form, daily_load_limit_minutes: e.target.value })} />
              </Field>
            </div>
            <Button className="mt-4" onClick={save}>Salvar alterações</Button>
          </Panel>
        </div>
      ) : null}

      {active === "Notificações" ? (
        isNativeAndroid() && nativeNotificationsDisabled ? (
          <Panel className="mt-4 px-5 py-5">
            <PanelHeader title="Notificações programadas indisponíveis" hint="Versão Android de instalação direta" />
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              Esta versão do ORDYS não agenda notificações fora do aplicativo e não solicita a permissão de notificações do Android.
              Suas tarefas, provas, aulas, metas e sessões continuam disponíveis na Agenda e no Assistente enquanto você usa o app.
              Os avisos programados poderão ser habilitados em uma versão futura, depois de configurar e testar a permissão do Android.
            </p>
          </Panel>
        ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <Panel>
            <PanelHeader title="Regras de notificação" hint="apenas o que é relevante" />
            <div className="border-t border-border">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium">Notificações ativas</p>
                  <p className="text-[11px] text-muted-foreground">Desative para silenciar tudo</p>
                </div>
                <span className="ml-auto shrink-0"><Toggle value={prefs?.enabled ?? true} onChange={(v) => togglePref("enabled", v)} /></span>
              </div>
              {prefFields.map((f) => (
                <div key={f.key} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px]">{f.label}</p>
                    <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                  </div>
                  <span className="ml-auto shrink-0"><Toggle
                    value={(prefs as Record<string, boolean> | undefined)?.[f.key] ?? true}
                    onChange={(v) => togglePref(f.key, v)}
                  /></span>
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
              <p className="text-[13px] font-semibold">Notificações do dispositivo</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                No Android, os lembretes são enviados pelo sistema e a permissão só é solicitada quando você toca em Ativar. No navegador, os avisos ficam disponíveis enquanto o ORDYS estiver aberto.
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
        )
      ) : null}

      {active === "Integrações" ? (
        <Panel className="mt-4">
          <PanelHeader title="Integrações de agenda" hint="eventos externos" />
          <div className="border-t border-border px-5 py-4">
            <p className="text-[12px] text-muted-foreground">
              Eventos importados aparecem na agenda junto das aulas, provas e sessões de estudo. As conexões disponíveis
              ficam vinculadas à sua conta e podem ser removidas a qualquer momento.
            </p>
            <div className="mt-3 space-y-2">
              {connections.length ? (
                connections.map((c) => (
                  <div key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
                    <span className="min-w-0 flex-1 basis-[9rem] truncate">{c.provider}</span>
                    <span className="min-w-0 basis-full break-all text-muted-foreground sm:basis-auto">{c.account_email ?? "—"}</span>
                    <Chip tone={c.status === "conectado" ? "success" : "muted"}>{c.status === "conectado" ? "Conectado" : c.status === "erro" ? "Erro" : "Pendente"}</Chip>
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


      {active === "Assinatura" ? (
        <div className="mt-4 space-y-4">
          {isDemo ? (
            <Panel className="px-5 py-5">
              <PanelHeader title="Assinatura indisponível no modo local" hint="Conta sincronizada necessária" />
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                Entre com uma conta para consultar ou contratar o Ordys Plus. Perfis locais não armazenam pagamentos nem assinaturas.
              </p>
            </Panel>
          ) : (
            <>
              <Panel className="px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <PanelHeader title="Ordys Plus" hint="Recursos avançados para sua rotina acadêmica" />
                    <p className="mt-2 max-w-[620px] text-[12px] leading-relaxed text-muted-foreground">
                      O plano gratuito continua disponível. O Plus libera os recursos avançados de IA mediante assinatura recorrente.
                    </p>
                  </div>
                  <Button variant="ghost" onClick={refreshBillingOverview} disabled={billingLoading || billingBusy}>
                    Atualizar status
                  </Button>
                </div>
                {billingLoading ? <p className="mt-4 text-[12px] text-muted-foreground">Consultando sua assinatura…</p> : null}
                {billingError ? (
                  <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3">
                    <p className="text-[12px] text-destructive">{billingError}</p>
                  </div>
                ) : null}
                {billingOverview?.subscription ? (
                  <div className="mt-4 rounded-lg border border-border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12.5px] font-semibold">Sua assinatura</p>
                      <Chip tone={billingOverview.subscription.hasAccess ? "success" : billingOverview.subscription.status === "past_due" ? "danger" : "muted"}>
                        {billingOverview.subscription.status === "active" ? "Ativa" :
                          billingOverview.subscription.status === "pending" ? "Pendente" :
                          billingOverview.subscription.status === "past_due" ? "Pagamento em atraso" :
                          billingOverview.subscription.status === "cancelled" ? "Cancelada" : "Suspensa"}
                      </Chip>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {billingOverview.subscription.status === "suspended"
                        ? "Esta assinatura está suspensa por estorno ou contestação e precisa de análise antes de uma nova contratação."
                        : billingOverview.subscription.status === "active" && !billingOverview.subscription.hasAccess
                          ? "O estado da assinatura precisa ser conciliado antes de iniciar uma nova contratação."
                          : billingOverview.subscription.hasAccess
                            ? billingOverview.subscription.status === "cancelled" ? "As próximas cobranças foram canceladas." : "Os recursos do Ordys Plus estão disponíveis nesta conta."
                            : "Os recursos do Plus não estão liberados no momento."}
                    </p>
                    {billingOverview.subscription.currentPeriodEnd ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Acesso até {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(billingOverview.subscription.currentPeriodEnd))}.
                      </p>
                    ) : null}
                    {billingOverview.subscription.status === "past_due" && billingOverview.subscription.graceUntil ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Regularize até {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(billingOverview.subscription.graceUntil))}.
                      </p>
                    ) : null}
                    {["pending", "active", "past_due", "suspended"].includes(billingOverview.subscription.status) ? (
                      <>
                        <Button variant="danger" className="mt-3" onClick={() => setCancelBillingDialogOpen(true)} disabled={billingBusy}>
                          Cancelar assinatura
                        </Button>
                        <ConfirmDialog
                          open={cancelBillingDialogOpen}
                          title="Cancelar assinatura do Ordys Plus?"
                          description="O cancelamento interrompe as próximas cobranças. O acesso permanece até o fim do período já pago, quando houver."
                          confirmLabel="Cancelar assinatura"
                          confirmVariant="danger"
                          loadingLabel="Cancelando…"
                          onConfirm={() => void cancelBillingSubscription()}
                          onClose={() => {
                            if (!billingBusy) setCancelBillingDialogOpen(false);
                          }}
                          loading={billingBusy}
                        />
                      </>
                    ) : null}
                  </div>
                ) : null}
                {billingOverview?.enabled === false ? (
                  <div className="mt-4 rounded-lg border border-border bg-secondary/20 px-4 py-3">
                    <p className="text-[12px] font-medium">Novas contratações temporariamente pausadas</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      O Ordys Plus não está aceitando novas assinaturas no momento. Quem já possui um período pago mantém o acesso até a data final, e o cancelamento continua disponível.
                    </p>
                  </div>
                ) : null}
              </Panel>
              {billingOverview?.enabled && billingOverview.plans.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {billingOverview.plans.map((plan) => (
                    <Panel key={plan.plan_code} className="px-5 py-5">
                      <p className="text-[13px] font-semibold">{plan.title}</p>
                      <p className="mt-1 min-h-10 text-[11px] leading-relaxed text-muted-foreground">{plan.description}</p>
                      <p className="mt-3 text-[23px] font-semibold tracking-tight">
                        {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(plan.price_cents / 100)}
                        <span className="ml-1 text-[11px] font-normal text-muted-foreground">/ {plan.billing_cycle === "YEARLY" ? "ano" : "mês"}</span>
                      </p>
                      <p className="mt-1 text-[10.5px] text-muted-foreground">Cobrança recorrente no cartão, processada pelo Asaas.</p>
                      <Button
                        className="mt-4 w-full"
                        onClick={() => startBillingCheckout(plan.plan_code)}
                        disabled={billingBusy || billingOverview.subscription?.hasAccess === true || ["pending", "active", "past_due", "suspended"].includes(billingOverview.subscription?.status ?? "")}
                      >
                        <CreditCard className="size-[13px]" strokeWidth={1.8} />
                        {billingBusy ? "Abrindo pagamento…" : "Assinar Ordys Plus"}
                      </Button>
                    </Panel>
                  ))}
                </div>
              ) : null}
              <Panel className="px-5 py-4">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  A contratação inicial está disponível somente para contas de pessoas com 18 anos ou mais. A primeira cobrança está programada para 24 horas após a abertura do checkout, e o acesso ao Plus é liberado após a confirmação do pagamento pelo Asaas. Cancelamentos interrompem as próximas cobranças; o acesso permanece até o fim do período já pago. As cobranças e os dados de cartão são processados na página segura do Asaas.
                </p>
              </Panel>
            </>
          )}
        </div>
      ) : null}

      {active === "Conta" ? (
        <Panel className="mt-4">
          <PanelHeader title="Privacidade e dados" hint="apenas você" />
          <div className="space-y-3 border-t border-border px-5 py-4">
            <p className="text-[12px] text-muted-foreground">
              Todos os seus dados acadêmicos (notas, frequência, anotações, simulados e hábitos de estudo) são privados e
              acessíveis somente pela sua conta autenticada.
            </p>
            <Button variant="ghost" onClick={() => navigate({ to: "/excluir-conta" })}>
              Excluir conta e dados
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
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      className="grid size-11 shrink-0 place-items-center rounded-full"
    >
      <span className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-primary" : "bg-secondary"}`}>
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-background transition-all ${
            value ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
