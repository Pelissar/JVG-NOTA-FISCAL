import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import { buildFocusNfseNationalPayload } from "../../../../lib/focus/nfse-national";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown, max: number, label: string): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new JvgBackendError(`${label} inválido.`, 400);
  const result = value.trim();
  if (result.length > max) throw new JvgBackendError(`${label} excede ${max} caracteres.`, 400);
  return result;
}

function uuid(value: unknown, label: string, optional = false): string {
  if (optional && (value == null || value === "")) return "";
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new JvgBackendError(`${label} inválido.`, 400);
  return value;
}

function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new JvgBackendError(`${label} ausente ou inválida.`, 400);
  return value;
}

function optionalSequence(value: unknown, label: string, maximum: number): string {
  if (value == null || value === "") return "";
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,15}$/.test(raw) || Number(raw) < 1 || Number(raw) > maximum)
    throw new JvgBackendError(`${label} inválido.`, 400);
  return raw;
}

function optionalCode(value: unknown, digits: number, label: string): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !new RegExp(`^\\d{${digits}}$`).test(value.trim()))
    throw new JvgBackendError(`${label} deve conter ${digits} dígitos.`, 400);
  return value.trim();
}

function optionalMoney(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\d{1,9}(?:\.\d{1,2})?$/.test(value.trim()) ? Number(value) : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0 || raw > 999999999 || Math.abs(Math.round(raw * 100) - raw * 100) > 1e-7)
    throw new JvgBackendError("Valor do serviço inválido. Informe um valor maior que zero com até duas casas decimais.", 400);
  return raw;
}

async function accountForRequest(): Promise<SiteAccount> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return account;
}

function scope(account: SiteAccount): string {
  return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
}

async function getServiceRows(account: SiteAccount) {
  const scoped = scope(account);
  try {
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_services?${scoped}&active=eq.true&select=id,code,name,description,national_service_code,national_taxation_code,nbs,sale_price&order=name.asc&limit=500`);
    return { rows, nationalTaxationCodeColumnAvailable: true };
  } catch {
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_services?${scoped}&active=eq.true&select=id,code,name,description,national_service_code,nbs,sale_price&order=name.asc&limit=500`);
    return { rows, nationalTaxationCodeColumnAvailable: false };
  }
}

async function getDpsSequence(account: SiteAccount) {
  try {
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_companies?tenant_id=${filterEq(account.tenant_id)}&id=${filterEq(account.company_id)}&select=nfse_series_homologacao,nfse_next_number_homologacao&limit=1`);
    return { available: true, series: rows[0]?.nfse_series_homologacao ?? "", number: rows[0]?.nfse_next_number_homologacao ?? "" };
  } catch {
    return { available: false, series: "", number: "" };
  }
}

async function scopedOrder(account: SiteAccount, id: string): Promise<Row> {
  const rows = await dbRequest<Row[]>(`/rest/v1/jvg_service_orders?${scope(account)}&id=${filterEq(id)}&select=id,os_number,customer_id,device_type,brand,model,serial_number,reported_issue,diagnosis,status,customer_approved,estimated_value,created_at,updated_at&limit=1`);
  if (!rows[0]) throw new JvgBackendError("Ordem de serviço não encontrada nesta empresa.", 404);
  return rows[0];
}

async function scopedCustomer(account: SiteAccount, customerId: unknown): Promise<Row | null> {
  if (typeof customerId !== "string" || !uuidPattern.test(customerId)) return null;
  const rows = await dbRequest<Row[]>(`/rest/v1/jvg_parties?${scope(account)}&id=${filterEq(customerId)}&is_customer=eq.true&active=eq.true&select=id,display_name,legal_name,document_type,document_number,email,phone,address&limit=1`);
  return rows[0] ?? null;
}

function taxRules(profile: Row | undefined) {
  const rules = object(profile?.rules);
  const nfse = object(rules.nfse);
  return {
    reviewStatus: String(profile?.review_status || "draft"),
    codigoOpcaoSimplesNacional: nfse.codigoOpcaoSimplesNacional as string | number | undefined,
    regimeTributarioSimplesNacional: nfse.regimeTributarioSimplesNacional as string | number | undefined,
    regimeEspecialTributacao: nfse.regimeEspecialTributacao as string | number | undefined,
    tributacaoIss: nfse.tributacaoIss as string | number | undefined,
  };
}

async function existingDraft(account: SiteAccount, serviceOrderId: string) {
  const key = `nfse-os-${serviceOrderId}`;
  const rows = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scope(account)}&document_type=eq.nfse&environment=eq.homologacao&idempotency_key=${filterEq(key)}&select=id,status,series,document_number,focus_reference,fiscal_payload,created_at,updated_at&limit=1`);
  return rows[0] ?? null;
}

export async function GET() {
  return apiJson({ error: "A nota de serviço saiu do sistema. A emissão agora é feita somente no portal." }, 410);
}

export async function POST() {
  return apiJson({ error: "A nota de serviço saiu do sistema. A emissão agora é feita somente no portal." }, 410);
}
