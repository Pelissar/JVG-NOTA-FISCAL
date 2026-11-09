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

export function filterEq(value: string): string { return encodeURIComponent(`eq.${value}`); }

/** Acesso global e separado da empresa: so apos verificacao do email no Auth. */
export async function getPlatformRole(user: JvgAuthUser): Promise<"platform_admin" | null> {
  const role = await dbRequest<string | null>("/rest/v1/rpc/jvg_claim_platform_admin", {
    method: "POST",
    body: JSON.stringify({ p_user_id: user.userId, p_email: user.email }),
  });
  return role === "platform_admin" ? role : null;
}

export async function getSiteAccount(user: JvgAuthUser): Promise<SiteAccount | null> {
  const result = await dbRequest<SiteAccount[]>(
    `/rest/v1/jvg_company_memberships?user_id=${filterEq(user.userId)}&active=eq.true&select=tenant_id,company_id,role&order=created_at.asc&limit=1`,
  );
  return result[0] ?? null;
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
  const rows = await dbRequest<Array<Record<string, unknown>>>(
    `/rest/v1/jvg_companies?tenant_id=${filterEq(account.tenant_id)}&id=${filterEq(account.company_id)}&select=id,legal_name,trade_name,cnpj,state_registration,municipal_registration,tax_regime,status,address,cnae,fiscal_email,fiscal_phone,nfe_series_homologacao,nfe_next_number_homologacao&limit=1`,
  );
  const company = rows[0];
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
