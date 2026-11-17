import { getJvgUser } from "../../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError, type SiteAccount } from "../../../../../lib/jvg-backend";
import { emitFocusNfceHomologacao, FocusNfeApiError } from "../../../../../lib/focus/client";
import { focusRuntimeEnv } from "../../../../../lib/focus/runtime-env";
import { homologationToken, licenseView } from "../../../../../lib/licensing";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedResponseFields = new Set([
  "status", "status_sefaz", "mensagem_sefaz", "ref", "chave_nfe", "numero", "serie", "protocolo",
  "numero_protocolo", "codigo_status", "erro", "mensagem", "caminho_xml_nota_fiscal", "caminho_danfe", "eventos",
]);

function obj(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown, max = 2000): string { return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : ""; }
function safeEvents(value: unknown): Array<string | Row> {
  if (!Array.isArray(value)) return [];
  const events: Array<string | Row> = [];
  for (const item of value.slice(0, 20)) {
    if (typeof item === "string" && item.length <= 500) {
      events.push(item);
      continue;
    }
    const event = obj(item);
    const selected = Object.fromEntries(Object.entries(event).filter(([name, field]) =>
      /^[a-zA-Z0-9_]{1,50}$/.test(name) &&
      ((typeof field === "string" && field.length <= 500) || (typeof field === "number" && Number.isFinite(field)))));
    if (Object.keys(selected).length) events.push(selected);
  }
  return events;
}
function scope(account: SiteAccount): string { return "tenant_id=" + filterEq(account.tenant_id) + "&company_id=" + filterEq(account.company_id); }
function safeProviderResponse(raw: unknown): Row {
  const source = obj(raw), safe: Row = {};
  for (const key of allowedResponseFields) {
    const value = source[key];
    if (typeof value === "string" && value.length <= 2000) safe[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (key === "eventos" && Array.isArray(value)) safe[key] = safeEvents(value);
  }
  return safe;
}
function statusFromFocus(value: unknown): "authorized" | "rejected" | "processing" | "cancelled" | "denied" {
  const status = text(value, 80).toLowerCase();
  if (["autorizado", "autorizada"].includes(status)) return "authorized";
  if (["erro_autorizacao", "rejeitado", "rejeitada", "erro"].includes(status)) return "rejected";
  if (["denegado", "denegada"].includes(status)) return "denied";
  if (["cancelado", "cancelada"].includes(status)) return "cancelled";
  return "processing";
}
function documentValues(body: Row): Row {
  const values: Row = { provider_response: { operation: "focus_nfce", phase: "response", response: safeProviderResponse(body), observedAt: new Date().toISOString() }, updated_at: new Date().toISOString() };
  const key = text(body.chave_nfe, 60).replace(/^NFe/i, "");
  if (/^\d{44}$/.test(key)) values.access_key = key;
  const number = Number(body.numero);
  if (Number.isSafeInteger(number) && number > 0) values.document_number = number;
  const series = text(body.serie, 5);
  if (/^\d{1,5}$/.test(series)) values.series = series;
  const xml = text(body.caminho_xml_nota_fiscal, 2000);
  const danfe = text(body.caminho_danfe, 2000);
  if (xml) values.xml_storage_path = xml;
  if (danfe) values.pdf_storage_path = danfe;
  if (body.status === "autorizado" || body.status === "autorizada") values.authorized_at = new Date().toISOString();
  return values;
}
async function logEvent(account: SiteAccount, id: string, eventType: string, status: string, payload: Row): Promise<void> {
  await dbRequest("/rest/v1/jvg_fiscal_events", { method: "POST", body: JSON.stringify({
    tenant_id: account.tenant_id, company_id: account.company_id, fiscal_document_id: id,
    event_type: eventType, status: status.slice(0, 40),
    protocol: text(payload.numero_protocolo || payload.protocolo, 80) || null,
    event_payload: { provider: "focus_nfe", environment: "homologacao", response: safeProviderResponse(payload), observedAt: new Date().toISOString() },
  }) });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    const account = await getSiteAccount(user);
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    if (account.role === "viewer") throw new JvgBackendError("Seu perfil não transmite NFC-e.", 403);
    const body = await request.json() as Row;
    if (body.confirmHomologation !== true) throw new JvgBackendError("Confirme que este envio é somente de homologação.", 400);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!uuidPattern.test(id)) throw new JvgBackendError("NFC-e inválida.", 400);
    const company = await getCompany(account);
    if (!company || company.fiscal_missing.length) throw new JvgBackendError("Complete os dados fiscais do emitente antes de transmitir.", 409);
    const license = await licenseView(account);
    if (license.schemaReady && license.issues.length) throw new JvgBackendError(license.issues[0], 403);
    const siteToken = focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN");
    const token = await homologationToken(account, siteToken);
    const scoped = scope(account);
    const rows = await dbRequest<Row[]>("/rest/v1/jvg_fiscal_documents?" + scoped + "&id=" + filterEq(id) + "&document_type=eq.nfce&environment=eq.homologacao&status=eq.draft&select=id,status,focus_reference,fiscal_payload&limit=1");
    const document = rows[0];
    const stored = obj(document?.fiscal_payload);
    if (!document || !["jvg_nfce_homologacao_v1", "jvg_nfce_homologacao_v2"].includes(String(stored.schema)) || !stored.payload || typeof stored.payload !== "object") {
      throw new JvgBackendError("Este rascunho não está pronto para transmissão. Prepare uma nova NFC-e após corrigir os dados.", 409);
    }
    const reference = typeof document.focus_reference === "string" ? document.focus_reference : "";
    if (!/^[A-Za-z0-9]{1,50}$/.test(reference)) throw new JvgBackendError("Referência Focus inválida no rascunho.", 409);
    const claimed = await dbRequest<Row[]>("/rest/v1/jvg_fiscal_documents?" + scoped + "&id=" + filterEq(id) + "&document_type=eq.nfce&environment=eq.homologacao&status=eq.draft&select=id", {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "processing", updated_at: new Date().toISOString() }),
    });
    if (!claimed.length) throw new JvgBackendError("Este rascunho já está sendo enviado ou teve o status alterado. Atualize o histórico antes de tentar novamente.", 409);
    try {
      await logEvent(account, id, "status_update", "transmission_started", { ref: reference, action: "transmission" });
    } catch {
      await dbRequest("/rest/v1/jvg_fiscal_documents?" + scoped + "&id=" + filterEq(id) + "&status=eq.processing", {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "draft", updated_at: new Date().toISOString() }),
      });
      throw new JvgBackendError("Não foi possível registrar a tentativa no histórico. Nenhum envio foi iniciado; tente novamente.", 503);
    }
    try {
      const result = await emitFocusNfceHomologacao(token, reference, obj(stored.payload));
      const status = statusFromFocus(result.body.status);
      await dbRequest("/rest/v1/jvg_fiscal_documents?" + scoped + "&id=" + filterEq(id) + "&status=eq.processing", {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status, ...documentValues(result.body) }),
      });
      const eventType = status === "authorized" ? "authorization" : status === "cancelled" ? "cancellation" : status === "rejected" || status === "denied" ? "error" : "status_update";
      let historyWarning = "";
      try { await logEvent(account, id, eventType, status, safeProviderResponse(result.body)); }
      catch { historyWarning = " O retorno foi salvo, mas o evento detalhado não pôde ser gravado."; }
      const message = text(result.body.mensagem_sefaz || result.body.mensagem, 500) ||
        (status === "authorized" ? "NFC-e autorizada em homologação pela Focus." :
          status === "processing" ? "A Focus recebeu a NFC-e. Consulte o histórico para confirmar o resultado." :
            "A Focus retornou o resultado da NFC-e; confira os detalhes no histórico.");
      return apiJson({ ok: true, environment: "homologacao", status, message: message + historyWarning });
    } catch (error) {
      const apiError = error instanceof FocusNfeApiError ? error : null;
      const provider = apiError ? safeProviderResponse(apiError.body) : {};
      const definiteRejection = Boolean(apiError && [400, 422].includes(apiError.httpStatus));
      const credentialFailure = Boolean(apiError && [401, 403].includes(apiError.httpStatus));
      const next = definiteRejection ? statusFromFocus(provider.status || "erro_autorizacao") : credentialFailure ? "draft" : "processing";
      await dbRequest("/rest/v1/jvg_fiscal_documents?" + scoped + "&id=" + filterEq(id) + "&status=eq.processing", {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: next, ...documentValues(provider) }),
      });
      try { await logEvent(account, id, definiteRejection ? "error" : "status_update", next, { ...provider, httpStatus: apiError?.httpStatus, ref: reference }); }
      catch { /* Mantém o estado primário do documento quando a trilha secundária falha. */ }
      if (credentialFailure) throw new JvgBackendError("A Focus não aceitou a credencial de homologação. O rascunho foi preservado para nova tentativa após corrigir o token.", 502);
      if (definiteRejection) {
        const reason = text(provider.mensagem_sefaz || provider.mensagem || provider.erro, 400);
        throw new JvgBackendError(reason ? "NFC-e rejeitada pela Focus: " + reason : "NFC-e rejeitada pela Focus. Abra o histórico para ver o motivo retornado.", 502);
      }
      throw new JvgBackendError("Não foi possível confirmar o resultado do envio. A NFC-e permanece em processamento para evitar duplicidade; consulte a Focus no histórico antes de qualquer nova ação.", 502);
    }
  } catch (error) { return safeError(error); }
}
