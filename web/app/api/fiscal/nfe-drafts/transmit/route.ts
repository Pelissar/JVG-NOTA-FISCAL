import { getJvgUser } from "../../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount,
  isSameOrigin, JvgBackendError, safeError, type SiteAccount,
} from "../../../../../lib/jvg-backend";
import {
  emitFocusNfeHomologacao, FocusNfeApiError, focusReferenceForFiscalDocument,
  queryFocusNfeHomologacao, cancelFocusNfeHomologacao,
} from "../../../../../lib/focus/client";
import { focusRuntimeEnv } from "../../../../../lib/focus/runtime-env";
import { homologationToken, licenseView } from "../../../../../lib/licensing";
import { reviewNfeHomologationGate } from "../../../../../lib/fiscal/nfe-homologation-gate";
import { isOfficialCfopCode } from "../../../../../lib/fiscal/cfop";

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
type DbRow = Record<string, unknown>;
type FocusContext = { userId: string; account: SiteAccount; token: string; company: DbRow };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const focusSafeFields = [
  "status", "status_sefaz", "mensagem_sefaz", "ref", "chave_nfe",
  "numero", "serie", "protocolo", "numero_protocolo", "codigo_status", "erro", "mensagem",
  "caminho_xml_nota_fiscal", "caminho_danfe", "eventos", "erros", "errors", "error", "detalhe", "details",
];

const obj = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const scalarText = (value: unknown): string => typeof value === "string" ? value.trim() :
  typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Json).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function projection(value: Json, fields: string[]): Json {
  return Object.fromEntries(fields.map(field => [field, value[field] ?? null]));
}

function scope(account: SiteAccount): string {
  return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
}

function safeFocusBody(body: Json): Json {
  const result: Json = {};
  for (const key of focusSafeFields) {
    const value = body[key];
    if ((key === "eventos" || key === "erros" || key === "errors") && Array.isArray(value)) {
      const entries: unknown[] = [];
      for (const rawEntry of value.slice(0, key === "eventos" ? 50 : 20)) {
        if (typeof rawEntry === "string") {
          if (rawEntry.length <= 1000) entries.push(rawEntry);
          continue;
        }
        const event = obj(rawEntry);
        const safeEvent = Object.fromEntries(Object.entries(event).filter(([name, item]) =>
          /^[a-zA-Z0-9_]{1,64}$/.test(name) &&
          ((typeof item === "string" && item.length <= 2000) ||
            (typeof item === "number" && Number.isFinite(item)) || typeof item === "boolean")));
        if (Object.keys(safeEvent).length) entries.push(safeEvent);
      }
      if (entries.length) result[key] = entries;
      continue;
    }
    if ((typeof value === "string" && value.length <= 2000) ||
        (typeof value === "number" && Number.isFinite(value))) result[key] = value;
  }
  return result;
}

async function createFocusAttemptEvent(
  context: FocusContext,
  documentId: string,
  action: "transmission" | "consultation",
  reference: string,
  requestedAt: string,
): Promise<string> {
  const rows = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_fiscal_events?select=id", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: context.account.tenant_id,
      company_id: context.account.company_id,
      fiscal_document_id: documentId,
      event_type: "status_update",
      status: `${action}_started`,
      event_payload: {
        provider: "focus_nfe", action, phase: "request_started", environment: "homologacao",
        reference, requestedAt, requestedBy: context.userId,
      },
    }),
  });
  const id = rows[0]?.id;
  if (!id || !uuidPattern.test(id)) throw new JvgBackendError("Não foi possível registrar a tentativa fiscal no histórico.", 503);
  return id;
}

