import { getJvgUser } from "../../../jvg-auth";
import { BUSINESS_TYPES } from "../../../../lib/business-types";
import { apiJson, dbRequest, filterEq, getPlatformRole, isSameOrigin, JvgBackendError, safeError, str } from "../../../../lib/jvg-backend";
import { planDays } from "../../../../lib/licensing";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_CODE = /^[a-z][a-z0-9_-]{1,39}$/;
const CONTENT_TYPES = new Set(["changelog", "article"]);
const INTERVALS = new Set(["month", "quarter", "semester", "year"]);
const STATUSES = new Set(["new", "contacted", "approved", "closed"]);
const PAYMENT_STATUSES = new Set(["open", "payment_reported", "paid", "overdue", "canceled"]);

async function requireAdmin(request?: Request) {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  if (await getPlatformRole(user) !== "platform_admin") throw new JvgBackendError("Acesso exclusivo do administrador da plataforma.", 403);
  if (request && !isSameOrigin(request)) throw new JvgBackendError("Origem não autorizada.", 403);
  return user;
}

async function recordAdminAction(userId: string, action: string, entityType: string, entityId: string, details: Record<string, unknown>) {
  await dbRequest("/rest/v1/jvg_platform_audit_log", {
    method: "POST",
    body: JSON.stringify({ admin_user_id: userId, action, entity_type: entityType, entity_id: entityId, details, created_at: new Date().toISOString() }),
  });
}

