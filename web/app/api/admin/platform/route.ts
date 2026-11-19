import { getJvgUser } from "../../../jvg-auth";
import { BUSINESS_TYPES } from "../../../../lib/business-types";
import { apiJson, dbCount, dbRequest, filterEq, getPlatformRole, isSameOrigin, JvgBackendError, safeError, str } from "../../../../lib/jvg-backend";
import { planDays } from "../../../../lib/licensing";
import { isPlatformModuleKey, PLATFORM_MODULES } from "../../../../lib/platform-modules";

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

function isMissingAdminSchema(error: unknown) {
  return error instanceof JvgBackendError && ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.databaseCode || "");
}

async function optionalRows<T>(path: string): Promise<{ rows: T[]; available: boolean }> {
  try { return { rows: await dbRequest<T[]>(path), available: true }; }
  catch (error) { if (isMissingAdminSchema(error)) return { rows: [], available: false }; throw error; }
}

async function requireAdminAuditSchema() {
  const audit = await optionalRows<Record<string, unknown>>("/rest/v1/jvg_platform_audit_log?select=id&limit=1");
  if (!audit.available) throw new JvgBackendError("Aplique a migration versionada de auditoria antes de alterar dados administrativos. Nenhuma alteração foi gravada.", 409);
}

function planModules(plan: Record<string, unknown> | undefined) {
  const features = plan?.features && typeof plan.features === "object" && !Array.isArray(plan.features)
    ? plan.features as Record<string, unknown> : {};
  const modules = features.modules && typeof features.modules === "object" && !Array.isArray(features.modules)
    ? features.modules as Record<string, unknown> : {};
  return Object.fromEntries(PLATFORM_MODULES.map((item) => [item.key, modules[item.key] === true])) as Record<string, boolean>;
}

function restaurantOnlineMonthlyPrice(features: unknown): number | null {
  if (!features || typeof features !== "object" || Array.isArray(features)) return null;
  const prices = (features as Record<string, unknown>).module_prices;
  if (!prices || typeof prices !== "object" || Array.isArray(prices)) return null;
  const value = (prices as Record<string, unknown>).restaurante_online;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function moduleAccessForCompany(plan: Record<string, unknown> | undefined, overrides: Array<Record<string, unknown>>) {
  const included = planModules(plan);
  const byKey = new Map(overrides.map((item) => [String(item.module_key), item]));
  return PLATFORM_MODULES.map((item) => {
    const override = byKey.get(item.key);
    const enabled = override ? override.enabled === true : included[item.key] === true;
    return {
      key: item.key, label: item.label, enabled,
      origin: override ? (override.source === "additional" ? "adicional" : "concessão manual") : included[item.key] ? "incluído no plano" : "não incluído",
      source: override?.source === "additional" || override?.source === "manual" ? override.source : null,
      note: typeof override?.note === "string" ? override.note : "",
    };
  });
}

function parsePlanModules(value: unknown): Record<string, boolean> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JvgBackendError("Informe os módulos incluídos no plano.", 400);
  const input = value as Record<string, unknown>;
  for (const [key, enabled] of Object.entries(input)) {
    if (!isPlatformModuleKey(key) || typeof enabled !== "boolean") throw new JvgBackendError("A lista de módulos do plano contém uma opção inválida.", 400);
  }
  return Object.fromEntries(PLATFORM_MODULES.map((item) => [item.key, input[item.key] === true]));
}

function mergePlanFeatures(current: unknown, selectedModules: Record<string, boolean> | null, onlineMonthlyPrice?: number | null) {
  const existing = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  const next = { ...existing };
  if (selectedModules) next.modules = selectedModules;
  if (onlineMonthlyPrice !== undefined) {
    const currentPrices = existing.module_prices && typeof existing.module_prices === "object" && !Array.isArray(existing.module_prices)
      ? existing.module_prices as Record<string, unknown> : {};
    next.module_prices = { ...currentPrices, restaurante_online: onlineMonthlyPrice };
  }
  return next;
}