async function finishFocusAttemptEvent(
  context: FocusContext,
  eventId: string,
  values: { documentId: string; action: "transmission" | "consultation"; reference: string; requestedAt: string;
    status: string; response?: Json; httpStatus?: number; error?: string; eventType?: "status_update" | "error" | "cancellation"; reason?: string },
): Promise<void> {
  const response = values.response ? safeFocusBody(values.response) : undefined;
  const protocol = values.response
    ? scalarText(values.response.numero_protocolo ?? values.response.protocolo).slice(0, 80)
    : "";
  const rows = await dbRequest<Array<{ id: string }>>(
    `/rest/v1/jvg_fiscal_events?${scope(context.account)}&id=${filterEq(eventId)}&fiscal_document_id=${filterEq(values.documentId)}&select=id`,
    { method: "PATCH", body: JSON.stringify({
      event_type: values.eventType || "status_update",
      status: values.status.slice(0, 40),
      protocol: protocol || null,
      event_payload: {
        provider: "focus_nfe", action: values.action, phase: values.status,
        environment: "homologacao", reference: values.reference,
        requestedAt: values.requestedAt, requestedBy: context.userId, observedAt: new Date().toISOString(),
        ...(response ? { response } : {}),
        ...(typeof values.httpStatus === "number" ? { httpStatus: values.httpStatus } : {}),
        ...(values.error ? { error: values.error.slice(0, 500) } : {}),
        ...(values.reason ? { justificativa: values.reason.slice(0, 255) } : {}),
      },
    }) },
  );
  if (!rows.length) throw new JvgBackendError("A tentativa foi enviada, mas não foi possível atualizar seu evento no histórico.", 502);
}

function internalStatus(providerStatus: unknown, current = "processing"): string {
  const status = text(providerStatus).toLowerCase();
  let observed = current;
  if (status === "autorizado") observed = "authorized";
  else if (["erro_autorizacao", "rejeitado", "erro"].includes(status)) observed = "rejected";
  else if (["denegado", "denegada"].includes(status)) observed = "denied";
  else if (["cancelado", "cancelada"].includes(status)) observed = "cancelled";
  else if (status.includes("processando") || status.includes("aguardando")) observed = "processing";

  // Consulta atrasada não pode rebaixar um resultado terminal já confirmado.
  if (current === "cancelled" || current === "denied" || current === "rejected") return current;
  if (current === "authorized") return observed === "cancelled" ? "cancelled" : "authorized";
  return observed;
}

async function focusContext(): Promise<FocusContext> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  if (account.role === "viewer") throw new JvgBackendError("Seu perfil não pode transmitir documentos fiscais.", 403);

  const siteToken = focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN");
  const license = await licenseView(account);
  if (license.schemaReady && license.issues.length) throw new JvgBackendError(license.issues[0], 403);
  const token = await homologationToken(account, siteToken);
  const company = await getCompany(account);
  if (!company) throw new JvgBackendError("Empresa emitente não encontrada.", 404);
  if (company.tax_regime_confirmation_available !== true || company.tax_regime_confirmed !== true || company.tax_regime !== "simples_nacional")
    throw new JvgBackendError("Confirme o regime tributário do emitente com a contabilidade antes do envio.", 409);
  if (company.fiscal_missing.length)
    throw new JvgBackendError("Complete os dados fiscais obrigatórios do emitente antes do envio.", 409);
  return { userId: user.userId, account, token, company };
}

async function readDocument(account: SiteAccount, id: string): Promise<DbRow | null> {
  const rows = await dbRequest<DbRow[]>(
    `/rest/v1/jvg_fiscal_documents?${scope(account)}&id=${filterEq(id)}&document_type=eq.nfe&environment=eq.homologacao&select=id,status,focus_reference,fiscal_payload,provider_response,access_key,series,document_number,issued_at,authorized_at&limit=1`,
  );
  return rows[0] ?? null;
}

async function patchDocument(account: SiteAccount, id: string, expectedStatus: string, values: Json): Promise<DbRow | null> {
  const rows = await dbRequest<DbRow[]>(
    `/rest/v1/jvg_fiscal_documents?${scope(account)}&id=${filterEq(id)}&document_type=eq.nfe&environment=eq.homologacao&status=${filterEq(expectedStatus)}&select=id,status,focus_reference`,
    { method: "PATCH", body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }) },
  );
  return rows[0] ?? null;
}

