import { getJvgUser } from "../../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError, type SiteAccount } from "../../../../../lib/jvg-backend";
import { queryFocusNfceHomologacao, FocusNfeApiError } from "../../../../../lib/focus/client";
import { focusRuntimeEnv } from "../../../../../lib/focus/runtime-env";
import { homologationToken, licenseView } from "../../../../../lib/licensing";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeFields = ["status", "status_sefaz", "mensagem_sefaz", "ref", "chave_nfe", "numero", "serie", "protocolo", "numero_protocolo", "codigo_status", "erro", "mensagem", "caminho_xml_nota_fiscal", "caminho_danfe", "eventos"];
function obj(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown, max = 2000): string { return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : ""; }
function scope(account: SiteAccount): string { return "tenant_id=" + filterEq(account.tenant_id) + "&company_id=" + filterEq(account.company_id); }
function safeResponse(raw: unknown): Row {
  const source = obj(raw), result: Row = {};
  for (const key of safeFields) {
    const value = source[key];
    if ((typeof value === "string" && value.length <= 2000) || (typeof value === "number" && Number.isFinite(value))) result[key] = value;
    else if (key === "eventos" && Array.isArray(value)) result[key] = value.slice(0, 20).flatMap(item => {
      if (typeof item === "string" && item.length <= 500) return [item];
      const event = obj(item);
      const safe = Object.fromEntries(Object.entries(event).filter(([name, child]) => /^[A-Za-z0-9_]{1,50}$/.test(name) && ((typeof child === "string" && child.length <= 500) || (typeof child === "number" && Number.isFinite(child)))));
      return Object.keys(safe).length ? [safe] : [];
    });
  }
  return result;
}
function statusFromFocus(value: unknown): "authorized" | "rejected" | "processing" | "cancelled" | "denied" {
  const status = text(value, 80).toLowerCase();
  if (["autorizado", "autorizada"].includes(status)) return "authorized";
  if (["erro_autorizacao", "rejeitado", "rejeitada", "erro"].includes(status)) return "rejected";
  if (["denegado", "denegada"].includes(status)) return "denied";
  if (["cancelado", "cancelada"].includes(status)) return "cancelled";
  return "processing";
}
async function logEvent(account: SiteAccount, id: string, type: string, status: string, payload: Row): Promise<void> {
  await dbRequest("/rest/v1/jvg_fiscal_events", { method: "POST", body: JSON.stringify({
    tenant_id: account.tenant_id, company_id: account.company_id, fiscal_document_id: id,
    event_type: type, status: status.slice(0, 40),
    protocol: text(payload.numero_protocolo || payload.protocolo, 80) || null,
    event_payload: { provider: "focus_nfe", action: "consultation", environment: "homologacao", response: safeResponse(payload), observedAt: new Date().toISOString() },
  }) });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    const account = await getSiteAccount(user);
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    if (account.role === "viewer") throw new JvgBackendError("Seu perfil não pode consultar documentos fiscais.", 403);
    const body = await request.json() as Row;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!uuidPattern.test(id)) throw new JvgBackendError("NFC-e inválida.", 400);
    const company = await getCompany(account);
    if (!company) throw new JvgBackendError("Empresa emitente não encontrada.", 404);
    const license = await licenseView(account);
    if (license.schemaReady && license.issues.length) throw new JvgBackendError(license.issues[0], 403);
    const siteToken = focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN");
    const token = await homologationToken(account, siteToken);
    const scoped = scope(account);
    const documents = await dbRequest<Row[]>("/rest/v1/jvg_fiscal_documents?" + scoped + "&id=" + filterEq(id) + "&document_type=eq.nfce&environment=eq.homologacao&select=id,status,focus_reference&limit=1");
    const document = documents[0];
    if (!document) throw new JvgBackendError("NFC-e não encontrada nesta empresa e em homologação.", 404);
    const reference = text(document.focus_reference, 50);
    if (!/^[A-Za-z0-9]{1,50}$/.test(reference)) throw new JvgBackendError("Referência Focus inválida.", 409);
    await logEvent(account, id, "status_update", "consultation_started", { ref: reference });
    let result;
    try { result = await queryFocusNfceHomologacao(token, reference); }
    catch (error) {
      const provider = error instanceof FocusNfeApiError ? safeResponse(error.body) : {};
      try { await logEvent(account, id, "error", "consultation_error", { ...provider, httpStatus: error instanceof FocusNfeApiError ? error.httpStatus : undefined, ref: reference }); } catch { /* Mantém a falha observável para quem consultou. */ }
      if (error instanceof FocusNfeApiError && error.httpStatus === 404)
        throw new JvgBackendError("A Focus não encontrou esta referência. O documento continua no histórico para conferência.", 404);
      throw new JvgBackendError("Não foi possível consultar o retorno da Focus. O status local foi preservado; tente novamente.", 502);
    }
    const provider = safeResponse(result.body);
    const next = statusFromFocus(result.body.status);
    const values: Row = {
      status: next,
      provider_response: { operation: "focus_nfce", phase: "consultation", response: provider, observedAt: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };
    const key = text(result.body.chave_nfe, 60).replace(/^NFe/i, "");
    if (/^\d{44}$/.test(key)) values.access_key = key;
    const number = Number(result.body.numero);
    if (Number.isSafeInteger(number) && number > 0) values.document_number = number;
    const series = text(result.body.serie, 5);
    if (/^\d{1,5}$/.test(series)) values.series = series;
    const xml = text(result.body.caminho_xml_nota_fiscal, 2000);
    const pdf = text(result.body.caminho_danfe, 2000);
    if (xml) values.xml_storage_path = xml;
    if (pdf) values.pdf_storage_path = pdf;
    if (next === "authorized") values.authorized_at = new Date().toISOString();
    await dbRequest("/rest/v1/jvg_fiscal_documents?" + scoped + "&id=" + filterEq(id) + "&document_type=eq.nfce&environment=eq.homologacao", {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(values),
    });
    const eventType = next === "authorized" ? "authorization" : next === "cancelled" ? "cancellation" : next === "rejected" || next === "denied" ? "error" : "status_update";
    let logWarning = "";
    try { await logEvent(account, id, eventType, next, provider); } catch { logWarning = " O status foi atualizado, mas o evento fiscal não pôde ser gravado."; }
    const message = text(result.body.mensagem_sefaz || result.body.mensagem, 500) || "Consulta concluída: " + (next === "processing" ? "a Focus ainda está processando a NFC-e." : labelsFor(next)) + ".";
    return apiJson({ ok: true, status: next, message: message + logWarning });
  } catch (error) { return safeError(error); }
}

function labelsFor(status: string): string {
  const values: Record<string, string> = { authorized: "autorizada", rejected: "rejeitada", cancelled: "cancelada", denied: "denegada" };
  return values[status] || "status atualizado";
}
