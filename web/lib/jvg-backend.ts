import { jvgRuntime } from "./jvg-runtime";
import type { JvgAuthUser } from "../app/jvg-auth";
import { fiscalMissing } from "./fiscal-company";
import { JvgBackendError } from "./jvg-errors";
export { JvgBackendError } from "./jvg-errors";

export type SiteAccount = { tenant_id: string; company_id: string; role?: string };

export function isConfigured(): boolean {
  const runtime = jvgRuntime();
  return !!runtime.supabaseUrl && !!runtime.supabaseSecretKey;
}

export async function dbRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const runtime = jvgRuntime();
  const secret = runtime.supabaseSecretKey;
  if (!runtime.supabaseUrl) throw new JvgBackendError("URL do Supabase ainda não configurada.", 503);
  if (!secret) throw new JvgBackendError("Chave privada do Supabase ainda não configurada.", 503);
  if (!path.startsWith("/rest/v1/") || path.includes("..")) throw new JvgBackendError("Consulta inválida.", 400);
  const headers = new Headers(init.headers);
  headers.set("apikey", secret);
  if (secret.split(".").length === 3) headers.set("Authorization", `Bearer ${secret}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET" && !headers.has("Prefer")) headers.set("Prefer", "return=representation");
  const response = await fetch(`${runtime.supabaseUrl}${path}`, {
    ...init, headers, cache: "no-store",
  });
  const raw = await response.text();
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  if (!response.ok) {
    const detail = (parsed && typeof parsed === "object" && "message" in parsed) ? String(parsed.message) : "Erro de acesso ao banco.";
    // Nao devolver detalhes de infraestrutura ou informacoes do provedor ao navegador.
    if (response.status === 409 || detail.toLowerCase().includes("duplicate key"))
      throw new JvgBackendError("Já existe um cadastro com estes dados.", 409);
    throw new JvgBackendError("Não foi possível concluir a operação no Supabase.", 502);
  }
  return parsed as T;
}

export async function dbCount(path: string): Promise<number> {
  const runtime = jvgRuntime();
  const secret = runtime.supabaseSecretKey;
  if (!runtime.supabaseUrl) throw new JvgBackendError("URL do Supabase ainda não configurada.", 503);
  if (!secret) throw new JvgBackendError("Chave privada do Supabase ainda não configurada.", 503);
  if (!path.startsWith("/rest/v1/") || path.includes("..")) throw new JvgBackendError("Consulta inválida.", 400);
  const headers = new Headers();
  headers.set("apikey", secret);
  if (secret.split(".").length === 3) headers.set("Authorization", `Bearer ${secret}`);
  headers.set("Prefer", "count=exact");
  headers.set("Range-Unit", "items");
  headers.set("Range", "0-0");
  const response = await fetch(`${runtime.supabaseUrl}${path}`, { method: "HEAD", headers, cache: "no-store" });
  if (!response.ok) throw new JvgBackendError("Não foi possível consultar a contagem no Supabase.", 502);
  const total = response.headers.get("content-range")?.split("/").pop();
  const count = Number(total);
  if (!total || !Number.isSafeInteger(count) || count < 0) throw new JvgBackendError("O Supabase não informou a contagem dos registros.", 502);
  return count;
}

export function filterEq(value: string): string { return encodeURIComponent(`eq.${value}`); }

export type JvgDashboardSummary = {
  productsCount: number;
  clientsCount: number;
  unitsStock: number;
  lowStockCount: number;
  stockValue: number;
  recentMovements: Array<{ productId: string; delta: number; reason: string | null; at: string; name: string | null }>;
};

export async function getDashboardSummary(account: SiteAccount): Promise<JvgDashboardSummary> {
  return dbRequest<JvgDashboardSummary>("/rest/v1/rpc/jvg_dashboard_summary", {
    method: "POST",
    body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id }),
  });
}

/** Acesso global e separado da empresa: so apos verificacao do email no Auth. */
export async function getPlatformRole(user: JvgAuthUser): Promise<"platform_admin" | null> {
  const role = await dbRequest<string | null>("/rest/v1/rpc/jvg_claim_platform_admin", {
    method: "POST",
    body: JSON.stringify({ p_user_id: user.userId, p_email: user.email }),
  });
  return role === "platform_admin" ? role : null;
}

export async function getSiteAccount(user: JvgAuthUser): Promise<SiteAccount | null> {
  try {
    const resolved = await dbRequest<SiteAccount[]>("/rest/v1/rpc/jvg_resolve_site_account", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user.userId }),
    });
    return resolved[0] ?? null;
  } catch {
    // Preview environments may not have received the security migration yet.
    // Keep the fallback equally strict while using the slower REST path.
  }

  const memberships = await dbRequest<SiteAccount[]>(
    `/rest/v1/jvg_company_memberships?user_id=${filterEq(user.userId)}&active=eq.true&select=tenant_id,company_id,role&order=created_at.asc&limit=50`,
  );
  const tenantIds = [...new Set(memberships.map((membership) => membership.tenant_id))]
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (!memberships.length || !tenantIds.length) return null;

  const tenantFilter = encodeURIComponent(`in.(${tenantIds.join(",")})`);
  const [tenantMemberships, tenants] = await Promise.all([
    dbRequest<Array<{ tenant_id: string }>>(
      `/rest/v1/jvg_tenant_memberships?user_id=${filterEq(user.userId)}&active=eq.true&tenant_id=${tenantFilter}&select=tenant_id&limit=50`,
    ),
    dbRequest<Array<{ id: string; status: string }>>(
      `/rest/v1/jvg_tenants?id=${tenantFilter}&status=in.(pilot,active)&select=id,status&limit=50`,
    ),
  ]);
  const activeTenantIds = new Set(tenantMemberships.map((membership) => membership.tenant_id));
  const availableTenantIds = new Set(tenants.map((tenant) => tenant.id));
  return memberships.find((membership) =>
    activeTenantIds.has(membership.tenant_id) && availableTenantIds.has(membership.tenant_id),
  ) ?? null;
}

export async function ensureSiteAccount(user: JvgAuthUser, companyName: string): Promise<SiteAccount> {
  const list = await dbRequest<SiteAccount[]>("/rest/v1/rpc/jvg_register_authenticated_pilot", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: user.userId,
      p_email: user.email,
      p_company_name: companyName,
    }),
  });
  if (!list[0]) throw new JvgBackendError("A empresa não pôde ser criada.");
  return list[0];
}

export async function getCompany(account: SiteAccount): Promise<(Record<string, unknown> & { fiscal_missing: string[]; fiscal_profile_complete: boolean }) | null> {
  const scope = `tenant_id=${filterEq(account.tenant_id)}&id=${filterEq(account.company_id)}`;
  const base = "id,legal_name,trade_name,cnpj,state_registration,municipal_registration,tax_regime,status,address,cnae,fiscal_email,fiscal_phone,nfe_series_homologacao,nfe_next_number_homologacao";
  let rows: Array<Record<string, unknown>>;
  let confirmationAvailable = true;
  try {
    rows = await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_companies?${scope}&select=${base},tax_regime_confirmed&limit=1`);
  } catch {
    // Mantém o restante do ERP funcional enquanto a migration manual está pendente.
    confirmationAvailable = false;
    rows = await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_companies?${scope}&select=${base}&limit=1`);
  }
  const stored = rows[0];
  const company = stored ? {
    ...stored,
    tax_regime_confirmed: confirmationAvailable && stored.tax_regime_confirmed === true,
    tax_regime_confirmation_available: confirmationAvailable,
  } : null;
  if (!company) return null;
  const missing = fiscalMissing(company);
  return { ...company, fiscal_missing: missing, fiscal_profile_complete: missing.length === 0 };
}

export function apiJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function safeError(error: unknown): Response {
  if (error instanceof JvgBackendError) return apiJson({ error: error.message }, error.status);
  return apiJson({ error: "Falha interna. Tente novamente." }, 500);
}

export function isSameOrigin(request: Request): boolean {
  // On Netlify the internal Request URL can use a different hostname than
  // the public hostname sent by the browser. Compare Origin to the incoming
  // Host header first; never trust X-Forwarded-Host as a CSRF authority.
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    const source = new URL(origin);
    if (source.protocol !== "https:" && !(source.protocol === "http:" && ["localhost", "127.0.0.1"].includes(source.hostname))) return false;
    if (source.username || source.password || source.pathname !== "/" || source.search || source.hash) return false;
    const host = request.headers.get("host");
    if (host) return source.host.toLowerCase() === host.trim().toLowerCase();
    return source.host.toLowerCase() === new URL(request.url).host.toLowerCase();
  } catch { return false; }
}

export function str(value: unknown, max = 180): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function positiveMoney(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 999999999) throw new JvgBackendError("Valor numérico inválido.", 400);
  return number;
}