async function currentSnapshotIssues(context: FocusContext, payload: Json): Promise<string[]> {
  const { account, company } = context;
  const issues: string[] = [];
  const add = (message: string) => { if (!issues.includes(message)) issues.push(message); };
  const issuer = obj(payload.issuer);
  const address = obj(company.address);
  const issuerFields = ["companyId", "name", "legalName", "tradeName", "cnpj", "stateRegistration",
    "municipalRegistration", "cnae", "fiscalEmail", "fiscalPhone", "address", "state", "taxRegime", "taxRegimeConfirmed"];
  const currentIssuer: Json = {
    companyId: account.company_id,
    name: company.trade_name || company.legal_name,
    legalName: company.legal_name ?? null, tradeName: company.trade_name ?? null,
    cnpj: company.cnpj ?? null, stateRegistration: company.state_registration ?? null,
    municipalRegistration: company.municipal_registration ?? null, cnae: company.cnae ?? null,
    fiscalEmail: company.fiscal_email ?? null, fiscalPhone: company.fiscal_phone ?? null,
    address: company.address ?? null, state: address.state ?? null,
    taxRegime: company.tax_regime ?? null, taxRegimeConfirmed: company.tax_regime_confirmed === true,
  };
  if (stableJson(projection(issuer, issuerFields)) !== stableJson(projection(currentIssuer, issuerFields)))
    add("Os dados fiscais do emitente mudaram. Reinicie a preparação da NF-e para revisar o cadastro atual.");

  const recipient = obj(payload.recipient);
  const recipientId = text(recipient.id);
  if (!uuidPattern.test(recipientId)) {
    add("Destinatário sem identificador válido no snapshot fiscal.");
    return issues;
  }
  const recipientRows = await dbRequest<DbRow[]>(
    `/rest/v1/jvg_parties?${scope(account)}&id=${filterEq(recipientId)}&is_customer=eq.true&active=eq.true&select=id,display_name,legal_name,document_type,document_number,state_registration,municipal_registration,email,phone,address&limit=1`,
  );
  const currentRecipient = recipientRows[0];
  if (!currentRecipient) add("O destinatário não pertence mais à empresa ou está inativo.");
  else {
    const recipientAddress = obj(currentRecipient.address);
    const recipientFields = ["id", "name", "legalName", "documentType", "documentNumber", "stateRegistration",
      "municipalRegistration", "email", "phone", "address", "state"];
    const currentRecipientSnapshot: Json = {
      id: currentRecipient.id, name: currentRecipient.display_name ?? null, legalName: currentRecipient.legal_name ?? null,
      documentType: currentRecipient.document_type ?? null, documentNumber: currentRecipient.document_number ?? null,
      stateRegistration: currentRecipient.state_registration ?? null, municipalRegistration: currentRecipient.municipal_registration ?? null,
      email: currentRecipient.email ?? null, phone: currentRecipient.phone ?? null,
      address: currentRecipient.address ?? null, state: recipientAddress.state ?? null,
    };
    if (stableJson(projection(recipient, recipientFields)) !== stableJson(projection(currentRecipientSnapshot, recipientFields)))
      add("Os dados do destinatário mudaram. Reinicie a preparação da NF-e para revisar o cadastro atual.");
  }

  const items = Array.isArray(payload.items) ? payload.items.map(obj) : [];
  const productIds = [...new Set(items.map(item => text(item.productId)))];
  if (!productIds.length || productIds.some(id => !uuidPattern.test(id))) {
    add("Um ou mais produtos da NF-e não têm identificador válido.");
    return issues;
  }
  const productRows = await dbRequest<DbRow[]>(
    `/rest/v1/jvg_products?${scope(account)}&id=in.(${productIds.join(",")})&active=eq.true&select=id,sku,name,unit,ncm,cest,gtin,origin`,
  );
  const products = new Map(productRows.map(product => [String(product.id), product]));
  if (products.size !== productIds.length) add("Um ou mais produtos da NF-e estão inativos ou não pertencem à empresa.");

  items.forEach((item, index) => {
    const product = products.get(text(item.productId));
    if (!product) return;
    const currentProduct = {
      sku: product.sku ?? null, description: product.name ?? null, unit: product.unit ?? null,
      ncm: product.ncm ?? null, cest: product.cest ?? null, gtin: product.gtin ?? null, origin: product.origin ?? null,
    };
    const savedProductSnapshot = obj(item.productSnapshot);
    const snapshotProduct = projection(
      Object.keys(savedProductSnapshot).length ? savedProductSnapshot : item,
      ["sku", "description", "unit", "ncm", "cest", "gtin", "origin"],
    );
    if (stableJson(snapshotProduct) !== stableJson(currentProduct))
      add(`Item ${index + 1}: os dados do produto mudaram desde que a NF-e foi preparada.`);
    if (!isOfficialCfopCode(text(item.cfop)))
      add(`Item ${index + 1}: informe um CFOP de saída existente no catálogo oficial diretamente no item da NF-e.`);
  });

  const sourceDocument = obj(payload.sourceDocument || payload.sourceOrder);
  const sourceId = text(sourceDocument.id);
  if (sourceId) {
    const sourceType = sourceDocument.type === "quote" || sourceDocument.type === "service_order"
      ? sourceDocument.type : "order";
    if (!uuidPattern.test(sourceId)) add("O documento de origem tem identificador inválido.");
    else {
      const sourcePath = sourceType === "order"
        ? `/rest/v1/jvg_orders?${scope(account)}&id=${filterEq(sourceId)}&select=id,customer_id,status,total,items&limit=1`
        : sourceType === "quote"
          ? `/rest/v1/jvg_quotes?${scope(account)}&id=${filterEq(sourceId)}&select=id,customer_id,status,total,items&limit=1`
          : `/rest/v1/jvg_service_orders?${scope(account)}&id=${filterEq(sourceId)}&select=id,customer_id,status&limit=1`;
      const sourceRows = await dbRequest<DbRow[]>(sourcePath);
      const sourceRecord = sourceRows[0];
      const allowedStatuses = sourceType === "quote" ? ["accepted"] : sourceType === "order"
        ? ["open", "fulfilled"] : ["open", "diagnosis", "awaiting_approval", "awaiting_parts", "in_progress", "ready", "delivered"];
      if (!sourceRecord || !allowedStatuses.includes(String(sourceRecord.status))) {
        add("O documento de origem não está mais disponível para faturamento.");
      } else if (String(sourceRecord.customer_id || "") !== recipientId) {
        add("O destinatário da NF-e não corresponde ao documento de origem.");
      } else if (sourceType !== "service_order") {
        const sourceItems = Array.isArray(sourceRecord.items) ? sourceRecord.items.map(obj) : [];
        const goodsItems = sourceItems.filter(item => typeof item.productId === "string" && !item.serviceId);
        if (!goodsItems.length || goodsItems.length !== items.length) {
          add("A NF-e deve conter somente os produtos da origem. Serviços não entram em NF-e.");
        } else {
          let sourceGoodsTotalCents = 0;
          goodsItems.forEach((sourceItem, index) => {
            const quantityMilli = Math.round(Number(sourceItem.quantity) * 1000);
            const unitPriceCents = Math.round(Number(sourceItem.unitPrice) * 100);
            const lineTotalCents = Math.round(quantityMilli * unitPriceCents / 1000);
            if (String(sourceItem.productId || "") !== text(items[index].productId) ||
                quantityMilli !== Math.round(Number(items[index].quantity) * 1000) ||
                unitPriceCents !== Number(items[index].unitPriceCents))
              add(`Item ${index + 1}: produto, quantidade ou preço do documento de origem mudou.`);
            sourceGoodsTotalCents += lineTotalCents;
          });
          if (!Number.isSafeInteger(sourceGoodsTotalCents) || sourceGoodsTotalCents !== Number(payload.totalCents))
            add("O total da NF-e precisa corresponder apenas aos produtos da origem; serviços são excluídos.");
        }
      }
    }
  }
  return issues;
}

