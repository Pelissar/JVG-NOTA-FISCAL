import { jvgRuntime } from "./jvg-runtime";
import type { ChatGPTUser } from "../app/chatgpt-auth";

export const JVG_SITE_ID = "appgprj_6aedb5b0b2d08191823212b94a3815a1";

export type SiteAccount = { tenant_id: string; company_id: string };

export class JvgBackendError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

export function isConfigured(): boolean {
  return !!jvgRuntime().supabaseSecretKey;
}

export async function dbRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const runtime = jvgRuntime();
  const secret = runtime.supabaseSecretKey;
  if (!secret) throw new JvgBackendError("Chave privada do Supabase ainda não configurada.", 503);
  if (!path.startsWith("/rest/v1/") || path.includes("..")) throw new JvgBackendError("Consulta inválida.", 400);
  const headers = new Headers(init.headers);
  headers.set("apikey", secret);
  if (secret.split(".").length === 3) headers.set("Authorization", `Bearer ${secret}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET") headers.set("Prefer", "return=representation");
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

export async function getSiteAccount(user: ChatGPTUser): Promise<SiteAccount | null> {
  const result = await dbRequest<SiteAccount[]>(
    `/rest/v1/jvg_site_accounts?site_project_id=${filterEq(JVG_SITE_ID)}&site_user_id=${filterEq(user.userId)}&select=tenant_id,company_id&limit=1`,
  );
  return result[0] ?? null;
}

export async function ensureSiteAccount(user: ChatGPTUser, companyName: string): Promise<SiteAccount> {
  const list = await dbRequest<SiteAccount[]>("/rest/v1/rpc/jvg_register_site_pilot", {
    method: "POST",
    body: JSON.stringify({
      p_site_project_id: JVG_SITE_ID,
      p_site_user_id: user.userId,
      p_email: user.email,
      p_company_name: companyName,
    }),
  });
  if (!list[0]) throw new JvgBackendError("A empresa não pôde ser criada.");
  return list[0];
}

export async function getCompany(account: SiteAccount) {
  const rows = await dbRequest<Array<Record<string, unknown>>>(
    `/rest/v1/jvg_companies?tenant_id=${filterEq(account.tenant_id)}&id=${filterEq(account.company_id)}&select=id,legal_name,trade_name,cnpj,state_registration,municipal_registration,tax_regime,status,address&limit=1`,
  );
  return rows[0] ?? null;
}

export function apiJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function safeError(error: unknown): Response {
  if (error instanceof JvgBackendError) return apiJson({ error: error.message }, error.status);
  return apiJson({ error: "Falha interna. Tente novamente." }, 500);
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export function str(value: unknown, max = 180): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function positiveMoney(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 999999999) throw new JvgBackendError("Valor numérico inválido.", 400);
  return number;
}
