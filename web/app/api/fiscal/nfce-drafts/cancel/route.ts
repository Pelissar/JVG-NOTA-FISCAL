import { getJvgUser } from "../../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError, type SiteAccount } from "../../../../../lib/jvg-backend";
import { cancelFocusNfceHomologacao, FocusNfeApiError } from "../../../../../lib/focus/client";
import { focusRuntimeEnv } from "../../../../../lib/focus/runtime-env";
import { homologationToken, licenseView } from "../../../../../lib/licensing";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeFields = new Set([
  "status", "status_sefaz", "mensagem_sefaz", "ref", "chave_nfe", "numero", "serie", "protocolo",
  "numero_protocolo", "codigo_status", "erro", "mensagem", "caminho_xml_nota_fiscal", "caminho_danfe",
  "caminho_xml_cancelamento", "eventos",
]);

function obj(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown, max = 2000): string { return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : ""; }
function scope(account: SiteAccount): string { return "tenant_id=" + filterEq(account.tenant_id) + "&company_id=" + filterEq(account.company_id); }
function safeResponse(raw: unknown): Row {
  const source = obj(raw), result: Row = {};
  for (const key of safeFields) {
    const value = source[key];
    if ((typeof value === "string" && value.length <= 2000) || (typeof value === "number" && Number.isFinite(value))) result[key] = value;
    else if (key === "eventos" && Array.isArray(value)) result[key] = value.slice(0, 20).map(item => {
      if (typeof item === "string") return item.slice(0, 500);
      const event = obj(item);
      return Object.fromEntries(Object.entries(event).filter(([name, child]) => /^[a-zA-Z0-9_]{1,50}$/.test(name) && ((typeof child === "string" && child.length <= 500) || (typeof child === "number" && Number.isFinite(child)))));
    });
  }
  return result;
}
async function logEvent(account: SiteAccount, id: string, eventType: string, status: string, payload: Row, reason: string): Promise<void> {
  await dbRequest("/rest/v1/jvg_fiscal_events", { method: "POST", body: JSON.stringify({
    tenant_id: account.tenant_id, company_id: account.company_id, fiscal_document_id: id,
    event_type: eventType, status: status.slice(0, 40),
    protocol: text(payload.numero_protocolo || payload.protocolo, 80) || null,
    event_payload: { provider: "focus_nfe", action: "cancellation", environment: "homologacao", reason, response: safeResponse(payload), observedAt: new Date().toISOString() },
  }) });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    const account = await getSiteAccount(user, { requiredModule: "nfce" });
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    if (!["owner", "admin", "manager", "operator"].includes(String(account.member_role || account.role))) {
      throw new JvgBackendError("Seu perfil pode consultar documentos, mas não pode cancelar cupons fiscais.", 403);
    }
    const body = await request.json() as Row;
    const id = text(body.id, 80);
    const reason = text(body.justificativa, 300).replace(/\s+/g, " ");
    if (!uuidPattern.test(id)) throw new JvgBackendError("NFC-e inválida.", 400);
    if (reason.length < 15 || reason.length > 255) throw new JvgBackendError("A justificativa precisa ter entre 15 e 255 caracteres.", 400);

    const license = await licenseView(account);
    if (license.schemaReady && license.issues.length) throw new JvgBackendError(license.issues[0], 403);
    const token = await homologationToken(
      account,
      focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN"),
    );
    const scoped = scope(account);
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scoped}&id=${filterEq(id)}&document_type=eq.nfce&environment=eq.homologacao&select=id,status,focus_reference,provider_response&limit=1`);
    const document = rows[0];
    if (!document) throw new JvgBackendError("NFC-e não encontrada nesta empresa e em homologação.", 404);
    if (document.status !== "authorized") throw new JvgBackendError("Somente uma NFC-e autorizada pode ser cancelada.", 409);
    const reference = text(document.focus_reference, 50);
    if (!/^[A-Za-z0-9]{1,50}$/.test(reference)) throw new JvgBackendError("Referência fiscal inválida.", 409);

    const claimed = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scoped}&id=${filterEq(id)}&document_type=eq.nfce&environment=eq.homologacao&status=eq.authorized&select=id`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "processing", updated_at: new Date().toISOString() }),
    });
    if (!claimed.length) throw new JvgBackendError("O status deste cupom mudou. Atualize o histórico antes de tentar cancelar.", 409);

    try {
      await logEvent(account, id, "status_update", "cancellation_started", { ref: reference }, reason);
    } catch {
      await dbRequest(`/rest/v1/jvg_fiscal_documents?${scoped}&id=${filterEq(id)}&status=eq.processing`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "authorized", updated_at: new Date().toISOString() }),
      });
      throw new JvgBackendError("Não foi possível registrar a ação no histórico. Nenhum cancelamento foi solicitado.", 503);
    }

    try {
      const result = await cancelFocusNfceHomologacao(token, reference, reason);
      const provider = safeResponse(result.body);
      const cancelled = text(result.body.status, 80).toLowerCase() === "cancelado";
      const nextStatus = cancelled ? "cancelled" : "authorized";
      const previous = obj(document.provider_response);
      const oldResponse = obj(previous.response);
      const mergedResponse = { ...oldResponse, ...provider };
      const patch: Row = {
        status: nextStatus,
        provider_response: { operation: "focus_nfce", phase: cancelled ? "cancellation" : "cancellation_rejected", response: mergedResponse, observedAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      };
      await dbRequest(`/rest/v1/jvg_fiscal_documents?${scoped}&id=${filterEq(id)}&document_type=eq.nfce&environment=eq.homologacao&status=eq.processing`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
      });
      let historyWarning = "";
      try { await logEvent(account, id, cancelled ? "cancellation" : "error", cancelled ? "cancelled" : "cancellation_rejected", result.body, reason); }
      catch { historyWarning = " A situação foi atualizada, mas o detalhe não pôde ser incluído no histórico."; }
      if (!cancelled) {
        const providerReason = text(result.body.mensagem_sefaz || result.body.mensagem || result.body.erro, 350);
        return apiJson({ ok: false, status: "authorized", message: (providerReason ? `O cancelamento não foi aceito: ${providerReason}` : "O cancelamento não foi aceito. O cupom continua autorizado.") + historyWarning }, 422);
      }
      return apiJson({ ok: true, status: "cancelled", message: "Cupom cancelado em homologação. O registro e o retorno do cancelamento foram preservados no histórico." + historyWarning });
    } catch (error) {
      if (error instanceof FocusNfeApiError && error.httpStatus < 500) {
        const provider = safeResponse(error.body);
        const previous = obj(document.provider_response);
        const oldResponse = obj(previous.response);
        await dbRequest(`/rest/v1/jvg_fiscal_documents?${scoped}&id=${filterEq(id)}&document_type=eq.nfce&environment=eq.homologacao&status=eq.processing`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "authorized", provider_response: { operation: "focus_nfce", phase: "cancellation_rejected", response: { ...oldResponse, ...provider }, observedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }),
        });
        try { await logEvent(account, id, "error", "cancellation_rejected", { ...provider, httpStatus: error.httpStatus }, reason); } catch { /* A nota autorizada continua disponível para consulta. */ }
        const providerReason = text(error.body.mensagem_sefaz || error.body.mensagem || error.body.erro, 350);
        return apiJson({ ok: false, status: "authorized", message: providerReason ? `O serviço fiscal não aceitou o cancelamento: ${providerReason}. O cupom continua autorizado.` : "O serviço fiscal não aceitou o cancelamento. O cupom continua autorizado." }, 422);
      }
      try { await logEvent(account, id, "error", "cancellation_outcome_unknown", { ref: reference }, reason); } catch { /* A reconciliação continua disponível. */ }
      return apiJson({ ok: false, status: "processing", needsReconciliation: true, message: "Não foi possível confirmar a resposta do cancelamento. O cupom ficou aguardando consulta para evitar duplicidade." }, 202);
    }
  } catch (error) { return safeError(error); }
}