function documentResponsePatch(
  body: Json,
  currentStatus: string,
  reference: string,
  userId: string,
  previousProviderResponse?: unknown,
): Json {
  const safeBody = safeFocusBody(body);
  const previousResponse = obj(obj(previousProviderResponse).response);
  const nextStatus = internalStatus(body.status, currentStatus);
  const patch: Json = {
    status: nextStatus,
    provider_response: {
      operation: "focus_nfe",
      phase: "response_received",
      observedAt: new Date().toISOString(),
      observedBy: userId,
      reference,
      response: { ...previousResponse, ...safeBody },
    },
  };
  const accessKey = text(body.chave_nfe).replace(/^NFe/i, "");
  if (/^\d{44}$/.test(accessKey)) patch.access_key = accessKey;
  if (/^\d{1,3}$/.test(scalarText(body.serie))) patch.series = scalarText(body.serie);
  if (/^\d{1,15}$/.test(scalarText(body.numero))) patch.document_number = scalarText(body.numero);
  if (nextStatus === "authorized") patch.authorized_at = scalarText(body.data_autorizacao) || new Date().toISOString();
  return patch;
}

async function emit(context: FocusContext, id: string, body: Json): Promise<Response> {
  if (body.confirmHomologation !== true)
    throw new JvgBackendError("Confirme que você revisou os dados e que este envio será feito somente em homologação.", 400);
  if (!uuidPattern.test(id)) throw new JvgBackendError("Identificador do documento inválido.", 400);

  const document = await readDocument(context.account, id);
  if (!document) throw new JvgBackendError("Documento NF-e não encontrado nesta empresa.", 404);
  if (document.status !== "draft") throw new JvgBackendError("Esta NF-e já saiu da etapa de preparação. Não envie novamente; consulte o status Focus.", 409);
  const payload = obj(document.fiscal_payload);
  if (payload.schemaVersion !== 7)
    throw new JvgBackendError("Esta NF-e usa uma estrutura fiscal anterior. Reinicie a preparação para revisar os campos atuais.", 409);

  const gate = reviewNfeHomologationGate(payload);
  const issues = [...gate.issues];
  issues.push(...await currentSnapshotIssues(context, payload));
  if (!gate.ready || issues.length) return apiJson({ ok: false, status: "blocked", issues: [...new Set(issues)].slice(0, 100) }, 409);

  const reference = text(document.focus_reference) || focusReferenceForFiscalDocument(id);
  if (!/^[A-Za-z0-9]{1,50}$/.test(reference)) throw new JvgBackendError("Referência Focus inválida.", 409);
  const startedAt = new Date().toISOString();
  const reserved = await patchDocument(context.account, id, "draft", {
    status: "processing", focus_reference: reference,
    issued_at: text(payload.issueAt) || null,
    provider_response: { operation: "focus_nfe", phase: "request_started", requestedAt: startedAt,
      requestedBy: context.userId, environment: "homologacao", reference },
  });
  if (!reserved) throw new JvgBackendError("Outro processo atualizou esta NF-e. Recarregue antes de tentar novamente.", 409);

  let attemptEventId: string;
  try {
    attemptEventId = await createFocusAttemptEvent(context, id, "transmission", reference, startedAt);
  } catch {
    await patchDocument(context.account, id, "processing", {
      status: "draft",
      provider_response: { operation: "focus_nfe", phase: "audit_log_failed", requestedAt: startedAt,
        requestedBy: context.userId, environment: "homologacao", reference },
    });
    throw new JvgBackendError("A tentativa não foi enviada: não foi possível registrá-la no histórico fiscal.", 503);
  }

  try {
    const result = await emitFocusNfeHomologacao(context.token, reference, gate.focusRequestPreview);
    const providerReference = text(result.body.ref);
    if (providerReference && providerReference !== reference) {
      const responsePatch = documentResponsePatch(result.body, "processing", reference, context.userId, document.provider_response);
      await patchDocument(context.account, id, "processing", responsePatch);
      await finishFocusAttemptEvent(context, attemptEventId, { documentId: id, action: "transmission", reference,
        requestedAt: startedAt, status: "reference_mismatch", response: result.body, eventType: "error" });
      return apiJson({ ok: false, status: "processing", reference, needsReconciliation: true,
        message: "A Focus retornou uma referência diferente. Não reenvie; consulte o documento pela referência salva." }, 202);
    }
    const patch = documentResponsePatch(result.body, "processing", reference, context.userId, document.provider_response);
    await patchDocument(context.account, id, "processing", patch);
    const status = String(patch.status);
    await finishFocusAttemptEvent(context, attemptEventId, { documentId: id, action: "transmission", reference,
      requestedAt: startedAt, status, response: result.body,
      eventType: ["rejected", "denied"].includes(status) ? "error" : "status_update" });
    return apiJson({ ok: true, status, reference, accessKey: patch.access_key || null,
      number: patch.document_number || null, series: patch.series || null,
      needsReconciliation: status === "processing" }, status === "processing" ? 202 : 200);
  } catch (error) {
    if (error instanceof FocusNfeApiError) {
      const httpStatus = error.httpStatus;
      const retryableNoAcceptance = [401, 403].includes(httpStatus);
      const providerRejected = [400, 422].includes(httpStatus);
      const nextStatus = retryableNoAcceptance ? "draft" : providerRejected ? "rejected" : "processing";
      const safeBody = safeFocusBody(error.body);
      await patchDocument(context.account, id, "processing", {
        status: nextStatus,
        provider_response: { operation: "focus_nfe", phase: providerRejected ? "rejected" : "http_error",
          requestedAt: startedAt, observedAt: new Date().toISOString(), observedBy: context.userId,
          reference, httpStatus, response: { ...obj(obj(document.provider_response).response), ...safeBody } },
      });
      await finishFocusAttemptEvent(context, attemptEventId, { documentId: id, action: "transmission", reference,
        requestedAt: startedAt, status: providerRejected ? "provider_rejected" : "http_error",
        response: error.body, httpStatus, eventType: "error" });
      return apiJson({ ok: false, status: nextStatus, reference,
        providerResponse: { ...obj(obj(document.provider_response).response), ...safeBody },
        needsReconciliation: nextStatus === "processing",
        message: providerRejected ? "A Focus rejeitou os dados. Corrija as pendências e reinicie a emissão." :
          retryableNoAcceptance ? "A Focus não aceitou a solicitação; confira a conexão e tente novamente usando a mesma referência." :
          "A resposta da Focus não permite confirmar o resultado. Consulte a referência salva antes de qualquer novo envio." },
      providerRejected ? 422 : 502);
    }
    // Timeout ou falha de rede pode ocorrer depois que a Focus recebeu a nota.
    // Mantém status processing e referência para reconciliar sem POST duplicado.
    await patchDocument(context.account, id, "processing", {
      provider_response: { operation: "focus_nfe", phase: "outcome_unknown", requestedAt: startedAt,
        observedAt: new Date().toISOString(), observedBy: context.userId, reference,
        response: obj(obj(document.provider_response).response) },
    });
    await finishFocusAttemptEvent(context, attemptEventId, { documentId: id, action: "transmission", reference,
      requestedAt: startedAt, status: "outcome_unknown", eventType: "error" });
    return apiJson({ ok: false, status: "processing", reference, needsReconciliation: true,
      message: "Não foi possível confirmar a resposta da Focus. Use Consultar Focus; não reenvie esta NF-e." }, 202);
  }
}

