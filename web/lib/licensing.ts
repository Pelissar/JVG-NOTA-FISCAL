import "server-only";
import type { SiteAccount } from "./jvg-backend";
import { JvgBackendError, filterEq } from "./jvg-backend";
import { jvgRuntime } from "./jvg-runtime";

export const LICENSE_DOCUMENTS = [
  ["cartao_cnpj", "Cartão CNPJ"],
  ["contrato_social", "Contrato social ou CCMEI"],
  ["inscricao_estadual", "Inscrição estadual"],
  ["comprovante_endereco", "Comprovante de endereço"],
  ["certificado_focus", "Certificado conferido no painel da Focus"],
] as const;

const PLAN_DAYS: Record<string, number> = { month: 30, quarter: 90, semester: 180, year: 365 };

type SubscriptionRow = {
  tenant_id: string;
  plan_code: string;
  status: string;
  current_period_started_at: string | null;
  current_period_ends_at: string | null;
  trial_ends_at?: string | null;
  temporary_access_until?: string | null;
};

export type LicenseView = {
  schemaReady: boolean;
  issues: string[];
  focusConfigured: boolean;
  allowsSiteToken: boolean;
  planCode: string | null;
  planName: string | null;
  status: string | null;
  endsAt: string | null;
  accessAllowed: boolean;
  gracePeriodDays: number;
  graceEndsAt: string | null;
  temporaryAccessUntil: string | null;
};

async function rest<T>(path: string): Promise<{ missing: boolean; rows: T[] }> {
  const runtime = jvgRuntime();
  if (!runtime.supabaseUrl || !runtime.supabaseSecretKey) return { missing: true, rows: [] };
  const headers = new Headers();
  headers.set("apikey", runtime.supabaseSecretKey);
  if (runtime.supabaseSecretKey.split(".").length === 3) headers.set("Authorization", `Bearer ${runtime.supabaseSecretKey}`);
  headers.set("Accept", "application/json");
  const response = await fetch(`${runtime.supabaseUrl}${path}`, { headers, cache: "no-store" });
  const raw = await response.text();
  if (!response.ok) {
    const missing = /42P01|PGRST205|does not exist|schema cache/i.test(raw);
    if (missing) return { missing: true, rows: [] };
    throw new JvgBackendError("Não foi possível consultar a licença.", 502);
  }
  const parsed = raw ? JSON.parse(raw) as T[] : [];
  return { missing: false, rows: Array.isArray(parsed) ? parsed : [] };
}

export function planDays(interval: string): number {
  return PLAN_DAYS[interval] ?? 30;
}

