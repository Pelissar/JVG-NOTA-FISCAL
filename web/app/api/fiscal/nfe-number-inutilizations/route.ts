import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getPlatformRole, getSiteAccount,
  isSameOrigin, JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import { focusRuntimeEnv } from "../../../../lib/focus/runtime-env";
import {
  FocusNfeApiError, inutilizeFocusNfeNumberHomologacao,
} from "../../../../lib/focus/client";

export const dynamic = "force-dynamic";
type Json = Record<string, unknown>;
type Row = Record<string, unknown>;
type Context = { userId: string; account: SiteAccount; token: string; cnpj: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const responseFields = [
  "status", "status_sefaz", "mensagem_sefaz", "codigo_status", "protocolo",
  "numero_protocolo", "serie", "numero_inicial", "numero_final", "modelo",
  "cnpj", "caminho_xml_nota_fiscal",
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function scalarText(value: unknown): string {
  return typeof value === "string" ? value.trim() :
    typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function scope(account: SiteAccount): string {
  return "tenant_id=" + filterEq(account.tenant_id) + "&company_id=" + filterEq(account.company_id);
}

function safeFocusResponse(body: Json): Json {
  const result: Json = {};
  for (const key of responseFields) {
    const value = body[key];
    if ((typeof value === "string" && value.length <= 2000) ||
        (typeof value === "number" && Number.isFinite(value))) result[key] = value;
  }
  return result;
}

function outcome(body: Json): "authorized" | "rejected" | "outcome_unknown" {
  const providerStatus = scalarText(body.status).toLowerCase();
  const statusCode = scalarText(body.status_sefaz).match(/^\s*(\d{3})/)?.[1] ||
    scalarText(body.codigo_status).match(/^\s*(\d{3})/)?.[1] || "";
  if (statusCode === "102" || ["autorizado", "inutilizado", "inutilizada"].includes(providerStatus))
    return "authorized";
  if (["erro_autorizacao", "rejeitado", "rejeitada", "erro"].includes(providerStatus))
    return "rejected";
  return "outcome_unknown";
}

async function focusContext(): Promise<Context> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  if (await getPlatformRole(user) !== "platform_admin")
    throw new JvgBackendError("A inutilização em homologação está restrita à administração da plataforma durante o piloto JVG.", 403);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  if (account.role === "viewer") throw new JvgBackendError("Seu perfil não pode inutilizar numeração fiscal.", 403);
  const pilotCompanyId = focusRuntimeEnv("JVG_FOCUS_PILOT_COMPANY_ID");
  if (!pilotCompanyId) throw new JvgBackendError("A empresa piloto Focus não está configurada no servidor.", 409);
  if (pilotCompanyId !== account.company_id)
    throw new JvgBackendError("A inutilização está habilitada somente para a empresa piloto JVG.", 403);
  const token = focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN");
  if (!token) throw new JvgBackendError("Configure a credencial Focus de homologação no servidor antes da inutilização.", 409);
  const company = await getCompany(account);
  const cnpj = String(company?.cnpj || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!company || !/^\d{14}$/.test(cnpj))
    throw new JvgBackendError("O CNPJ numérico da empresa emitente não está disponível para a Focus.", 409);
  return { userId: user.userId, account, token, cnpj };
}

async function updateAttempt(context: Context, id: string, values: Json): Promise<void> {
  const rows = await dbRequest<Row[]>(
    "/rest/v1/jvg_fiscal_number_inutilizations?" + scope(context.account) +
    "&id=" + filterEq(id) + "&select=id",
    { method: "PATCH", body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }) },
  );
  if (!rows.length) throw new JvgBackendError("A consulta à Focus terminou, mas não foi possível registrar o retorno.", 502);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const context = await focusContext();
    const raw = await request.text();
    if (raw.length > 6000) throw new JvgBackendError("Solicitação muito grande.", 413);
    let body: Json;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON");
      body = parsed as Json;
    } catch { throw new JvgBackendError("Envie um formulário válido.", 400); }

    const requestId = text(body.requestId);
    const rawSeries = text(body.series);
    const justification = text(body.justification);
    const numberStart = Number(body.numberStart);
    const numberEnd = Number(body.numberEnd);
    if (!uuidPattern.test(requestId)) throw new JvgBackendError("Identificador da solicitação inválido.", 400);
    if (!/^[0-9]{1,3}$/.test(rawSeries) || Number(rawSeries) < 1)
      throw new JvgBackendError("Informe a série numérica da NF-e, de 1 a 999.", 400);
    const series = String(Number(rawSeries));
    if (!Number.isSafeInteger(numberStart) || !Number.isSafeInteger(numberEnd) ||
        numberStart < 1 || numberEnd < numberStart || numberEnd > 999999999)
      throw new JvgBackendError("Informe uma faixa válida, com números de 1 a 999.999.999.", 400);
    if (justification.length < 15 || justification.length > 255)
      throw new JvgBackendError("A justificativa precisa ter de 15 a 255 caracteres.", 400);
    if (body.confirmHomologation !== true)
      throw new JvgBackendError("Confirme que esta ação será feita somente em homologação.", 400);

    const duplicateRequest = await dbRequest<Row[]>(
      "/rest/v1/jvg_fiscal_number_inutilizations?" + scope(context.account) +
      "&idempotency_key=" + filterEq(requestId) +
      "&select=id,status,protocol,provider_response&limit=1",
    );
    if (duplicateRequest[0]) {
      const prior = duplicateRequest[0];
      return apiJson({
        ok: true, reused: true, status: prior.status,
        protocol: prior.protocol || null, providerResponse: prior.provider_response || {},
      });
    }

    const existingDocuments = await dbRequest<Row[]>(
      "/rest/v1/jvg_fiscal_documents?" + scope(context.account) +
      "&document_type=eq.nfe&environment=eq.homologacao&series=" + filterEq(series) +
      "&document_number=gte." + numberStart + "&document_number=lte." + numberEnd +
      "&select=id,document_number,status&limit=1",
    );
    if (existingDocuments.length)
      throw new JvgBackendError("A faixa contém NF-e de homologação já registrada no ERP. Confira a série e os números antes de inutilizar.", 409);

    const overlapping = await dbRequest<Row[]>(
      "/rest/v1/jvg_fiscal_number_inutilizations?" + scope(context.account) +
      "&environment=eq.homologacao&series=" + filterEq(series) +
      "&number_start=lte." + numberEnd + "&number_end=gte." + numberStart +
      "&status=in.(processing,authorized,outcome_unknown)&select=id,status,number_start,number_end&limit=1",
    );
    if (overlapping.length)
      throw new JvgBackendError("Já existe uma tentativa ativa, autorizada ou sem retorno conhecido que cruza esta faixa. Consulte a Focus antes de tentar novamente.", 409);

    const inserted = await dbRequest<Row[]>("/rest/v1/jvg_fiscal_number_inutilizations", {
      method: "POST",
      body: JSON.stringify({
        tenant_id: context.account.tenant_id, company_id: context.account.company_id,
        environment: "homologacao", model: "55", series,
        number_start: numberStart, number_end: numberEnd, justification,
        idempotency_key: requestId, status: "processing", created_by: context.userId,
        provider_response: { phase: "request_started", environment: "homologacao" },
      }),
    });
    const id = String(inserted[0]?.id || "");
    if (!uuidPattern.test(id)) throw new JvgBackendError("Não foi possível registrar a tentativa de inutilização.", 502);

    try {
      const response = await inutilizeFocusNfeNumberHomologacao(context.token, {
        cnpj: context.cnpj, serie: series, numero_inicial: numberStart,
        numero_final: numberEnd, justificativa: justification,
      });
      const providerResponse = safeFocusResponse(response.body);
      const status = outcome(response.body);
      await updateAttempt(context, id, {
        status, protocol: scalarText(response.body.protocolo || response.body.numero_protocolo) || null,
        provider_response: {
          ...providerResponse, phase: status, environment: "homologacao",
          httpStatus: response.httpStatus, observedAt: new Date().toISOString(),
        },
      });
      return apiJson({
        ok: true, status, protocol: scalarText(response.body.protocolo || response.body.numero_protocolo) || null,
        providerResponse, httpStatus: response.httpStatus,
      }, status === "authorized" ? 200 : 202);
    } catch (error) {
      const isHttpError = error instanceof FocusNfeApiError;
      const status = isHttpError && error.httpStatus < 500 ? "rejected" : "outcome_unknown";
      const providerResponse = isHttpError ? safeFocusResponse(error.body) : {};
      await updateAttempt(context, id, {
        status,
        provider_response: {
          ...providerResponse, phase: status, environment: "homologacao",
          ...(isHttpError ? { httpStatus: error.httpStatus } : {}),
          observedAt: new Date().toISOString(),
        },
      });
      if (status === "outcome_unknown")
        return apiJson({
          ok: false, status,
          error: "A Focus não confirmou o resultado. Não repita essa faixa até consultar a inutilização no painel Focus.",
          providerResponse,
        }, 202);
      return apiJson({
        ok: false, status,
        error: "A Focus recusou a inutilização. Confira o motivo retornado e os dados informados.",
        providerResponse,
      }, 422);
    }
  } catch (error) { return safeError(error); }
}