async function reconcile(context: FocusContext, id: string): Promise<Response> {
  if (!uuidPattern.test(id)) throw new JvgBackendError("Identificador do documento inválido.", 400);
  const document = await readDocument(context.account, id);
  if (!document) throw new JvgBackendError("Documento NF-e não encontrado nesta empresa.", 404);
  const reference = text(document.focus_reference);
  if (!reference) throw new JvgBackendError("Este documento ainda não tem referência Focus para consulta.", 409);
  if (!["processing", "queued", "authorized", "rejected", "denied", "cancelled"].includes(String(document.status)))
    throw new JvgBackendError("Consulte a Focus somente depois que houver uma solicitação de emissão.", 409);
  const requestedAt = new Date().toISOString();
  const attemptEventId = await createFocusAttemptEvent(context, id, "consultation", reference, requestedAt);
  try {
    const result = await queryFocusNfeHomologacao(context.token, reference, true);
    const providerReference = text(result.body.ref);
    if (providerReference && providerReference !== reference)
      throw new JvgBackendError("A resposta da Focus pertence a outra referência.", 502);
    const patch = documentResponsePatch(result.body, String(document.status), reference, context.userId, document.provider_response);
    await patchDocument(context.account, id, String(document.status), patch);
    const status = String(patch.status);
    await finishFocusAttemptEvent(context, attemptEventId, { documentId: id, action: "consultation", reference,
      requestedAt, status, response: result.body,
      eventType: ["rejected", "denied", "cancelled"].includes(status) ? "error" : "status_update" });
    return apiJson({ ok: true, status: patch.status, reference,
      accessKey: patch.access_key || document.access_key || null,
      number: patch.document_number || document.document_number || null,
      series: patch.series || document.series || null,
      providerResponse: { ...obj(obj(document.provider_response).response), ...safeFocusBody(result.body) } });
  } catch (error) {
    if (error instanceof FocusNfeApiError && error.httpStatus === 404) {
      await finishFocusAttemptEvent(context, attemptEventId, { documentId: id, action: "consultation", reference,
        requestedAt, status: "not_found_yet", response: error.body, httpStatus: error.httpStatus });
      return apiJson({ ok: false, status: document.status, reference, needsReconciliation: true,
        message: "A Focus ainda não localizou esta referência. O status foi preservado; não reenvie automaticamente." }, 202);
    }
    await finishFocusAttemptEvent(context, attemptEventId, { documentId: id, action: "consultation", reference,
      requestedAt, status: error instanceof FocusNfeApiError ? "http_error" : "consultation_failed",
      response: error instanceof FocusNfeApiError ? error.body : undefined,
      httpStatus: error instanceof FocusNfeApiError ? error.httpStatus : undefined,
      error: error instanceof FocusNfeApiError
        ? "A Focus retornou erro HTTP; o status do documento foi preservado."
        : "Falha inesperada na consulta; confira o status antes de qualquer nova ação.",
      eventType: "error" });
    throw error;
  }
}

