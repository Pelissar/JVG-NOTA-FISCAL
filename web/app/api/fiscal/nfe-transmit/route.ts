import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError,
} from "../../../../lib/jvg-backend";
import { buildFocusNfePayload, emissionBlockers, focusFileUrl } from "../../../../lib/focus/nfe-payload";
import { focusHomolog, focusMessage } from "../../../../lib/focus/nfe-api";
import { focusRuntimeEnv } from "../../../../lib/focus/runtime-env";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function saoPauloIso(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}-03:00`;
}

function dbStatus(focusStatus: string): string {
  if (focusStatus === "autorizado") return "authorized";
  if (focusStatus === "erro_autorizacao") return "rejected";
  if (focusStatus === "cancelado") return "cancelled";
  if (focusStatus === "denegado") return "denied";
  return "processing";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    const account = await getSiteAccount(user);
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para transmitir.", 403);

    const pilot = focusRuntimeEnv("JVG_FOCUS_PILOT_COMPANY_ID");
    const token = focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN");
    if (!pilot || pilot !== account.company_id) throw new JvgBackendError("A Focus está habilitada só para a empresa piloto.", 403);
    if (!token) throw new JvgBackendError("Token de homologação da Focus ausente na Netlify.", 503);

    const input = await request.json() as Row;
    const id = typeof input.id === "string" ? input.id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new JvgBackendError("Nota inválida.", 400);
    }
    const action = input.action === "sync" || input.action === "cancel" ? input.action : "transmit";
    const scope = `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(id)}&document_type=eq.nfe&environment=eq.homologacao`;
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scope}&select=id,status,focus_reference,fiscal_payload&limit=1`);
    const note = rows[0];
    if (!note) throw new JvgBackendError("Nota não encontrada nesta empresa.", 404);

    const status = String(note.status || "draft");
    const ref = typeof note.focus_reference === "string" && note.focus_reference
      ? note.focus_reference
      : `jvg${id.replace(/-/g, "")}`;
    const payload = note.fiscal_payload && typeof note.fiscal_payload === "object" ? note.fiscal_payload as Row : {};

    if (action === "cancel") {
      if (status !== "authorized") throw new JvgBackendError("Só uma nota autorizada pode ser cancelada.", 409);
      const reason = typeof input.justificativa === "string" ? input.justificativa.trim() : "";
      if (reason.length < 15 || reason.length > 255) throw new JvgBackendError("A justificativa precisa ter de 15 a 255 caracteres.", 400);
      const result = await focusHomolog(`/v2/nfe/${encodeURIComponent(ref)}`, token, { method: "DELETE", body: { justificativa: reason } });
      const message = focusMessage(result.body);
      if (result.httpStatus >= 400) throw new JvgBackendError(message, result.httpStatus === 401 ? 502 : 422);
      await save(scope, { status: "cancelled", provider_response: { status: "cancelado", mensagem: message } });
      return apiJson({ ok: true, status: "cancelled", message });
    }

    if (action === "sync" || status === "authorized" || status === "processing") {
      if (status === "draft" && action === "sync") throw new JvgBackendError("Esta nota ainda não foi enviada.", 409);
      const result = await focusHomolog(`/v2/nfe/${encodeURIComponent(ref)}`, token, { method: "GET" });
      if (result.httpStatus === 404) return apiJson({ ok: false, status, message: "A Focus ainda não encontrou esta nota." }, 404);
      if (result.httpStatus >= 400) throw new JvgBackendError(focusMessage(result.body), 502);
      const saved = await applyFocus(scope, ref, result.httpStatus, result.body);
      return apiJson({ ok: true, ...saved });
    }

    if (status !== "draft" && status !== "rejected") {
      throw new JvgBackendError("Esta nota não pode ser transmitida de novo.", 409);
    }
    const company = await getCompany(account);
    if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
    const blockers = emissionBlockers(company, payload);
    if (blockers.length) return apiJson({ ok: false, status, blockers }, 422);

    await save(scope, { status: "processing", focus_reference: ref, idempotency_key: ref, issued_at: new Date().toISOString() });
    const body = buildFocusNfePayload(company, payload, saoPauloIso());
    const result = await focusHomolog(`/v2/nfe?ref=${encodeURIComponent(ref)}`, token, { method: "POST", body });
    const saved = await applyFocus(scope, ref, result.httpStatus, result.body);
    return apiJson({ ok: saved.status === "authorized" || saved.status === "processing", ...saved }, result.httpStatus >= 400 ? 422 : 200);
  } catch (error) {
    return safeError(error);
  }
}

async function save(scope: string, patch: Row) {
  await dbRequest(`/rest/v1/jvg_fiscal_documents?${scope}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function applyFocus(scope: string, ref: string, httpStatus: number, body: Row) {
  const focusStatus = typeof body.status === "string" ? body.status : "";
  const status = httpStatus >= 400 && !focusStatus ? "rejected" : dbStatus(focusStatus || "processando_autorizacao");
  const message = focusMessage(body);
  const number = Number(body.numero);
  const danfeUrl = focusFileUrl(body.caminho_danfe);
  const xmlUrl = focusFileUrl(body.caminho_xml_nota_fiscal);
  await save(scope, {
    status,
    focus_reference: ref,
    idempotency_key: ref,
    access_key: typeof body.chave_nfe === "string" ? body.chave_nfe : null,
    series: body.serie == null ? null : String(body.serie),
    document_number: Number.isSafeInteger(number) && number > 0 ? number : null,
    pdf_storage_path: danfeUrl,
    xml_storage_path: xmlUrl,
    authorized_at: status === "authorized" ? new Date().toISOString() : null,
    provider_response: { status: focusStatus || null, mensagem: message, protocolo: body.protocolo ?? body.numero_protocolo ?? null, httpStatus },
  });
  return {
    status,
    message,
    danfeUrl,
    accessKey: typeof body.chave_nfe === "string" ? body.chave_nfe : null,
    number: Number.isSafeInteger(number) ? number : null,
  };
}
