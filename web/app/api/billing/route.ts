import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError, type SiteAccount } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function billingScope(): Promise<{ account: SiteAccount; userId: string }> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para consultar a cobrança.", 401);
  const account = await getSiteAccount(user, { allowBillingLocked: true });
  if (!account) throw new JvgBackendError("Não encontramos uma empresa vinculada a esta conta.", 404);
  return { account, userId: user.userId };
}

function requireBillingManager(account: SiteAccount) {
  if (!account.role || !["owner", "admin", "manager"].includes(account.role))
    throw new JvgBackendError("Somente o responsável da empresa pode consultar ou informar pagamentos.", 403);
}

export async function GET() {
  try {
    const { account } = await billingScope();
    requireBillingManager(account);
    const [company, subscriptions, plans, charges] = await Promise.all([
      getCompany(account),
      dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_subscriptions?tenant_id=${filterEq(account.tenant_id)}&select=id,plan_code,status,current_period_started_at,current_period_ends_at,temporary_access_until&limit=1`),
      dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_subscription_plans?select=code,name,billing_interval,amount_minor,currency,grace_period_days&limit=100"),
      dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_billing_charges?tenant_id=${filterEq(account.tenant_id)}&select=id,company_id,description,amount_minor,currency,due_at,status,payment_method,boleto_url,boleto_line,pix_copy_paste,pix_qr_url,payment_reported_at,temporary_access_until,paid_at,created_at&order=due_at.desc&limit=200`),
    ]);
    const subscription = subscriptions[0] || null;
    const plan = subscription ? plans.find((item) => item.code === subscription.plan_code) : null;
    const days = Math.max(0, Math.min(60, Number(plan?.grace_period_days ?? 15)));
    const endsAt = String(subscription?.current_period_ends_at || "");
    const graceEndsAt = endsAt ? new Date(Date.parse(endsAt) + days * 86400000).toISOString() : null;
    const temporaryAccessUntil = subscription?.temporary_access_until ? String(subscription.temporary_access_until) : null;
    const paymentReported = Boolean(temporaryAccessUntil);
    const accessAllowed = !subscription || subscription.plan_code === "pilot" ||
      (subscription.status === "active" && (!endsAt || Date.parse(endsAt) > Date.now())) ||
      ((subscription.status === "active" || subscription.status === "past_due") && Boolean(temporaryAccessUntil && Date.parse(temporaryAccessUntil) > Date.now())) ||
      (!paymentReported && (subscription.status === "active" || subscription.status === "past_due") && Boolean(graceEndsAt && Date.parse(graceEndsAt) > Date.now()));
    const financeNumber = (process.env.JVG_FINANCE_WHATSAPP || "").replace(/\D/g, "");
    return apiJson({
      companyName: String(company?.trade_name || company?.legal_name || "Empresa"),
      subscription: subscription ? {
        planName: plan?.name || subscription.plan_code, status: subscription.status,
        startsAt: subscription.current_period_started_at, endsAt: subscription.current_period_ends_at,
        gracePeriodDays: days, graceEndsAt, temporaryAccessUntil, accessAllowed,
      } : null,
      charges: charges.map((charge) => ({
        id: charge.id, companyId: charge.company_id, description: charge.description,
        amountMinor: Number(charge.amount_minor), currency: charge.currency, dueAt: charge.due_at,
        status: charge.status === "open" && Date.parse(String(charge.due_at)) < Date.now() ? "overdue" : charge.status, paymentMethod: charge.payment_method,
        boletoUrl: charge.boleto_url, boletoLine: charge.boleto_line,
        pixCopyPaste: charge.pix_copy_paste, pixQrUrl: charge.pix_qr_url,
        paymentReportedAt: charge.payment_reported_at, temporaryAccessUntil: charge.temporary_access_until,
        paidAt: charge.paid_at,
      })),
      financeWhatsapp: financeNumber ? `https://wa.me/${financeNumber}` : null,
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) throw new JvgBackendError("Origem não autorizada.", 403);
    const { account, userId } = await billingScope();
    requireBillingManager(account);
    const body = await request.json() as Record<string, unknown>;
    const chargeId = String(body.chargeId || "");
    if (!UUID.test(chargeId) || body.action !== "paid_notice") throw new JvgBackendError("Solicitação de pagamento inválida.", 400);
    const charges = await dbRequest<Array<{ id: string; tenant_id: string; status: string }>>(
      `/rest/v1/jvg_billing_charges?id=${filterEq(chargeId)}&tenant_id=${filterEq(account.tenant_id)}&select=id,tenant_id,status&limit=1`,
    );
    const charge = charges[0];
    if (!charge) throw new JvgBackendError("Cobrança não encontrada para esta empresa.", 404);
    if (!["open", "overdue", "payment_reported"].includes(charge.status)) throw new JvgBackendError("Esta cobrança não está aguardando pagamento.", 409);
    if (charge.status === "payment_reported") throw new JvgBackendError("O pagamento desta cobrança já foi informado. O acesso temporário não pode ser renovado por um novo clique.", 409);
    const subscriptions = await dbRequest<Array<{ id: string; status: string }>>(`/rest/v1/jvg_subscriptions?tenant_id=${filterEq(account.tenant_id)}&select=id,status&limit=1`);
    if (!subscriptions[0] || ["paused", "canceled", "incomplete"].includes(subscriptions[0].status))
      throw new JvgBackendError("Não é possível liberar acesso temporário para esta assinatura. Fale com a equipe financeira.", 409);
    const now = new Date();
    const temporaryAccessUntil = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    await dbRequest(`/rest/v1/jvg_billing_charges?id=${filterEq(charge.id)}&tenant_id=${filterEq(account.tenant_id)}`, {
      method: "PATCH", body: JSON.stringify({ status: "payment_reported", payment_reported_at: now.toISOString(), temporary_access_until: temporaryAccessUntil, updated_at: now.toISOString() }),
    });
    await dbRequest(`/rest/v1/jvg_subscriptions?id=${filterEq(subscriptions[0].id)}`, {
      method: "PATCH", body: JSON.stringify({ temporary_access_until: temporaryAccessUntil, updated_at: now.toISOString() }),
    });
    await dbRequest("/rest/v1/jvg_platform_audit_log", {
      method: "POST", body: JSON.stringify({ actor_user_id: userId, action: "payment_reported_by_customer", entity_type: "billing_charge", entity_id: charge.id, details: { temporaryAccessUntil }, created_at: now.toISOString() }),
    });
    return apiJson({ ok: true, temporaryAccessUntil });
  } catch (error) { return safeError(error); }
}
