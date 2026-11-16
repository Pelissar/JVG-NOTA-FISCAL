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
    rest<SubscriptionRow>(`/rest/v1/jvg_subscriptions?tenant_id=${filterEq(account.tenant_id)}&select=tenant_id,plan_code,status,current_period_started_at,current_period_ends_at&limit=1`),
    rest<{ company_id: string }>(`/rest/v1/jvg_company_focus_credentials?company_id=${filterEq(account.company_id)}&select=company_id&limit=1`),
    rest<{ document_code: string; status: string }>(`/rest/v1/jvg_company_documents?company_id=${filterEq(account.company_id)}&select=document_code,status&limit=20`),
    rest<{ code: string; name: string }>(`/rest/v1/jvg_subscription_plans?select=code,name&limit=20`),
  ]);
  if (subscriptionResult.missing || credentialResult.missing) {
    return { schemaReady: false, issues: [], focusConfigured: false, allowsSiteToken: true, planCode: null, planName: null, status: null, endsAt: null };
  }
  const subscription = subscriptionResult.rows[0];
  const planName = planResult.rows.find((plan) => plan.code === subscription?.plan_code)?.name ?? subscription?.plan_code ?? null;
  const focusConfigured = credentialResult.rows.length > 0;
  const commercial = Boolean(subscription && subscription.plan_code !== "pilot");
  const issues: string[] = [];
  if (!subscription) issues.push("A empresa ainda não tem licença. O administrador precisa liberar a assinatura.");
  else if (subscription.status === "trialing" || subscription.status === "incomplete") issues.push("A licença ainda não foi liberada.");
  else if (subscription.status === "paused" || subscription.status === "past_due") issues.push("A assinatura está suspensa.");
  else if (subscription.status === "canceled") issues.push("A assinatura foi encerrada.");
  else if (subscription.status !== "active") issues.push("A assinatura não está ativa.");
  if (subscription?.current_period_ends_at && Date.parse(subscription.current_period_ends_at) <= Date.now()) {
    issues.push("A assinatura venceu. Peça a renovação ao administrador.");
  }
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
    endsAt: subscription?.current_period_ends_at ?? null,
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
