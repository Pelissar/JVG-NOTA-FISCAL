import { timingSafeEqual } from "node:crypto";
import { apiJson, dbRequest, filterEq, safeError } from "../../../../../lib/jvg-backend";
import { focusRuntimeEnv } from "../../../../../lib/focus/runtime-env";
import { focusWebhookEventKey, normalizeFocusWebhookStatus, safeFocusWebhookPayload } from "../../../../../lib/focus/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function constantTimeMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function responseText(value: unknown): string {
  if (typeof value === "string") return value.trim().slice(0, 2000);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function positiveInteger(value: unknown): number | null {
  const raw = responseText(value);
  if (!/^\d{1,15}$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isoDate(value: unknown): string | null {
  const raw = responseText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function POST(request: Request) {
  const secret = focusRuntimeEnv("JVG_FOCUS_WEBHOOK_SECRET");
  const headerName = focusRuntimeEnv("JVG_FOCUS_WEBHOOK_HEADER") || "X-JVG-Focus-Webhook";
  if (secret.length < 32 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/.test(headerName))
    return apiJson({ error: "Webhook Focus não configurado no servidor." }, 503);
  const receivedSecret = request.headers.get(headerName) || "";
  if (!constantTimeMatch(receivedSecret, secret)) return apiJson({ error: "Não autorizado." }, 401);

  try {
    const raw = await request.text();
    if (raw.length > 64_000) return apiJson({ error: "Notificação muito grande." }, 413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return apiJson({ error: "JSON inválido." }, 400); }
    const body = obj(input);
    const safeResponse = safeFocusWebhookPayload(body);
    const reference = responseText(body.ref);
    if (!/^[A-Za-z0-9]{1,50}$/.test(reference)) return apiJson({ error: "Referência Focus ausente ou inválida." }, 400);
    const reportedStatus = responseText(body.status).toLowerCase();
    const normalizedStatus = normalizeFocusWebhookStatus(reportedStatus);
    if (!normalizedStatus) return apiJson({ error: "Situação da notificação Focus não reconhecida." }, 400);

    const documents = await dbRequest<Array<{
      id: string; tenant_id: string; company_id: string; document_type: string; status: string;
    }>>(
      `/rest/v1/jvg_fiscal_documents?focus_reference=${filterEq(reference)}&environment=eq.homologacao` +
      `&document_type=in.%28nfe%2Cnfse%29&select=id,tenant_id,company_id,document_type,status&limit=2`,
    );
    if (!documents.length) return apiJson({ error: "Referência fiscal não encontrada em homologação." }, 404);
    if (documents.length !== 1) return apiJson({ error: "Referência fiscal ambígua; notificação retida para revisão." }, 409);
    const document = documents[0];
    const nfe = document.document_type === "nfe";
    const accessKey = responseText(nfe
      ? body.chave_nfe ?? body.chave_acesso
      : body.chave_nfse ?? body.chave_acesso ?? body.chave);
    const eventType = normalizedStatus === "authorized" ? "authorization"
      : normalizedStatus === "cancelled" ? "cancellation"
        : normalizedStatus === "processing" ? "status_update" : "error";
    const eventKey = focusWebhookEventKey(reference, safeResponse);
    const eventPayload = {
      provider: "focus_nfe", reference, reportedStatus,
      documentType: document.document_type, receivedAt: new Date().toISOString(), response: safeResponse,
    };
    const applied = await dbRequest<Json>("/rest/v1/rpc/jvg_apply_focus_webhook", {
      method: "POST",
      body: JSON.stringify({
        p_reference: reference,
        p_event_key: eventKey,
        p_reported_status: reportedStatus,
        p_internal_status: normalizedStatus,
        p_event_type: eventType,
        p_protocol: responseText(body.numero_protocolo ?? body.protocolo),
        p_access_key: accessKey,
        p_series: responseText(body.serie_nfse ?? body.serie ?? body.serie_dps),
        p_document_number: positiveInteger(body.numero_nfse ?? body.numero),
        p_issued_at: isoDate(body.data_emissao),
        p_authorized_at: isoDate(body.data_autorizacao ?? body.data_hora_autorizacao),
        p_xml_storage_path: responseText(body.caminho_xml_nota_fiscal ?? body.caminho_xml ?? body.url_xml_nota_fiscal ?? body.url_xml),
        p_pdf_storage_path: responseText(body.caminho_danfe ?? body.caminho_pdf_nota_fiscal ?? body.url_danfe ?? body.url_pdf),
        p_provider_response: safeResponse,
        p_event_payload: eventPayload,
      }),
    });
    if (applied.ok !== true) return apiJson({ error: "Notificação recebida, mas não foi possível confirmar o processamento." }, 502);
    return apiJson({ ok: true, duplicate: applied.duplicate === true });
  } catch (error) { return safeError(error); }
}