function slugify(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function optionalHttps(value: unknown, label: string) {
  const raw = str(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("protocol");
    return url.toString();
  } catch { throw new JvgBackendError(`${label} precisa ser um endereço HTTPS válido.`, 400); }
}

export async function GET() {
  try {
    await requireAdmin();
    const [companies, plans, subscriptions, documents, applications, charges, content, invites] = await Promise.all([
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_companies?select=id,tenant_id,legal_name,trade_name,cnpj,business_type,status&order=legal_name.asc&limit=500"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_subscription_plans?select=code,name,description,billing_interval,amount_minor,currency,max_users,max_companies,features,active,is_public,sort_order,grace_period_days,enabled_business_types&order=sort_order.asc,name.asc&limit=100"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_subscriptions?select=id,tenant_id,plan_code,status,current_period_started_at,current_period_ends_at,temporary_access_until,past_due_since&limit=500"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_company_documents?select=company_id,document_code,status,note,reviewed_at&limit=1000"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_onboarding_requests?select=id,case_code,company_name,contact_name,email,cnpj,phone,business_type,message,status,admin_note,linked_company_id,contacted_at,created_at,updated_at&order=created_at.desc&limit=500"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_billing_charges?select=id,tenant_id,company_id,subscription_id,description,amount_minor,currency,due_at,status,payment_method,boleto_url,boleto_line,pix_copy_paste,pix_qr_url,provider_reference,payment_reported_at,temporary_access_until,paid_at,admin_note,created_at&order=due_at.desc&limit=1000"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_platform_content?select=id,content_type,slug,title,summary,body,status,published_at,author_name,created_at,updated_at&order=updated_at.desc&limit=500"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_company_invites?select=id,tenant_id,company_id,user_id,email,display_name,role,status,invited_at&order=created_at.desc&limit=1000"),
    ]);
    const planByCode = new Map(plans.map((plan) => [String(plan.code), plan]));
    const subByTenant = new Map(subscriptions.map((subscription) => [String(subscription.tenant_id), subscription]));
    const companiesView = companies.map((company) => {
      const subscription = subByTenant.get(String(company.tenant_id));
      const plan = subscription ? planByCode.get(String(subscription.plan_code)) : undefined;
      return {
        id: company.id, tenantId: company.tenant_id, legalName: company.legal_name,
        tradeName: company.trade_name || "", cnpj: company.cnpj || "",
        businessType: company.business_type || "comercio", status: company.status,
        subscription: subscription ? {
          id: subscription.id, planCode: subscription.plan_code, planName: plan?.name || subscription.plan_code,
          status: subscription.status, startsAt: subscription.current_period_started_at,
          endsAt: subscription.current_period_ends_at, temporaryAccessUntil: subscription.temporary_access_until,
          gracePeriodDays: Number(plan?.grace_period_days ?? 15),
        } : null,
        documents: documents.filter((document) => document.company_id === company.id),
        invites: invites.filter((invite) => invite.company_id === company.id),
        charges: charges.filter((charge) => charge.company_id === company.id),
      };
    });
    const chargeView = charges.map((charge) => ({
      ...charge,
      company_name: companies.find((company) => company.id === charge.company_id)?.trade_name || companies.find((company) => company.id === charge.company_id)?.legal_name || "Empresa",
      status: charge.status === "open" && Date.parse(String(charge.due_at)) < Date.now() ? "overdue" : charge.status,
    }));
    return apiJson({
      companies: companiesView,
      plans: plans.map((plan) => ({ ...plan, amount_minor: plan.amount_minor === null ? null : Number(plan.amount_minor) })),
      applications, content,
      charges: chargeView,
      invites,
      summary: {
        companies: companies.length,
        active: subscriptions.filter((item) => item.status === "active").length,
        pendingApplications: applications.filter((item) => item.status === "new").length,
        openCharges: chargeView.filter((item) => ["open", "overdue", "payment_reported"].includes(String(item.status))).length,
      },
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await request.json() as Record<string, unknown>;
    const action = str(body.action, 40);
    const now = new Date().toISOString();

    if (action === "plan") {
      const code = str(body.code, 40).toLowerCase();
      const name = str(body.name, 80);
      const interval = str(body.interval, 20);
      const amountMinor = body.amountMinor === "" || body.amountMinor == null ? null : Number(body.amountMinor);
      const graceDays = Number(body.gracePeriodDays ?? 15);
      const enabledBusinessTypes = Array.isArray(body.enabledBusinessTypes) ? body.enabledBusinessTypes.map((value) => str(value, 40)) : [];
      if (!PLAN_CODE.test(code) || name.length < 2) throw new JvgBackendError("Informe um código e nome válidos para o plano.", 400);
      if (!INTERVALS.has(interval)) throw new JvgBackendError("Escolha uma periodicidade válida.", 400);
      if (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor < 0)) throw new JvgBackendError("Preço do plano inválido.", 400);
      if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 60) throw new JvgBackendError("O prazo após vencimento deve ficar entre 0 e 60 dias.", 400);
      if (enabledBusinessTypes.some((code: string) => !BUSINESS_TYPES.some((item) => item.code === code))) throw new JvgBackendError("Um dos segmentos selecionados é inválido.", 400);
      await dbRequest("/rest/v1/jvg_subscription_plans", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          code, name, description: str(body.description, 1200), billing_interval: interval,
          amount_minor: amountMinor, currency: "BRL", max_users: body.maxUsers ? Number(body.maxUsers) : null,
          max_companies: body.maxCompanies ? Number(body.maxCompanies) : 1,
          features: body.features && typeof body.features === "object" && !Array.isArray(body.features) ? body.features : {},
          enabled_business_types: enabledBusinessTypes, grace_period_days: graceDays,
          is_public: body.isPublic === true, active: body.active !== false,
          sort_order: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
          updated_at: now,
        }),
      });
      await recordAdminAction(user.userId, "create_subscription_plan", "subscription_plan", code, { interval, amountMinor, graceDays, enabledBusinessTypes });
      return apiJson({ ok: true });
    }

    if (action === "content") {
      const type = str(body.contentType, 20);
      const title = str(body.title, 180);
      const slug = slugify(str(body.slug, 100) || title);
      if (!CONTENT_TYPES.has(type) || title.length < 3 || !slug) throw new JvgBackendError("Informe tipo, título e endereço válidos para o conteúdo.", 400);
      const status = body.status === "published" ? "published" : "draft";
      await dbRequest("/rest/v1/jvg_platform_content", {
        method: "POST", body: JSON.stringify({
          content_type: type, slug, title, summary: str(body.summary, 500), body: str(body.body, 30000),
          status, published_at: status === "published" ? now : null, author_name: user.displayName,
          updated_at: now,
        }),
      });
      await recordAdminAction(user.userId, "create_platform_content", "platform_content", slug, { type, status });
      return apiJson({ ok: true });
    }

    if (action === "charge") {
      const companyId = str(body.companyId, 40);
      if (!UUID.test(companyId)) throw new JvgBackendError("Selecione uma empresa válida.", 400);
      const companies = await dbRequest<Array<{ id: string; tenant_id: string }>>(`/rest/v1/jvg_companies?id=${filterEq(companyId)}&select=id,tenant_id&limit=1`);
      const company = companies[0];
      if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
      const amountMinor = Number(body.amountMinor);
      const dueAt = str(body.dueAt, 40);
      const paymentMethod = str(body.paymentMethod, 20);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new JvgBackendError("Informe o valor da cobrança em centavos.", 400);
      if (!Number.isFinite(Date.parse(dueAt))) throw new JvgBackendError("Informe uma data de vencimento válida.", 400);
      if (!["boleto", "pix", "manual"].includes(paymentMethod)) throw new JvgBackendError("Escolha boleto, Pix ou cobrança manual.", 400);
      const subscriptions = await dbRequest<Array<{ id: string }>>(`/rest/v1/jvg_subscriptions?tenant_id=${filterEq(company.tenant_id)}&select=id&limit=1`);
      await dbRequest("/rest/v1/jvg_billing_charges", {
        method: "POST", body: JSON.stringify({
          tenant_id: company.tenant_id, company_id: company.id, subscription_id: subscriptions[0]?.id || null,
          description: str(body.description, 180) || "Assinatura SigmaFiscal", amount_minor: amountMinor,
          due_at: new Date(dueAt).toISOString(), payment_method: paymentMethod,
          boleto_url: optionalHttps(body.boletoUrl, "Link do boleto"), boleto_line: str(body.boletoLine, 300),
          pix_copy_paste: str(body.pixCopyPaste, 5000), pix_qr_url: optionalHttps(body.pixQrUrl, "QR Code Pix"),
          provider_reference: str(body.providerReference, 120) || null,
          admin_note: str(body.adminNote, 1000), status: "open", created_at: now, updated_at: now,
        }),
      });
      await dbRequest("/rest/v1/jvg_platform_audit_log", { method: "POST", body: JSON.stringify({ admin_user_id: user.userId, action: "create_charge", entity_type: "billing_charge", entity_id: company.id, details: { amountMinor, paymentMethod }, created_at: now }) });
      return apiJson({ ok: true }, 201);
    }

    throw new JvgBackendError("Ação administrativa inválida.", 400);
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await request.json() as Record<string, unknown>;
    const action = str(body.action, 40);
    const now = new Date().toISOString();

    if (action === "application") {
      const id = str(body.id, 40);
      const status = str(body.status, 20);
      if (!UUID.test(id) || !STATUSES.has(status)) throw new JvgBackendError("Cadastro ou situação inválida.", 400);
      const applications = await dbRequest<Array<{ id: string; cnpj: string }>>(`/rest/v1/jvg_onboarding_requests?id=${filterEq(id)}&select=id,cnpj&limit=1`);
      if (!applications[0]) throw new JvgBackendError("Solicitação não encontrada.", 404);
      const linkedCompanyId = str(body.linkedCompanyId, 40);
      let linkedCompany: { id: string } | null = null;
      if (linkedCompanyId) {
        if (!UUID.test(linkedCompanyId)) throw new JvgBackendError("Empresa vinculada inválida.", 400);
        const matching = await dbRequest<Array<{ id: string; cnpj: string | null }>>(`/rest/v1/jvg_companies?id=${filterEq(linkedCompanyId)}&select=id,cnpj&limit=1`);
        if (!matching[0] || String(matching[0].cnpj || "").toUpperCase().replace(/[^A-Z0-9]/g, "") !== applications[0].cnpj)
          throw new JvgBackendError("A empresa selecionada não corresponde ao CNPJ da solicitação.", 409);
        linkedCompany = matching[0];
      }
      await dbRequest(`/rest/v1/jvg_onboarding_requests?id=${filterEq(id)}`, {
        method: "PATCH", body: JSON.stringify({ status, admin_note: str(body.adminNote, 2000), ...(linkedCompany ? { linked_company_id: linkedCompany.id } : {}), contacted_at: status === "contacted" ? now : undefined, updated_at: now }),
      });
      await recordAdminAction(user.userId, "update_onboarding_request", "onboarding_request", id, { status, linkedCompanyId: linkedCompany?.id || null });
      return apiJson({ ok: true });
    }

    if (action === "plan") {
      const code = str(body.code, 40);
      if (!PLAN_CODE.test(code)) throw new JvgBackendError("Plano inválido.", 400);
      const interval = str(body.interval, 20);
      const amountMinor = body.amountMinor === "" || body.amountMinor == null ? null : Number(body.amountMinor);
      const graceDays = Number(body.gracePeriodDays ?? 15);
      if (!INTERVALS.has(interval) || (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor < 0)) || !Number.isInteger(graceDays) || graceDays < 0 || graceDays > 60) throw new JvgBackendError("Revise periodicidade, preço e prazo de tolerância do plano.", 400);
      const types = Array.isArray(body.enabledBusinessTypes) ? body.enabledBusinessTypes.map((value) => str(value, 40)) : [];
      if (types.some((type: string) => !BUSINESS_TYPES.some((item) => item.code === type))) throw new JvgBackendError("Segmento de empresa inválido.", 400);
      await dbRequest(`/rest/v1/jvg_subscription_plans?code=${filterEq(code)}`, {
        method: "PATCH", body: JSON.stringify({
          name: str(body.name, 80), description: str(body.description, 1200), billing_interval: interval,
          amount_minor: amountMinor, grace_period_days: graceDays, is_public: body.isPublic === true,
          active: body.active !== false, sort_order: Number(body.sortOrder) || 100,
          enabled_business_types: types, max_users: body.maxUsers ? Number(body.maxUsers) : null,
          max_companies: body.maxCompanies ? Number(body.maxCompanies) : 1,
          features: body.features && typeof body.features === "object" && !Array.isArray(body.features) ? body.features : {}, updated_at: now,
        }),
      });
      await recordAdminAction(user.userId, "update_subscription_plan", "subscription_plan", code, { interval, amountMinor, graceDays, enabledBusinessTypes: types });
      return apiJson({ ok: true });
    }

    if (action === "content") {
      const id = str(body.id, 40);
      const status = str(body.status, 20);
      if (!UUID.test(id) || !["draft", "published", "archived"].includes(status)) throw new JvgBackendError("Conteúdo ou situação inválida.", 400);
      const title = str(body.title, 180);
      const slug = slugify(str(body.slug, 100) || title);
      if (title.length < 3 || !slug) throw new JvgBackendError("Informe título e endereço válidos.", 400);
      const existing = await dbRequest<Array<{ published_at: string | null }>>(`/rest/v1/jvg_platform_content?id=${filterEq(id)}&select=published_at&limit=1`);
      await dbRequest(`/rest/v1/jvg_platform_content?id=${filterEq(id)}`, {
        method: "PATCH", body: JSON.stringify({
          content_type: CONTENT_TYPES.has(str(body.contentType, 20)) ? body.contentType : "article",
          slug, title, summary: str(body.summary, 500), body: str(body.body, 30000), status,
          published_at: status === "published" ? existing[0]?.published_at || now : null,
          updated_at: now,
        }),
      });
      await recordAdminAction(user.userId, "update_platform_content", "platform_content", id, { status });
      return apiJson({ ok: true });
    }

    if (action === "charge") {
      const id = str(body.id, 40);
      const status = str(body.status, 20);
      if (!UUID.test(id) || !PAYMENT_STATUSES.has(status)) throw new JvgBackendError("Cobrança ou situação inválida.", 400);
      const charge = await dbRequest<Array<{ tenant_id: string; subscription_id: string | null }>>(`/rest/v1/jvg_billing_charges?id=${filterEq(id)}&select=tenant_id,subscription_id&limit=1`);
      if (!charge[0]) throw new JvgBackendError("Cobrança não encontrada.", 404);
      await dbRequest(`/rest/v1/jvg_billing_charges?id=${filterEq(id)}`, { method: "PATCH", body: JSON.stringify({ status, paid_at: status === "paid" ? now : null, updated_at: now }) });
      if (status === "paid" && charge[0].subscription_id) {
        const subscriptions = await dbRequest<Array<{ id: string; plan_code: string }>>(`/rest/v1/jvg_subscriptions?id=${filterEq(charge[0].subscription_id)}&select=id,plan_code&limit=1`);
        const subscription = subscriptions[0];
        const plans = subscription ? await dbRequest<Array<{ billing_interval: string }>>(`/rest/v1/jvg_subscription_plans?code=${filterEq(subscription.plan_code)}&select=billing_interval&limit=1`) : [];
        const end = new Date(Date.now() + planDays(plans[0]?.billing_interval || "month") * 86400000).toISOString();
        await dbRequest(`/rest/v1/jvg_subscriptions?id=${filterEq(charge[0].subscription_id)}`, { method: "PATCH", body: JSON.stringify({ status: "active", current_period_started_at: now, current_period_ends_at: end, temporary_access_until: null, past_due_since: null, updated_at: now }) });
        await dbRequest(`/rest/v1/jvg_tenants?id=${filterEq(charge[0].tenant_id)}`, { method: "PATCH", body: JSON.stringify({ status: "active", updated_at: now }) });
      }
      await recordAdminAction(user.userId, `billing_charge_${status}`, "billing_charge", id, { tenantId: charge[0].tenant_id });
      return apiJson({ ok: true });
    }

    if (action === "subscription") {
      const companyId = str(body.companyId, 40);
      const operation = str(body.operation, 20);
      if (!UUID.test(companyId) || !["activate", "pause", "cancel"].includes(operation)) throw new JvgBackendError("Empresa ou operação inválida.", 400);
      const companies = await dbRequest<Array<{ id: string; tenant_id: string; business_type: string | null }>>(`/rest/v1/jvg_companies?id=${filterEq(companyId)}&select=id,tenant_id,business_type&limit=1`);
      const company = companies[0];
      if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
      if (operation === "activate") {
        const planCode = str(body.planCode, 40);
        const plan = await dbRequest<Array<{ code: string; billing_interval: string; enabled_business_types: string[] | null }>>(`/rest/v1/jvg_subscription_plans?code=${filterEq(planCode)}&active=eq.true&select=code,billing_interval,enabled_business_types&limit=1`);
        if (!plan[0]) throw new JvgBackendError("Escolha um plano ativo.", 400);
        const businessType = company.business_type || "comercio";
        if (!plan[0].enabled_business_types?.includes(businessType)) {
          throw new JvgBackendError("Este plano não está disponível para o segmento desta empresa. Escolha um plano compatível ou ajuste os segmentos do plano.", 400);
        }
        const requestedEnd = str(body.endsAt, 32);
        const end = requestedEnd ? new Date(`${requestedEnd}T23:59:59.000Z`).toISOString() : new Date(Date.now() + planDays(plan[0].billing_interval) * 86400000).toISOString();
        if (!Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.now()) throw new JvgBackendError("A vigência deve terminar em uma data futura.", 400);
        const patch = { plan_code: planCode, status: "active", current_period_started_at: now, current_period_ends_at: end, temporary_access_until: null, updated_at: now };
        const updated = await dbRequest<Array<{ id: string }>>(`/rest/v1/jvg_subscriptions?tenant_id=${filterEq(company.tenant_id)}&select=id`, { method: "PATCH", body: JSON.stringify(patch) });
        if (!updated[0]) await dbRequest("/rest/v1/jvg_subscriptions", { method: "POST", body: JSON.stringify({ tenant_id: company.tenant_id, billing_provider: "manual", ...patch }) });
        await dbRequest(`/rest/v1/jvg_tenants?id=${filterEq(company.tenant_id)}`, { method: "PATCH", body: JSON.stringify({ status: "active", updated_at: now }) });
      } else {
        const status = operation === "pause" ? "paused" : "canceled";
        await dbRequest(`/rest/v1/jvg_subscriptions?tenant_id=${filterEq(company.tenant_id)}`, { method: "PATCH", body: JSON.stringify({ status, updated_at: now }) });
        await dbRequest(`/rest/v1/jvg_tenants?id=${filterEq(company.tenant_id)}`, { method: "PATCH", body: JSON.stringify({ status: "suspended", updated_at: now }) });
      }
      await dbRequest("/rest/v1/jvg_platform_audit_log", { method: "POST", body: JSON.stringify({ admin_user_id: user.userId, action: `subscription_${operation}`, entity_type: "company", entity_id: companyId, details: { planCode: str(body.planCode, 40) }, created_at: now }) });
      return apiJson({ ok: true });
    }

    throw new JvgBackendError("Ação administrativa inválida.", 400);
  } catch (error) { return safeError(error); }
}