async function recordRequestEvent(userId: string, actorName: string, requestId: string, eventType: string, previous: Record<string, unknown>, next: Record<string, unknown>) {
  try {
    await dbRequest("/rest/v1/jvg_onboarding_request_events", {
      method: "POST",
      body: JSON.stringify({ request_id: requestId, actor_user_id: userId, actor_name: actorName, event_type: eventType,
        previous_value: previous, new_value: next, created_at: new Date().toISOString() }),
    });
    return true;
  } catch (error) { if (isMissingAdminSchema(error)) return false; throw error; }
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

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    const companyId = params.get("companyId") || "";
    const fromDate = params.get("from") || "";
    const toDate = params.get("to") || "";
    if (companyId && !UUID.test(companyId)) throw new JvgBackendError("Filtro de empresa inválido.", 400);
    const validDay = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
    if (!validDay(fromDate) || !validDay(toDate)) throw new JvgBackendError("Informe datas válidas para filtrar o uso fiscal.", 400);
    if (fromDate && toDate && fromDate > toDate) throw new JvgBackendError("A data inicial deve ser anterior à data final.", 400);
    const pFrom = fromDate ? `${fromDate}T00:00:00.000Z` : null;
    const pTo = toDate ? new Date(`${toDate}T00:00:00.000Z`).getTime() + 86400000 : null;
    const [companies, tenants, plans, subscriptions, documents, applicationsResult, chargeRows, content, invites, overridesResult, requestEventsResult, auditResult, platformAdminsResult, fiscalResult] = await Promise.all([
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_companies?select=id,tenant_id,legal_name,trade_name,cnpj,business_type,status&order=legal_name.asc&limit=500"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_tenants?select=id,status&limit=500"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_subscription_plans?select=code,name,description,billing_interval,amount_minor,currency,max_users,max_companies,features,active,is_public,sort_order,grace_period_days,enabled_business_types&order=sort_order.asc,name.asc&limit=100"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_subscriptions?select=id,tenant_id,plan_code,status,current_period_started_at,current_period_ends_at,temporary_access_until,past_due_since,updated_at,created_at&order=updated_at.desc,created_at.desc&limit=500"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_company_documents?select=company_id,document_code,status,note,reviewed_at&limit=1000"),
      optionalRows<Record<string, unknown>>("/rest/v1/jvg_onboarding_requests?select=id,case_code,company_name,contact_name,email,cnpj,phone,business_type,message,status,admin_note,linked_company_id,contacted_at,assigned_admin_id,assigned_admin_name,created_at,updated_at&order=created_at.desc&limit=500"),
      optionalRows<Record<string, unknown>>("/rest/v1/jvg_billing_charges?select=id,tenant_id,company_id,subscription_id,description,amount_minor,currency,due_at,status,payment_method,boleto_url,boleto_line,pix_copy_paste,pix_qr_url,provider_reference,payment_reported_at,temporary_access_until,paid_at,admin_note,manually_confirmed_by,manual_confirmation_note,created_at&order=due_at.desc&limit=1000"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_platform_content?select=id,content_type,slug,title,summary,body,status,published_at,author_name,created_at,updated_at&order=updated_at.desc&limit=500"),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_company_invites?select=id,tenant_id,company_id,user_id,email,display_name,role,status,invited_at&order=created_at.desc&limit=1000"),
      optionalRows<Record<string, unknown>>("/rest/v1/jvg_company_module_overrides?select=id,tenant_id,company_id,module_key,enabled,source,note,created_by,updated_by,updated_at&limit=5000"),
      optionalRows<Record<string, unknown>>("/rest/v1/jvg_onboarding_request_events?select=id,request_id,actor_user_id,actor_name,event_type,previous_value,new_value,created_at&order=created_at.desc&limit=2000"),
      optionalRows<Record<string, unknown>>("/rest/v1/jvg_platform_audit_log?select=id,admin_user_id,action,entity_type,entity_id,details,created_at&order=created_at.desc&limit=30"),
      optionalRows<Record<string, unknown>>("/rest/v1/jvg_platform_admin_invites?select=email,user_id,active,claimed_at&active=eq.true&order=email.asc&limit=100"),
      (async () => {
        try {
          const result = await dbRequest<Record<string, unknown> | null>("/rest/v1/rpc/jvg_platform_fiscal_metrics", {
            method: "POST", body: JSON.stringify({ p_company_id: companyId || null, p_from: pFrom, p_to: pTo === null ? null : new Date(pTo).toISOString() }),
          });
          return { value: result || null, available: true };
        } catch (error) { if (isMissingAdminSchema(error)) return { value: null, available: false }; throw error; }
      })(),
    ]);
    let applications = applicationsResult.rows;
    if (!applicationsResult.available) {
      applications = await dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_onboarding_requests?select=id,case_code,company_name,contact_name,email,cnpj,phone,business_type,message,status,admin_note,linked_company_id,contacted_at,created_at,updated_at&order=created_at.desc&limit=500");
    }
    const charges = chargeRows.available ? chargeRows.rows : await dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_billing_charges?select=id,tenant_id,company_id,subscription_id,description,amount_minor,currency,due_at,status,payment_method,boleto_url,boleto_line,pix_copy_paste,pix_qr_url,provider_reference,payment_reported_at,temporary_access_until,paid_at,admin_note,created_at&order=due_at.desc&limit=1000");
    const planByCode = new Map(plans.map((plan) => [String(plan.code), plan]));
    const subByTenant = new Map<string, Record<string, unknown>>();
    for (const subscription of subscriptions) {
      const tenantId = String(subscription.tenant_id);
      if (!subByTenant.has(tenantId)) subByTenant.set(tenantId, subscription);
    }
    const tenantById = new Map(tenants.map((tenant) => [String(tenant.id), tenant]));
    const overridesByCompany = new Map<string, Array<Record<string, unknown>>>();
    for (const override of overridesResult.rows) {
      const key = String(override.company_id);
      overridesByCompany.set(key, [...(overridesByCompany.get(key) || []), override]);
    }
    const eventsByRequest = new Map<string, Array<Record<string, unknown>>>();
    for (const event of requestEventsResult.rows) {
      const key = String(event.request_id);
      eventsByRequest.set(key, [...(eventsByRequest.get(key) || []), event]);
    }
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const companiesView = companies.map((company) => {
      const subscription = subByTenant.get(String(company.tenant_id));
      const plan = subscription ? planByCode.get(String(subscription.plan_code)) : undefined;
      const tenant = tenantById.get(String(company.tenant_id));
      const companyFiscal = Array.isArray(fiscalResult.value?.byCompany) ? (fiscalResult.value!.byCompany as Array<Record<string, unknown>>).find((row) => row.companyId === company.id) || null : null;
      return {
        id: company.id, tenantId: company.tenant_id, legalName: company.legal_name,
        tradeName: company.trade_name || "", cnpj: company.cnpj || "",
        businessType: company.business_type || "comercio", status: company.status,
        accessStatus: tenant?.status || "unknown",
        subscription: subscription ? {
          id: subscription.id, planCode: subscription.plan_code, planName: plan?.name || subscription.plan_code,
          status: subscription.status, startsAt: subscription.current_period_started_at,
          endsAt: subscription.current_period_ends_at, temporaryAccessUntil: subscription.temporary_access_until,
          gracePeriodDays: Number(plan?.grace_period_days ?? 15),
        } : null,
        moduleAccess: moduleAccessForCompany(plan, overridesByCompany.get(String(company.id)) || []),
        fiscalUsage: companyFiscal,
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
    const [companyCount, activeCompanyCount, suspendedCompanyCount, pendingApplicationCount, activeSubscriptionCount, expiredSubscriptionCount, openChargeCount] = await Promise.all([
      dbCount("/rest/v1/jvg_companies?select=id"),
      dbCount("/rest/v1/jvg_tenants?select=id&status=in.(active,pilot)"),
      dbCount("/rest/v1/jvg_tenants?select=id&status=eq.suspended"),
      applicationsResult.available ? dbCount("/rest/v1/jvg_onboarding_requests?select=id&status=in.(new,contacted)") : Promise.resolve(null),
      dbCount(`/rest/v1/jvg_subscriptions?select=id&status=eq.active&or=${encodeURIComponent(`(current_period_ends_at.is.null,current_period_ends_at.gt.${nowIso})`)}`),
      dbCount(`/rest/v1/jvg_subscriptions?select=id&status=neq.canceled&current_period_ends_at=lte.${encodeURIComponent(nowIso)}`),
      chargeRows.available ? dbCount(`/rest/v1/jvg_billing_charges?select=id&or=${encodeURIComponent("(status.eq.open,status.eq.payment_reported,status.eq.overdue)")}`) : Promise.resolve(null),
    ]);
    const summary = {
      companies: companyCount,
      activeCompanies: activeCompanyCount,
      suspendedCompanies: suspendedCompanyCount,
      pendingApplications: pendingApplicationCount,
      activeSubscriptions: activeSubscriptionCount,
      expiredSubscriptions: expiredSubscriptionCount,
      openCharges: openChargeCount,
    };
    return apiJson({
      companies: companiesView,
      plans: plans.map((plan) => ({ ...plan, amount_minor: plan.amount_minor === null ? null : Number(plan.amount_minor), restaurant_online_monthly_minor: restaurantOnlineMonthlyPrice(plan.features), modules: planModules(plan), subscriber_count: subscriptions.filter((item) => item.plan_code === plan.code).length })),
      applications: applications.map((application) => ({ ...application, history: eventsByRequest.get(String(application.id)) || [] })), content,
      charges: chargeView,
      invites,
      platformAdmins: platformAdminsResult.rows,
      recentActivity: auditResult.rows,
      fiscalMetrics: fiscalResult.value,
      moduleInventory: PLATFORM_MODULES,
      capabilities: {
        moduleOverrides: overridesResult.available,
        requestHistory: requestEventsResult.available && applicationsResult.available,
        paymentAudit: chargeRows.available,
        fiscalMetrics: fiscalResult.available,
        auditLog: auditResult.available,
      },
      summary,
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    await requireAdminAuditSchema();
    const body = await request.json() as Record<string, unknown>;
    const action = str(body.action, 40);
    const now = new Date().toISOString();

    if (action === "plan") {
      const code = str(body.code, 40).toLowerCase();
      const name = str(body.name, 80);
      const interval = str(body.interval, 20);
      const amountMinor = body.amountMinor === "" || body.amountMinor == null ? null : Number(body.amountMinor);
      const onlineMonthlyMinor = body.restaurantOnlineMonthlyMinor === "" || body.restaurantOnlineMonthlyMinor == null ? null : Number(body.restaurantOnlineMonthlyMinor);
      const graceDays = Number(body.gracePeriodDays ?? 15);
      const enabledBusinessTypes = Array.isArray(body.enabledBusinessTypes) ? body.enabledBusinessTypes.map((value) => str(value, 40)) : [];
      const moduleSchema = await optionalRows<Record<string, unknown>>("/rest/v1/jvg_company_module_overrides?select=id&limit=1");
      if (!moduleSchema.available) throw new JvgBackendError("Aplique a migration administrativa de permissões antes de criar planos com módulos. Assim os recursos definidos no plano também serão aplicados no ERP.", 409);
      const modules = parsePlanModules(body.modules);
      if (!modules) throw new JvgBackendError("Selecione os módulos incluídos neste plano.", 400);
      if (!PLAN_CODE.test(code) || name.length < 2) throw new JvgBackendError("Informe um código e nome válidos para o plano.", 400);
      if (!INTERVALS.has(interval)) throw new JvgBackendError("Escolha uma periodicidade válida.", 400);
      if (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor < 0)) throw new JvgBackendError("Preço do plano inválido.", 400);
      if (onlineMonthlyMinor !== null && (!Number.isSafeInteger(onlineMonthlyMinor) || onlineMonthlyMinor < 0)) throw new JvgBackendError("Preço mensal do site e pedidos do restaurante inválido.", 400);
      if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 60) throw new JvgBackendError("O prazo após vencimento deve ficar entre 0 e 60 dias.", 400);
      if (enabledBusinessTypes.some((code: string) => !BUSINESS_TYPES.some((item) => item.code === code))) throw new JvgBackendError("Um dos segmentos selecionados é inválido.", 400);
      const existingPlans = await dbRequest<Array<{ code: string; name: string; features: Record<string, unknown> | null }>>(`/rest/v1/jvg_subscription_plans?code=${filterEq(code)}&select=code,name,features&limit=1`);
      const existingPlan = existingPlans[0] || null;
      const savedPlans = await dbRequest<Array<{ code: string; name: string }>>("/rest/v1/jvg_subscription_plans?on_conflict=code&select=code,name", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          code, name, description: str(body.description, 1200), billing_interval: interval,
          amount_minor: amountMinor, currency: "BRL", max_users: body.maxUsers ? Number(body.maxUsers) : null,
          max_companies: body.maxCompanies ? Number(body.maxCompanies) : 1,
          features: mergePlanFeatures(existingPlan?.features ?? body.features, modules, onlineMonthlyMinor),
          enabled_business_types: enabledBusinessTypes, grace_period_days: graceDays,
          is_public: body.isPublic === true, active: body.active !== false,
          sort_order: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
          updated_at: now,
        }),
      });
      if (!savedPlans[0]?.code) throw new JvgBackendError("O plano não foi salvo. Atualize o painel e tente novamente.", 409);
      const afterPlan = { name, interval, amountMinor, restaurantOnlineMonthlyMinor: onlineMonthlyMinor, graceDays, enabledBusinessTypes, modules };
      await recordAdminAction(user.userId, existingPlan ? "update_subscription_plan" : "create_subscription_plan", "subscription_plan", code, {
        before: existingPlan ? { name: existingPlan.name, features: existingPlan.features } : null,
        after: afterPlan,
      });
      return apiJson({ ok: true, after: afterPlan, created: !existingPlan });
    }

    if (action === "module") {
      const companyId = str(body.companyId, 40);
      const moduleKey = str(body.moduleKey, 40);
      const enabled = body.enabled === true;
      const source = str(body.source, 20);
      if (!UUID.test(companyId) || !isPlatformModuleKey(moduleKey) || typeof body.enabled !== "boolean") throw new JvgBackendError("Empresa, módulo ou estado inválido.", 400);
      if (!['additional', 'manual'].includes(source)) throw new JvgBackendError("Informe se o acesso é adicional ou concedido manualmente.", 400);
      const companies = await dbRequest<Array<{ id: string; tenant_id: string }>>(`/rest/v1/jvg_companies?id=${filterEq(companyId)}&select=id,tenant_id&limit=1`);
      if (!companies[0]) throw new JvgBackendError("Empresa não encontrada.", 404);
      const currentRows = await optionalRows<Record<string, unknown>>(`/rest/v1/jvg_company_module_overrides?tenant_id=${filterEq(companies[0].tenant_id)}&company_id=${filterEq(companyId)}&module_key=${filterEq(moduleKey)}&select=enabled,source,note&limit=1`);
      if (!currentRows.available) throw new JvgBackendError("A gestão de módulos depende da migration administrativa versionada ainda não aplicada.", 409);
      const before = currentRows.rows[0] || null;
      const note = str(body.note, 500);
      const savedOverrides = await dbRequest<Array<{ id: string; enabled: boolean; source: string; note: string }>>("/rest/v1/jvg_company_module_overrides?on_conflict=company_id,module_key&select=id,enabled,source,note", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ tenant_id: companies[0].tenant_id, company_id: companyId, module_key: moduleKey,
          enabled, source, note, updated_by: user.userId, updated_at: now,
          ...(!before ? { created_by: user.userId, created_at: now } : {}) }),
      });
      if (!savedOverrides[0]?.id) throw new JvgBackendError("O acesso do módulo não foi salvo. Atualize a página e tente novamente.", 409);
      const after = { enabled: savedOverrides[0].enabled, source: savedOverrides[0].source, note: savedOverrides[0].note };
      await recordAdminAction(user.userId, "update_company_module_access", "company_module", `${companyId}:${moduleKey}`, { before, after });
      return apiJson({ ok: true, changed: after });
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
    await requireAdminAuditSchema();
    const body = await request.json() as Record<string, unknown>;
    const action = str(body.action, 40);
    const now = new Date().toISOString();

    if (action === "application") {
      const id = str(body.id, 40);
      const status = str(body.status, 20);
      if (!UUID.test(id) || !STATUSES.has(status)) throw new JvgBackendError("Cadastro ou situação inválida.", 400);
      const requestColumns = await optionalRows<Record<string, unknown>>(`/rest/v1/jvg_onboarding_requests?id=${filterEq(id)}&select=id,cnpj,status,admin_note,linked_company_id,assigned_admin_id,assigned_admin_name&limit=1`);
      const applications = requestColumns.available ? requestColumns.rows : await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_onboarding_requests?id=${filterEq(id)}&select=id,cnpj,status,admin_note,linked_company_id&limit=1`);
      if (!applications[0]) throw new JvgBackendError("Solicitação não encontrada.", 404);
      const previous = applications[0];
      const linkedCompanyId = str(body.linkedCompanyId, 40);
      let linkedCompany: { id: string } | null = null;
      if (linkedCompanyId) {
        if (!UUID.test(linkedCompanyId)) throw new JvgBackendError("Empresa vinculada inválida.", 400);
        const matching = await dbRequest<Array<{ id: string; cnpj: string | null }>>(`/rest/v1/jvg_companies?id=${filterEq(linkedCompanyId)}&select=id,cnpj&limit=1`);
        if (!matching[0] || String(matching[0].cnpj || "").toUpperCase().replace(/[^A-Z0-9]/g, "") !== String(previous.cnpj))
          throw new JvgBackendError("A empresa selecionada não corresponde ao CNPJ da solicitação.", 409);
        linkedCompany = matching[0];
      }
      const assignedAdminId = str(body.assignedAdminId, 40);
      if (assignedAdminId && !requestColumns.available) throw new JvgBackendError("A atribuição de responsáveis depende da migration administrativa versionada.", 409);
      let assignedAdmin: { user_id: string; email: string } | null = null;
      if (assignedAdminId) {
        if (!UUID.test(assignedAdminId)) throw new JvgBackendError("Responsável administrativo inválido.", 400);
        const admins = await dbRequest<Array<{ user_id: string | null; email: string }>>(`/rest/v1/jvg_platform_admin_invites?user_id=${filterEq(assignedAdminId)}&active=eq.true&select=user_id,email&limit=1`);
        const selectedAdmin = admins[0];
        if (!selectedAdmin?.user_id) throw new JvgBackendError("O responsável precisa ser um administrador ativo da plataforma.", 403);
        assignedAdmin = { user_id: selectedAdmin.user_id, email: selectedAdmin.email };
      }
      const adminNote = str(body.adminNote, 2000);
      const next = { status, admin_note: adminNote, linked_company_id: linkedCompany?.id || null,
        assigned_admin_id: assignedAdmin?.user_id || null, assigned_admin_name: assignedAdmin?.email || "" };
      const requestPatch = requestColumns.available ? next : { status: next.status, admin_note: next.admin_note, linked_company_id: next.linked_company_id };
      await dbRequest(`/rest/v1/jvg_onboarding_requests?id=${filterEq(id)}`, {
        method: "PATCH", body: JSON.stringify({ ...requestPatch, contacted_at: status === "contacted" ? now : previous.status === "contacted" ? now : null, updated_at: now }),
      });
      const events = [];
      if (previous.status !== next.status) events.push("status_changed");
      if (previous.assigned_admin_id !== next.assigned_admin_id) events.push("assigned");
      if (previous.admin_note !== next.admin_note) events.push("note_changed");
      const historyAvailable = requestColumns.available ? await recordRequestEvent(user.userId, user.displayName, id, events.length === 1 ? events[0] : "updated", {
        status: previous.status, admin_note: previous.admin_note, linked_company_id: previous.linked_company_id,
        assigned_admin_id: previous.assigned_admin_id, assigned_admin_name: previous.assigned_admin_name,
      }, next) : false;
      await recordAdminAction(user.userId, "update_onboarding_request", "onboarding_request", id, { before: {
        status: previous.status, admin_note: previous.admin_note, linked_company_id: previous.linked_company_id,
        assigned_admin_id: previous.assigned_admin_id, assigned_admin_name: previous.assigned_admin_name,
      }, after: next });
      return apiJson({ ok: true, historyAvailable });
    }

    if (action === "plan") {
      const code = str(body.code, 40);
      if (!PLAN_CODE.test(code)) throw new JvgBackendError("Plano inválido.", 400);
      const interval = str(body.interval, 20);
      const amountMinor = body.amountMinor === "" || body.amountMinor == null ? null : Number(body.amountMinor);
      const onlineMonthlyMinor = body.restaurantOnlineMonthlyMinor === "" || body.restaurantOnlineMonthlyMinor == null ? null : Number(body.restaurantOnlineMonthlyMinor);
      const graceDays = Number(body.gracePeriodDays ?? 15);
      if (!INTERVALS.has(interval) || (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor < 0)) || (onlineMonthlyMinor !== null && (!Number.isSafeInteger(onlineMonthlyMinor) || onlineMonthlyMinor < 0)) || !Number.isInteger(graceDays) || graceDays < 0 || graceDays > 60) throw new JvgBackendError("Revise periodicidade, preços e prazo de tolerância do plano.", 400);
      const types = Array.isArray(body.enabledBusinessTypes) ? body.enabledBusinessTypes.map((value) => str(value, 40)) : [];
      if (types.some((type: string) => !BUSINESS_TYPES.some((item) => item.code === type))) throw new JvgBackendError("Segmento de empresa inválido.", 400);
      const existingRows = await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_subscription_plans?code=${filterEq(code)}&select=code,name,description,billing_interval,amount_minor,grace_period_days,is_public,active,enabled_business_types,max_users,max_companies,features,sort_order&limit=1`);
      const existing = existingRows[0];
      if (!existing) throw new JvgBackendError("Plano não encontrado.", 404);
      const selectedModules = parsePlanModules(body.modules);
      if (body.modules !== undefined) {
        const moduleSchema = await optionalRows<Record<string, unknown>>("/rest/v1/jvg_company_module_overrides?select=id&limit=1");
        if (!moduleSchema.available) throw new JvgBackendError("Aplique a migration administrativa de permissões antes de alterar os módulos do plano. A mudança precisa controlar os acessos no ERP.", 409);
      }
      const previousModules = planModules(existing);
      const nextModules = selectedModules || previousModules;
      const moduleChanges = PLATFORM_MODULES.filter((module) => previousModules[module.key] !== nextModules[module.key]).map((module) => ({ module: module.key, before: previousModules[module.key], after: nextModules[module.key] }));
      const subscribers = await dbRequest<Array<{ tenant_id: string }>>(`/rest/v1/jvg_subscriptions?plan_code=${filterEq(code)}&select=tenant_id&limit=5000`);
      const savedPlans = await dbRequest<Array<{ code: string }>>(`/rest/v1/jvg_subscription_plans?code=${filterEq(code)}&select=code`, {
        method: "PATCH", body: JSON.stringify({
          name: str(body.name, 80), description: str(body.description, 1200), billing_interval: interval,
          amount_minor: amountMinor, grace_period_days: graceDays, is_public: body.isPublic === true,
          active: body.active !== false, sort_order: Number(body.sortOrder) || 100,
          enabled_business_types: types, max_users: body.maxUsers ? Number(body.maxUsers) : null,
          max_companies: body.maxCompanies ? Number(body.maxCompanies) : 1,
          features: mergePlanFeatures(existing.features, selectedModules, onlineMonthlyMinor), updated_at: now,
        }),
      });
      if (!savedPlans[0]?.code) throw new JvgBackendError("O plano não foi atualizado. Recarregue os dados e tente novamente.", 409);
      await recordAdminAction(user.userId, "update_subscription_plan", "subscription_plan", code, {
        before: { name: existing.name, interval: existing.billing_interval, amountMinor: existing.amount_minor, restaurantOnlineMonthlyMinor: restaurantOnlineMonthlyPrice(existing.features), gracePeriodDays: existing.grace_period_days, active: existing.active, modules: previousModules },
        after: { name: str(body.name, 80), interval, amountMinor, restaurantOnlineMonthlyMinor: onlineMonthlyMinor, gracePeriodDays: graceDays, active: body.active !== false, modules: nextModules },
        subscribersAffected: subscribers.length, moduleChanges,
      });
      return apiJson({ ok: true, subscribersAffected: subscribers.length, moduleChanges, customCompanyOverridesPreserved: true });
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
      const manualNote = str(body.manualConfirmationNote, 1000);
      if (status === "paid" && (body.manualConfirmation !== true || manualNote.trim().length < 8)) throw new JvgBackendError("Para confirmar manualmente, informe que o recebimento foi verificado e registre uma observação de pelo menos 8 caracteres.", 400);
      const chargeRows = await optionalRows<Record<string, unknown>>(`/rest/v1/jvg_billing_charges?id=${filterEq(id)}&select=id,tenant_id,subscription_id,status,paid_at,manually_confirmed_by,manual_confirmation_note&limit=1`);
      if (status === "paid" && !chargeRows.available) throw new JvgBackendError("A confirmação manual auditável depende da migration administrativa versionada.", 409);
      const charge = chargeRows.available ? chargeRows.rows : await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_billing_charges?id=${filterEq(id)}&select=id,tenant_id,subscription_id,status,paid_at&limit=1`);
      if (!charge[0]) throw new JvgBackendError("Cobrança não encontrada.", 404);
      const before = charge[0];
      const subscriptionId = typeof before.subscription_id === "string" ? before.subscription_id : "";
      const tenantId = typeof before.tenant_id === "string" ? before.tenant_id : "";
      if (status === "paid" && (!UUID.test(subscriptionId) || !UUID.test(tenantId))) throw new JvgBackendError("A cobranca nao possui assinatura e empresa validas; nenhum recebimento foi alterado.", 409);
      const patchFields: Record<string, unknown> = { status, paid_at: status === "paid" ? now : null, updated_at: now };
      if (status === "paid") {
        patchFields.manually_confirmed_by = user.userId;
        patchFields.manual_confirmation_note = manualNote;
      }
      try { await dbRequest(`/rest/v1/jvg_billing_charges?id=${filterEq(id)}`, { method: "PATCH", body: JSON.stringify(patchFields) }); }
      catch (error) {
        if (status === "paid" && isMissingAdminSchema(error)) throw new JvgBackendError("A confirmação manual auditável depende da migration administrativa versionada.", 409);
        throw error;
      }
      if (status === "paid") {
        const subscriptions = await dbRequest<Array<{ id: string; plan_code: string }>>(`/rest/v1/jvg_subscriptions?id=${filterEq(subscriptionId)}&select=id,plan_code&limit=1`);
        const subscription = subscriptions[0];
        const plans = subscription ? await dbRequest<Array<{ billing_interval: string }>>(`/rest/v1/jvg_subscription_plans?code=${filterEq(subscription.plan_code)}&select=billing_interval&limit=1`) : [];
        const end = new Date(Date.now() + planDays(plans[0]?.billing_interval || "month") * 86400000).toISOString();
        await dbRequest(`/rest/v1/jvg_subscriptions?id=${filterEq(subscriptionId)}`, { method: "PATCH", body: JSON.stringify({ status: "active", current_period_started_at: now, current_period_ends_at: end, temporary_access_until: null, past_due_since: null, updated_at: now }) });
        await dbRequest(`/rest/v1/jvg_tenants?id=${filterEq(tenantId)}`, { method: "PATCH", body: JSON.stringify({ status: "active", updated_at: now }) });
      }
      await recordAdminAction(user.userId, `billing_charge_${status}`, "billing_charge", id, {
        before: { status: before.status, paidAt: before.paid_at }, after: { status, paidAt: status === "paid" ? now : null,
          manuallyConfirmedBy: status === "paid" ? user.userId : null, manualConfirmationNote: status === "paid" ? manualNote : null },
        tenantId, confirmation: status === "paid" ? "manual by platform administrator" : null,
      });
      return apiJson({ ok: true, manualConfirmation: status === "paid", confirmedBy: status === "paid" ? user.displayName : null });
    }

    if (action === "subscription") {
      const companyId = str(body.companyId, 40);
      const operation = str(body.operation, 20);
      if (!UUID.test(companyId) || !["activate", "pause", "cancel"].includes(operation)) throw new JvgBackendError("Empresa ou operação inválida.", 400);
      const companies = await dbRequest<Array<{ id: string; tenant_id: string; business_type: string | null }>>(`/rest/v1/jvg_companies?id=${filterEq(companyId)}&select=id,tenant_id,business_type&limit=1`);
      const company = companies[0];
      if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
      const previousSubscriptions = await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_subscriptions?tenant_id=${filterEq(company.tenant_id)}&select=id,plan_code,status,current_period_started_at,current_period_ends_at,temporary_access_until,past_due_since,updated_at,created_at&order=updated_at.desc,created_at.desc&limit=1`);
      const previousSubscription = previousSubscriptions[0] || null;
      let nextSubscription: Record<string, unknown> | null = null;
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
        const subscriptionId = typeof previousSubscription?.id === "string" ? previousSubscription.id : "";
        const saved = subscriptionId
          ? await dbRequest<Array<{ id: string }>>(`/rest/v1/jvg_subscriptions?id=${filterEq(subscriptionId)}&tenant_id=${filterEq(company.tenant_id)}&select=id`, { method: "PATCH", body: JSON.stringify(patch) })
          : await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_subscriptions?select=id", { method: "POST", body: JSON.stringify({ tenant_id: company.tenant_id, billing_provider: "manual", ...patch }) });
        if (!saved[0]?.id) throw new JvgBackendError("A assinatura nÃ£o foi gravada. Atualize o painel e tente novamente.", 409);
        await dbRequest(`/rest/v1/jvg_tenants?id=${filterEq(company.tenant_id)}`, { method: "PATCH", body: JSON.stringify({ status: "active", updated_at: now }) });
        nextSubscription = { ...(previousSubscription || {}), id: saved[0].id, ...patch };
      } else {
        const status = operation === "pause" ? "paused" : "canceled";
        const subscriptionId = typeof previousSubscription?.id === "string" ? previousSubscription.id : "";
        if (!subscriptionId) throw new JvgBackendError("A empresa ainda nÃ£o possui assinatura para alterar.", 409);
        const saved = await dbRequest<Array<{ id: string }>>(`/rest/v1/jvg_subscriptions?id=${filterEq(subscriptionId)}&tenant_id=${filterEq(company.tenant_id)}&select=id`, { method: "PATCH", body: JSON.stringify({ status, updated_at: now }) });
        if (!saved[0]?.id) throw new JvgBackendError("A assinatura nÃ£o foi alterada. Atualize o painel e tente novamente.", 409);
        await dbRequest(`/rest/v1/jvg_tenants?id=${filterEq(company.tenant_id)}`, { method: "PATCH", body: JSON.stringify({ status: "suspended", updated_at: now }) });
        nextSubscription = { ...previousSubscription, status, updated_at: now };
      }
      await recordAdminAction(user.userId, `subscription_${operation}`, "company", companyId, {
        before: previousSubscription, after: nextSubscription,
        tenantStatusBefore: operation === "activate" ? "suspended or current" : "active or pilot",
        tenantStatusAfter: operation === "activate" ? "active" : "suspended",
        moduleOverridesPreserved: true,
      });
      return apiJson({ ok: true, before: previousSubscription, after: nextSubscription, moduleOverridesPreserved: true });
    }

    throw new JvgBackendError("Ação administrativa inválida.", 400);
  } catch (error) { return safeError(error); }
}