async function cancelAuthorized(context: FocusContext, id: string, body: Json): Promise<Response> {
  if (!uuidPattern.test(id)) throw new JvgBackendError("Identificador do documento inválido.", 400);
  const reason = text(body.justificativa).replace(/\s+/g, " ");
  if (reason.length < 15 || reason.length > 255)
    throw new JvgBackendError("A justificativa do cancelamento precisa ter entre 15 e 255 caracteres.", 400);
  const document = await readDocument(context.account, id);
  if (!document) throw new JvgBackendError("Documento NF-e não encontrado nesta empresa.", 404);
  if (document.status !== "authorized")
    throw new JvgBackendError("Só uma NF-e autorizada em homologação pode ser cancelada por aqui.", 409);
  const reference = text(document.focus_reference);
  if (!reference) throw new JvgBackendError("Este documento não tem referência Focus para cancelar.", 409);
  const requestedAt = new Date().toISOString();
  const attemptEventId = await createFocusAttemptEvent(context, id, "consultation", reference, requestedAt);
  try {
    const result = await cancelFocusNfeHomologacao(context.token, reference, reason);
    const patch = documentResponsePatch(result.body, "authorized", reference, context.userId, document.provider_response);
    await patchDocument(context.account, id, "authorized", patch);
    const status = String(patch.status);
    await finishFocusAttemptEvent(context, attemptEventId, { documentId: id, action: "consultation", reference,
      requestedAt, status, response: result.body, eventType: status === "cancelled" ? "cancellation" : "status_update", reason });
    if (status !== "cancelled") {
      return apiJson({ ok: false, status, reference, needsReconciliation: true,
        message: "A Focus recebeu o pedido, mas ainda não confirmou o cancelamento. Consulte o status antes de tentar de novo." }, 202);
    }
    return apiJson({ ok: true, status: "cancelled", reference, message: "NF-e cancelada na Focus em homologação. Sem valor fiscal." });
  } catch (error) {
    await finishFocusAttemptEvent(context, attemptEventId, { documentId: id, action: "consultation", reference,
      requestedAt, status: "cancel_failed",
      response: error instanceof FocusNfeApiError ? error.body : undefined,
      httpStatus: error instanceof FocusNfeApiError ? error.httpStatus : undefined,
      error: "A Focus não confirmou o cancelamento. A nota autorizada foi preservada.",
      eventType: "error", reason });
    if (error instanceof FocusNfeApiError) {
      return apiJson({ ok: false, status: "authorized", reference,
        message: "A Focus não cancelou esta NF-e. Confira a justificativa e o prazo da SEFAZ. A nota continua autorizada." }, 422);
    }
    throw error;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const context = await focusContext();
    const raw = await request.text();
    if (raw.length > 8_000) throw new JvgBackendError("Solicitação muito grande.", 413);
    let data: Json;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      data = parsed as Json;
    } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    const id = text(data.id);
    if (data.action === "reconcile") return await reconcile(context, id);
    if (data.action === "cancel") return await cancelAuthorized(context, id, data);
    if (data.action !== "emit") throw new JvgBackendError("Ação fiscal inválida.", 400);
    return await emit(context, id, data);
  } catch (error) {
    return safeError(error);
  }
}
