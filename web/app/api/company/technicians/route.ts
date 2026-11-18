import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError } from "../../../../lib/jvg-backend";
import { jvgRuntime } from "../../../../lib/jvg-runtime";

export const dynamic = "force-dynamic";

function commercial(role?: string) {
  return !!role && ["owner", "admin", "manager"].includes(role);
}

async function account() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const site = await getSiteAccount(user, { requiredModule: "assistencia" });
  if (!site) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return site;
}

export async function GET() {
  try {
    const site = await account();
    if (!commercial(site.role)) throw new JvgBackendError("Somente a administração da empresa consulta os técnicos.", 403);
    const rows = await dbRequest<Array<{ user_id: string; display_name: string; email: string; active: boolean }>>(
      `/rest/v1/jvg_company_technicians?tenant_id=${filterEq(site.tenant_id)}&company_id=${filterEq(site.company_id)}&active=eq.true&select=user_id,display_name,email,active&order=display_name.asc&limit=100`,
    );
    return apiJson({ technicians: rows.map((row) => ({ id: row.user_id, name: row.display_name, email: row.email })) });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const site = await account();
    if (!commercial(site.role)) throw new JvgBackendError("Somente o administrador da empresa cria login de técnico.", 403);
    const body = await request.json() as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (name.length < 2 || name.length > 80) throw new JvgBackendError("Informe o nome do técnico.", 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new JvgBackendError("E-mail do técnico inválido.", 400);
    if (password.length < 12 || password.length > 128) throw new JvgBackendError("A senha do técnico precisa ter entre 12 e 128 caracteres.", 400);

    const runtime = jvgRuntime();
    if (!runtime.supabaseUrl || !runtime.supabaseSecretKey) throw new JvgBackendError("O servidor ainda não cria usuários.", 503);
    const created = await fetch(`${runtime.supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: runtime.supabaseSecretKey,
        Authorization: `Bearer ${runtime.supabaseSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: name } }),
    });
    const payload = await created.json().catch(() => ({})) as { id?: string; msg?: string; message?: string; error_description?: string };
    if (!created.ok || !payload.id) {
      const detail = `${payload.msg || ""} ${payload.message || ""} ${payload.error_description || ""}`.toLowerCase();
      if (created.status === 422 || detail.includes("already")) throw new JvgBackendError("Este e-mail já possui conta. Use outro e-mail para o técnico.", 409);
      throw new JvgBackendError("Não foi possível criar o login do técnico.", 502);
    }

    await dbRequest("/rest/v1/jvg_tenant_memberships", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ tenant_id: site.tenant_id, user_id: payload.id, role: "member", active: true }),
    });
    await dbRequest("/rest/v1/jvg_company_memberships", {
      method: "POST",
      body: JSON.stringify({ tenant_id: site.tenant_id, company_id: site.company_id, user_id: payload.id, role: "technician", active: true }),
    });
    await dbRequest("/rest/v1/jvg_company_technicians", {
      method: "POST",
      body: JSON.stringify({ tenant_id: site.tenant_id, company_id: site.company_id, user_id: payload.id, display_name: name, email, active: true }),
    });
    return apiJson({ ok: true, technician: { id: payload.id, name, email } }, 201);
  } catch (error) { return safeError(error); }
}
