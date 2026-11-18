import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError, str, type SiteAccount } from "../../../../lib/jvg-backend";
import { jvgRuntime } from "../../../../lib/jvg-runtime";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function current() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  const role = account.member_role || account.role || "viewer";
  if (role !== "owner" && role !== "admin") throw new JvgBackendError("Somente proprietário ou administrador desta empresa pode gerenciar convites.", 403);
  return { user, account };
}
function scope(account: SiteAccount) { return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`; }
function runtimeCredentials() {
  const runtime = jvgRuntime();
  if (!runtime.supabaseUrl || !runtime.supabaseSecretKey) throw new JvgBackendError("O serviço de convites não está configurado no servidor.", 503);
  return runtime;
}
async function requireAuditTable(account: SiteAccount) {
  try {
    await dbRequest<Row[]>(`/rest/v1/jvg_company_fiscal_audit?${scope(account)}&select=id&limit=1`);
  } catch (error) {
    if (error instanceof JvgBackendError && ["PGRST204", "PGRST205", "42703", "42P01"].includes(error.databaseCode || ""))
      throw new JvgBackendError("A migration 20261118_jvg_accountant_rtc.sql precisa ser aplicada antes de gerenciar acesso, para que a ação fique auditada.", 409);
    throw error;
  }
}
async function findAuthUserIdByEmail(baseUrl: string, secret: string, email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page += 1) {
    const usersUrl = new URL(`${baseUrl}/auth/v1/admin/users`);
    usersUrl.searchParams.set("page", String(page)); usersUrl.searchParams.set("per_page", "1000");
    const response = await fetch(usersUrl, { headers: { apikey: secret, Authorization: `Bearer ${secret}` }, cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({})) as { users?: Array<{ id: string; email?: string | null }> };
    const users = Array.isArray(data.users) ? data.users : [];
    const match = users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (match) return match.id;
    if (users.length < 1000) return null;
  }
  return null;
}
async function attachAccountant(account: SiteAccount, userId: string) {
  const tenantQuery = `/rest/v1/jvg_tenant_memberships?tenant_id=${filterEq(account.tenant_id)}&user_id=${filterEq(userId)}&select=role,active&limit=1`;
  const companyQuery = `/rest/v1/jvg_company_memberships?${scope(account)}&user_id=${filterEq(userId)}&select=role,active&limit=1`;
  const [tenantRows, companyRows] = await Promise.all([dbRequest<Row[]>(tenantQuery), dbRequest<Row[]>(companyQuery)]);
  const tenantMember = tenantRows[0];
  const companyMember = companyRows[0];
  if (companyMember && companyMember.role !== "accounting")
    throw new JvgBackendError("Este usuário já possui outro perfil nesta empresa. O convite de contador não altera nem rebaixa o acesso existente.", 409);
  if (tenantMember && tenantMember.active !== true && tenantMember.role !== "member")
    throw new JvgBackendError("A associação administrativa deste usuário está inativa. Reative-a pela administração da empresa antes de convidá-lo como contador.", 409);

  if (!tenantMember) {
    await dbRequest(`/rest/v1/jvg_tenant_memberships?on_conflict=tenant_id,user_id`, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ tenant_id: account.tenant_id, user_id: userId, role: "member", active: true }) });
  } else if (tenantMember.active !== true && tenantMember.role === "member") {
    await dbRequest(`/rest/v1/jvg_tenant_memberships?tenant_id=${filterEq(account.tenant_id)}&user_id=${filterEq(userId)}&role=eq.member&active=eq.false`, { method: "PATCH", body: JSON.stringify({ active: true }) });
  }
  if (!companyMember) {
    await dbRequest(`/rest/v1/jvg_company_memberships?on_conflict=company_id,user_id`, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ tenant_id: account.tenant_id, company_id: account.company_id, user_id: userId, role: "accounting", active: true }) });
  } else if (companyMember.active !== true && companyMember.role === "accounting") {
    await dbRequest(`/rest/v1/jvg_company_memberships?${scope(account)}&user_id=${filterEq(userId)}&role=eq.accounting&active=eq.false`, { method: "PATCH", body: JSON.stringify({ active: true }) });
  }

  const [verifiedTenant, verifiedCompany] = await Promise.all([dbRequest<Row[]>(tenantQuery), dbRequest<Row[]>(companyQuery)]);
  if (verifiedTenant[0]?.active !== true || verifiedCompany[0]?.active !== true || verifiedCompany[0]?.role !== "accounting")
    throw new JvgBackendError("Não foi possível confirmar o vínculo contábil com esta empresa. Nenhum perfil existente foi alterado.", 409);
}
async function writeAudit(account: SiteAccount, actor: string, action: string, id: string, before: Row, after: Row) {
  await dbRequest("/rest/v1/jvg_company_fiscal_audit", { method: "POST", body: JSON.stringify({
    tenant_id: account.tenant_id, company_id: account.company_id, actor_user_id: actor,
    action, entity_type: "company_member", entity_id: id, before_values: before, after_values: after,
  }) });
}

export async function GET() {
  try {
    const { account } = await current();
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_company_invites?${scope(account)}&role=eq.accounting&select=id,user_id,email,display_name,status,invited_at,updated_at&order=created_at.desc&limit=100`);
    return apiJson({ records: rows });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { user, account } = await current();
    await requireAuditTable(account);
    const raw = await request.text();
    if (raw.length > 4000) throw new JvgBackendError("Convite muito extenso.", 413);
    let body: Row;
    try { body = JSON.parse(raw) as Row; } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    const name = str(body.name, 120);
    const email = str(body.email, 254).toLowerCase();
    if (name.length < 2) throw new JvgBackendError("Informe o nome do contador ou escritório.", 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new JvgBackendError("Informe um e-mail válido.", 400);
    const credentials = runtimeCredentials();
    const existingInvite = await dbRequest<Row[]>(`/rest/v1/jvg_company_invites?${scope(account)}&email=${filterEq(email)}&select=id,status&limit=1`);
    if (existingInvite[0]?.status !== "revoked") throw new JvgBackendError("Já existe convite ou acesso ativo para este e-mail nesta empresa.", 409);

    const origin = new URL(request.url).origin;
    const inviteUrl = new URL(`${credentials.supabaseUrl}/auth/v1/invite`);
    inviteUrl.searchParams.set("redirect_to", `${origin}/auth/callback`);
    const inviteResponse = await fetch(inviteUrl, { method: "POST", headers: {
      apikey: credentials.supabaseSecretKey!, Authorization: `Bearer ${credentials.supabaseSecretKey!}`, "Content-Type": "application/json",
    }, body: JSON.stringify({ email, data: { display_name: name } }), cache: "no-store" });
    const invitePayload = await inviteResponse.json().catch(() => ({})) as { id?: string; user?: { id?: string }; message?: string; msg?: string };
    let userId = invitePayload.user?.id || invitePayload.id;
    let status: "invited" | "active" = "invited";
    if (!inviteResponse.ok || !userId) {
      const responseText = `${invitePayload.message || ""} ${invitePayload.msg || ""}`.toLowerCase();
      if (responseText.includes("already") || responseText.includes("registered") || inviteResponse.status === 422) {
        userId = await findAuthUserIdByEmail(credentials.supabaseUrl, credentials.supabaseSecretKey!, email) || undefined;
        if (!userId) throw new JvgBackendError("O e-mail já está cadastrado no login, mas não foi possível vinculá-lo à empresa. Confira o endereço.", 409);
        status = "active";
      } else throw new JvgBackendError("Não foi possível enviar o convite de acesso. Verifique o serviço de e-mail do login.", 502);
    }
    if (!UUID.test(userId)) throw new JvgBackendError("O serviço de autenticação retornou um usuário inválido.", 502);
    const now = new Date().toISOString();
    await attachAccountant(account, userId);
    const saved = await dbRequest<Row[]>("/rest/v1/jvg_company_invites?on_conflict=company_id,email", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ tenant_id: account.tenant_id, company_id: account.company_id, user_id: userId, email, display_name: name, role: "accounting", status, invited_at: now, updated_at: now }) });
    const invite = saved[0];
    if (invite?.id) await writeAudit(account, user.userId, "accountant_invited", String(invite.id), { status: "revoked" }, { email, role: "accounting", status });
    return apiJson({ ok: true, email, status, inviteId: invite?.id }, status === "invited" ? 201 : 200);
  } catch (error) { return safeError(error); }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { user, account } = await current();
    await requireAuditTable(account);
    const raw = await request.text();
    let body: Row;
    try { body = JSON.parse(raw) as Row; } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    const inviteId = str(body.id, 40);
    if (!UUID.test(inviteId)) throw new JvgBackendError("Convite inválido.", 400);
    const selected = await dbRequest<Row[]>(`/rest/v1/jvg_company_invites?${scope(account)}&id=${filterEq(inviteId)}&role=eq.accounting&select=id,user_id,email,status&limit=1`);
    const invite = selected[0];
    if (!invite) throw new JvgBackendError("Acesso de contador não encontrado nesta empresa.", 404);
    if (invite.status === "revoked") return apiJson({ ok: true, alreadyRevoked: true });
    await dbRequest(`/rest/v1/jvg_company_invites?${scope(account)}&id=${filterEq(inviteId)}&role=eq.accounting`, { method: "PATCH", body: JSON.stringify({ status: "revoked", updated_at: new Date().toISOString() }) });
    const memberId = str(invite.user_id, 40);
    if (UUID.test(memberId)) {
      await dbRequest(`/rest/v1/jvg_company_memberships?${scope(account)}&user_id=${filterEq(memberId)}&role=eq.accounting`, { method: "PATCH", body: JSON.stringify({ active: false }) });
      const remaining = await dbRequest<Row[]>(`/rest/v1/jvg_company_memberships?tenant_id=${filterEq(account.tenant_id)}&user_id=${filterEq(memberId)}&active=eq.true&select=company_id&limit=1`);
      if (!remaining.length) await dbRequest(`/rest/v1/jvg_tenant_memberships?tenant_id=${filterEq(account.tenant_id)}&user_id=${filterEq(memberId)}&role=eq.member`, { method: "PATCH", body: JSON.stringify({ active: false }) });
    }
    await writeAudit(account, user.userId, "accountant_revoked", inviteId, { status: invite.status }, { status: "revoked", email: invite.email });
    return apiJson({ ok: true, revoked: true });
  } catch (error) { return safeError(error); }
}