export async function licenseView(account: SiteAccount): Promise<LicenseView> {
  const [subscriptionResult, credentialResult, documentResult, planResult] = await Promise.all([
    rest<SubscriptionRow>(`/rest/v1/jvg_subscriptions?tenant_id=${filterEq(account.tenant_id)}&select=tenant_id,plan_code,status,current_period_started_at,current_period_ends_at,trial_ends_at,temporary_access_until&limit=1`),
    rest<{ company_id: string }>(`/rest/v1/jvg_company_focus_credentials?company_id=${filterEq(account.company_id)}&select=company_id&limit=1`),
    rest<{ document_code: string; status: string }>(`/rest/v1/jvg_company_documents?company_id=${filterEq(account.company_id)}&select=document_code,status&limit=20`),
    rest<{ code: string; name: string; grace_period_days?: number }>(`/rest/v1/jvg_subscription_plans?select=code,name,grace_period_days&limit=20`),
  ]);
  if (subscriptionResult.missing || credentialResult.missing) {
    return { schemaReady: false, issues: [], focusConfigured: false, allowsSiteToken: true, planCode: null, planName: null, status: null, endsAt: null, accessAllowed: true, gracePeriodDays: 0, graceEndsAt: null, temporaryAccessUntil: null };
  }
  const subscription = subscriptionResult.rows[0];
  const plan = planResult.rows.find((item) => item.code === subscription?.plan_code);
  const planName = plan?.name ?? subscription?.plan_code ?? null;
  const gracePeriodDays = Math.max(0, Math.min(60, Number(plan?.grace_period_days ?? 15)));
  const endsAt = subscription?.current_period_ends_at || subscription?.trial_ends_at || null;
  const graceEndsAt = endsAt ? new Date(Date.parse(endsAt) + gracePeriodDays * 86400000).toISOString() : null;
  const temporaryAccessUntil = subscription?.temporary_access_until ?? null;
  const now = Date.now();
  const periodOpen = !endsAt || Date.parse(endsAt) > now;
  const graceOpen = Boolean(graceEndsAt && Date.parse(graceEndsAt) > now);
  const temporaryOpen = Boolean(temporaryAccessUntil && Date.parse(temporaryAccessUntil) > now);
  const paymentReported = Boolean(temporaryAccessUntil);
  const accessAllowed = !subscription || subscription.plan_code === "pilot" ||
    (subscription.status === "active" && periodOpen) ||
    ((subscription.status === "active" || subscription.status === "past_due") &&
      (temporaryOpen || (!paymentReported && graceOpen))) ||
    (subscription.status === "trialing" && Boolean(subscription.trial_ends_at && Date.parse(subscription.trial_ends_at) > now));
  const focusConfigured = credentialResult.rows.length > 0;
  const commercial = Boolean(subscription && subscription.plan_code !== "pilot");
  const issues: string[] = [];
  if (!subscription) issues.push("A empresa ainda não tem licença. O administrador precisa liberar a assinatura.");
  else if (subscription.status === "trialing" || subscription.status === "incomplete") issues.push("A licença ainda não foi liberada.");
  else if (subscription.status === "paused") issues.push("A assinatura está suspensa.");
  else if (subscription.status === "past_due" && temporaryOpen) issues.push("Pagamento informado. O acesso temporário ficará disponível por até 48 horas enquanto a equipe financeira confere a compensação.");
  else if ((subscription.status === "past_due" || (endsAt && Date.parse(endsAt) <= now)) && graceOpen) issues.push(`Assinatura vencida. O acesso será suspenso ao final do prazo de ${gracePeriodDays} dias, em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(graceEndsAt!))}.`);
  else if (subscription.status === "past_due" || (endsAt && Date.parse(endsAt) <= now)) issues.push("A assinatura venceu e o acesso foi suspenso. Consulte as cobranças ou fale com a equipe financeira.");
  else if (subscription.status === "canceled") issues.push("A assinatura foi encerrada.");
  else if (subscription.status !== "active") issues.push("A assinatura não está ativa.");
  if (commercial && subscription?.status === "active") {
    const approved = new Set(documentResult.rows.filter((row) => row.status === "approved").map((row) => row.document_code));
    const missing = LICENSE_DOCUMENTS.filter(([code]) => !approved.has(code)).map(([, label]) => label);
    if (missing.length) issues.push("Documentos ainda não aprovados: " + missing.join(", ") + ".");
    if (!focusConfigured) issues.push("Falta cadastrar o token da Focus desta empresa.");
  }
  return {
    schemaReady: true,
    issues,
    focusConfigured,
    allowsSiteToken: !commercial,
    planCode: subscription?.plan_code ?? null,
    planName,
    status: subscription?.status ?? null,
    endsAt,
    accessAllowed,
    gracePeriodDays,
    graceEndsAt,
    temporaryAccessUntil,
  };
}

export async function homologationToken(account: SiteAccount, siteToken: string): Promise<string> {
  const stored = await rest<{ homolog_token: string }>(
    `/rest/v1/jvg_company_focus_credentials?company_id=${filterEq(account.company_id)}&select=homolog_token&limit=1`,
  );
  const companyToken = stored.missing ? "" : String(stored.rows[0]?.homolog_token || "");
  if (companyToken) return companyToken;
  const license = await licenseView(account);
  if (license.allowsSiteToken && siteToken) return siteToken;
  throw new JvgBackendError("Esta empresa precisa do token da Focus cadastrado pelo administrador.", 409);
}
