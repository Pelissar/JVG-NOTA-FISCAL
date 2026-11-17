import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getPlatformRole, isSameOrigin, JvgBackendError, safeError, str } from "../../../../lib/jvg-backend";
import { jvgRuntime } from "../../../../lib/jvg-runtime";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set(["technician", "commercial", "accounting"]);

export async function POST(request: Request) {
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    if (await getPlatformRole(user) !== "platform_admin") throw new JvgBackendError("Acesso exclusivo do administrador da plataforma.", 403);
    if (!isSameOrigin(request)) throw new JvgBackendError("Origem não autorizada.", 403);
    const body = await request.json() as Record<string, unknown>;
    const companyId = str(body.companyId, 40);
    const name = str(body.name, 120);
    const email = str(body.email, 254).toLowerCase();
    const role = str(body.role, 30);
    if (!UUID.test(companyId) || name.length < 2) throw new JvgBackendError("Selecione a empresa e informe o nome do usuário.", 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new JvgBackendError("Informe um e-mail válido.", 400);
    if (!ROLES.has(role)) throw new JvgBackendError("Selecione técnico, comercial ou contabilidade.", 400);

    const companies = await dbRequest<Array<{ id: string; tenant_id: string }>>(`/rest/v1/jvg_companies?id=${filterEq(companyId)}&select=id,tenant_id&limit=1`);
    const company = companies[0];
    if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
    const runtime = jvgRuntime();
    if (!runtime.supabaseUrl || !runtime.supabaseSecretKey) throw new JvgBackendError("O serviço de convites ainda não está configurado.", 503);

    const origin = new URL(request.url).origin;
    const inviteUrl = new URL(`${runtime.supabaseUrl}/auth/v1/invite`);
    inviteUrl.searchParams.set("redirect_to", `${origin}/auth/callback`);
    const inviteResponse = await fetch(inviteUrl, {
      method: "POST",
      headers: {
        apikey: runtime.supabaseSecretKey,
        Authorization: `Bearer ${runtime.supabaseSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, data: { display_name: name } }),
      cache: "no-store",
    });
    const invitePayload = await inviteResponse.json().catch(() => ({})) as { id?: string; user?: { id?: string }; message?: string; msg?: string };
    let userId = invitePayload.user?.id || invitePayload.id;
    let inviteStatus: "invited" | "active" = "invited";
    if (!inviteResponse.ok || !userId) {
      const responseText = `${invitePayload.message || ""} ${invitePayload.msg || ""}`.toLowerCase();
      if (responseText.includes("already") || responseText.includes("registered") || inviteResponse.status === 422) {
        // A team member may already have an Auth account. Find that account via
        // the server-only Admin API and attach it to this tenant without resending
        // credentials or creating a second identity.
        for (let page = 1; page <= 50 && !userId; page += 1) {
          const usersUrl = new URL(`${runtime.supabaseUrl}/auth/v1/admin/users`);
          usersUrl.searchParams.set("page", String(page));
          usersUrl.searchParams.set("per_page", "1000");
          const usersResponse = await fetch(usersUrl, {
            headers: { apikey: runtime.supabaseSecretKey, Authorization: `Bearer ${runtime.supabaseSecretKey}` },
            cache: "no-store",
          });
          if (!usersResponse.ok) break;
          const usersPayload = await usersResponse.json().catch(() => ({})) as { users?: Array<{ id: string; email?: string | null }> };
          const users = Array.isArray(usersPayload.users) ? usersPayload.users : [];
          userId = users.find((candidate) => candidate.email?.toLowerCase() === email)?.id;
          if (users.length < 1000) break;
        }
        if (!userId) throw new JvgBackendError("Este e-mail já tem uma conta, mas não conseguimos localizá-la para vinculá-la à empresa. Confira o e-mail e tente novamente.", 409);
        inviteStatus = "active";
      } else {
        throw new JvgBackendError("Não foi possível enviar o convite por e-mail. Confira a configuração de e-mail do Supabase Auth.", 502);
      }
    }

    const now = new Date().toISOString();
    await dbRequest("/rest/v1/jvg_tenant_memberships?on_conflict=tenant_id,user_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ tenant_id: company.tenant_id, user_id: userId, role: "member", active: true }),
    });
    await dbRequest("/rest/v1/jvg_company_memberships?on_conflict=company_id,user_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ tenant_id: company.tenant_id, company_id: company.id, user_id: userId, role, active: true }),
    });
    await dbRequest("/rest/v1/jvg_company_invites?on_conflict=company_id,email", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ tenant_id: company.tenant_id, company_id: company.id, user_id: userId, email, display_name: name, role, status: inviteStatus, invited_at: now, updated_at: now }),
    });
    await dbRequest("/rest/v1/jvg_platform_audit_log", { method: "POST", body: JSON.stringify({ admin_user_id: user.userId, action: inviteStatus === "invited" ? "invite_company_user" : "attach_existing_company_user", entity_type: "company_user", entity_id: company.id, details: { email, role }, created_at: now }) });
    return apiJson({ ok: true, email, role, status: inviteStatus }, inviteStatus === "invited" ? 201 : 200);
  } catch (error) { return safeError(error); }
}
