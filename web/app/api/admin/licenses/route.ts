import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getPlatformRole, isSameOrigin, safeError } from "../../../../lib/jvg-backend";
import { JvgBackendError } from "../../../../lib/jvg-errors";
import { LICENSE_DOCUMENTS, planDays } from "../../../../lib/licensing";

export const dynamic = "force-dynamic";

type CompanyRow = { id: string; tenant_id: string; legal_name: string; trade_name: string | null; cnpj: string | null };
type PlanRow = { code: string; name: string; billing_interval: string };
type SubscriptionRow = { tenant_id: string; plan_code: string; status: string; current_period_started_at: string | null; current_period_ends_at: string | null };
type DocumentRow = { company_id: string; document_code: string; status: string; note: string | null };
type CredentialRow = { company_id: string; homolog_token: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLANS = new Set(["mensal", "trimestral", "semestral", "anual"]);
const DOC_STATUS = new Set(["pending", "received", "approved", "rejected"]);

async function requireAdmin(request?: Request) {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  if (await getPlatformRole(user) !== "platform_admin") throw new JvgBackendError("Acesso exclusivo do administrador da plataforma.", 403);
  if (request && !isSameOrigin(request)) throw new JvgBackendError("Origem não autorizada.", 403);
  return user;
}

function hint(token: string): string {
  const clean = token.trim();
  return clean.length >= 4 ? clean.slice(-4) : "";
}

export async function GET() {
  try {
    await requireAdmin();
    const [companies, plans, subscriptions, documents, credentials] = await Promise.all([
      dbRequest<CompanyRow[]>("/rest/v1/jvg_companies?select=id,tenant_id,legal_name,trade_name,cnpj&order=legal_name.asc&limit=100"),
      dbRequest<PlanRow[]>("/rest/v1/jvg_subscription_plans?active=eq.true&select=code,name,billing_interval&order=code.asc&limit=20"),
      dbRequest<SubscriptionRow[]>("/rest/v1/jvg_subscriptions?select=tenant_id,plan_code,status,current_period_started_at,current_period_ends_at&limit=100"),
      dbRequest<DocumentRow[]>("/rest/v1/jvg_company_documents?select=company_id,document_code,status,note&limit=500"),
      dbRequest<CredentialRow[]>("/rest/v1/jvg_company_focus_credentials?select=company_id,homolog_token&limit=100"),
    ]);
    const planName = new Map(plans.map((plan) => [plan.code, plan.name]));
    return apiJson({
      needsMigration: false,
      plans: plans.filter((plan) => PLANS.has(plan.code)).map((plan) => ({
        code: plan.code, name: plan.name, days: planDays(plan.billing_interval),
      })),
      documents: LICENSE_DOCUMENTS.map(([code, label]) => ({ code, label })),
      companies: companies.map((company) => {
        const license = subscriptions.find((item) => item.tenant_id === company.tenant_id);
        const token = credentials.find((item) => item.company_id === company.id)?.homolog_token || "";
        return {
          id: company.id,
          legalName: company.legal_name,
          tradeName: company.trade_name || "",
          cnpj: company.cnpj || "",
          license: {
            planCode: license?.plan_code || "",
            planName: planName.get(license?.plan_code || "") || license?.plan_code || "Sem plano",
            status: license?.status || "incomplete",
            startsAt: license?.current_period_started_at || null,
            endsAt: license?.current_period_ends_at || null,
          },
          focus: { configured: Boolean(token), hint: hint(token) },
          documents: LICENSE_DOCUMENTS.map(([code]) => {
            const saved = documents.find((item) => item.company_id === company.id && item.document_code === code);
            return { code, status: saved?.status || "pending", note: saved?.note || "" };
          }),
        };
      }),
    });
  } catch (error) {
    if (error instanceof JvgBackendError && error.status === 502) {
      return apiJson({ needsMigration: true, plans: [], documents: [], companies: [] });
    }
    return safeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin(request);
    const body = await request.json() as Record<string, unknown>;
    const companyId = String(body.companyId || "");
    if (!UUID.test(companyId)) throw new JvgBackendError("Empresa inválida.", 400);
    const companies = await dbRequest<CompanyRow[]>(`/rest/v1/jvg_companies?id=${filterEq(companyId)}&select=id,tenant_id,legal_name,trade_name,cnpj&limit=1`);
    const company = companies[0];
    if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
    const action = String(body.action || "");

    if (action === "activate" || action === "pause" || action === "cancel") {
      const now = new Date();
      const values: Record<string, unknown> = { updated_at: now.toISOString(), billing_provider: "manual" };
      if (action === "activate") {
        const planCode = String(body.planCode || "");
        if (!PLANS.has(planCode)) throw new JvgBackendError("Escolha um plano mensal, trimestral, semestral ou anual.", 400);
        const plans = await dbRequest<PlanRow[]>(`/rest/v1/jvg_subscription_plans?code=${filterEq(planCode)}&select=code,name,billing_interval&limit=1`);
        if (!plans[0]) throw new JvgBackendError("Plano não encontrado. Aplique a migration de licenças.", 409);
        const ends = new Date(now.getTime() + planDays(plans[0].billing_interval) * 86400000);
        Object.assign(values, { plan_code: planCode, status: "active", current_period_started_at: now.toISOString(), current_period_ends_at: ends.toISOString() });
      } else {
        values.status = action === "pause" ? "paused" : "canceled";
      }
      const updated = await dbRequest<SubscriptionRow[]>(
        `/rest/v1/jvg_subscriptions?tenant_id=${filterEq(company.tenant_id)}&select=tenant_id`,
        { method: "PATCH", body: JSON.stringify(values) },
      );
      if (!updated[0] && action === "activate") {
        await dbRequest("/rest/v1/jvg_subscriptions", {
          method: "POST",
          body: JSON.stringify({ tenant_id: company.tenant_id, ...values }),
        });
      }
      return apiJson({ ok: true });
    }

    if (action === "document") {
      const documentCode = String(body.documentCode || "");
      const status = String(body.status || "");
      const note = String(body.note || "").trim().slice(0, 400);
      if (!LICENSE_DOCUMENTS.some(([code]) => code === documentCode)) throw new JvgBackendError("Documento inválido.", 400);
      if (!DOC_STATUS.has(status)) throw new JvgBackendError("Situação do documento inválida.", 400);
      await dbRequest("/rest/v1/jvg_company_documents?on_conflict=company_id,document_code", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          tenant_id: company.tenant_id, company_id: company.id, document_code: documentCode,
          status, note: note || null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }),
      });
      return apiJson({ ok: true });
    }

    if (action === "token") {
      const token = String(body.token || "").trim();
      if (!token) {
        await dbRequest(`/rest/v1/jvg_company_focus_credentials?company_id=${filterEq(company.id)}&select=company_id`, { method: "DELETE" });
        return apiJson({ ok: true, focus: { configured: false, hint: "" } });
      }
      if (!/^[A-Za-z0-9._~+/=-]{8,300}$/.test(token)) throw new JvgBackendError("O token da Focus deve ter entre 8 e 300 caracteres, sem espaços.", 400);
      await dbRequest("/rest/v1/jvg_company_focus_credentials?on_conflict=company_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ company_id: company.id, tenant_id: company.tenant_id, homolog_token: token, updated_at: new Date().toISOString() }),
      });
      return apiJson({ ok: true, focus: { configured: true, hint: hint(token) } });
    }

    throw new JvgBackendError("Ação inválida.", 400);
  } catch (error) { return safeError(error); }
}
