import { getJvgUser } from "../../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getPlatformRole, getSiteAccount,
  isSameOrigin, JvgBackendError, safeError, type SiteAccount,
} from "../../../../../lib/jvg-backend";
import {
  emitFocusNfeHomologacao, FocusNfeApiError, focusReferenceForFiscalDocument,
  queryFocusNfeHomologacao,
} from "../../../../../lib/focus/client";
import { focusRuntimeEnv } from "../../../../../lib/focus/runtime-env";
import { reviewApprovedTaxProfile, reviewNfeHomologationGate } from "../../../../../lib/fiscal/nfe-homologation-gate";
import { reviewNfeOperation, reviewProfileConsistency } from "../../../../../lib/fiscal/operation-review";

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;
type DbRow = Record<string, unknown>;
type FocusContext = { userId: string; account: SiteAccount; token: string; company: DbRow };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const focusSafeFields = [
  "status", "status_sefaz", "mensagem_sefaz", "ref", "chave_nfe",
  "numero", "serie", "protocolo", "codigo_status", "erro", "mensagem",
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
    if ((typeof value === "string" && value.length <= 2000) ||
        (typeof value === "number" && Number.isFinite(value))) result[key] = value;
  }
  return result;
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
  if (await getPlatformRole(user) !== "platform_admin")
    throw new JvgBackendError("O envio de NF-e em homologação está restrito à administração da plataforma durante o piloto JVG.", 403);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  if (account.role === "viewer") throw new JvgBackendError("Seu perfil não pode transmitir documentos fiscais.", 403);

  const pilotCompanyId = focusRuntimeEnv("JVG_FOCUS_PILOT_COMPANY_ID");
  if (!pilotCompanyId) throw new JvgBackendError("A empresa piloto da Focus não está configurada no servidor.", 409);
  if (pilotCompanyId !== account.company_id)
    throw new JvgBackendError("A transmissão em homologação está habilitada somente para a empresa piloto JVG.", 403);
  const token = focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN");
  if (!token) throw new JvgBackendError("Configure a credencial Focus de homologação no servidor antes do envio.", 409);
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
    add("Os dados fiscais do emitente mudaram após a criação do rascunho. Crie um novo rascunho para revisar o snapshot atual.");

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
      add("Os dados do destinatário mudaram após a criação do rascunho. Crie um novo rascunho para revisar o snapshot atual.");
  }

  const items = Array.isArray(payload.items) ? payload.items.map(obj) : [];
  const productIds = [...new Set(items.map(item => text(item.productId)))];
  if (!productIds.length || productIds.some(id => !uuidPattern.test(id))) {
    add("Um ou mais produtos do rascunho não têm identificador válido.");
    return issues;
  }
  const productRows = await dbRequest<DbRow[]>(
    `/rest/v1/jvg_products?${scope(account)}&id=in.(${productIds.join(",")})&active=eq.true&select=id,sku,name,unit,ncm,cest,gtin,origin,tax_profile_id`,
  );
  const products = new Map(productRows.map(product => [String(product.id), product]));
  if (products.size !== productIds.length) add("Um ou mais produtos do rascunho estão inativos ou não pertencem à empresa.");

  const profileIds = [...new Set(productRows.map(product => text(product.tax_profile_id)).filter(Boolean))];
  if (profileIds.some(id => !uuidPattern.test(id))) add("Um produto está vinculado a um perfil tributário inválido.");
  const safeProfileIds = profileIds.filter(id => uuidPattern.test(id));
  const profileRows = safeProfileIds.length ? await dbRequest<DbRow[]>(
    `/rest/v1/jvg_tax_profiles?${scope(account)}&id=in.(${safeProfileIds.join(",")})&document_type=eq.nfe&select=id,name,rules,review_status,reviewed_by`,
  ) : [];
  const profiles = new Map(profileRows.map(profile => [String(profile.id), profile]));
  const currentIssuerUf = text(address.state).toUpperCase();
  const recipientUf = text(obj(currentRecipient?.address).state).toUpperCase();

  items.forEach((item, index) => {
    const product = products.get(text(item.productId));
    if (!product) return;
    const currentProduct = {
      sku: product.sku ?? null, description: product.name ?? null, unit: product.unit ?? null,
      ncm: product.ncm ?? null, cest: product.cest ?? null, gtin: product.gtin ?? null, origin: product.origin ?? null,
    };
    const snapshotProduct = projection(item, ["sku", "description", "unit", "ncm", "cest", "gtin", "origin"]);
    if (stableJson(snapshotProduct) !== stableJson(currentProduct))
      add(`Item ${index + 1}: os dados do produto mudaram após a criação do rascunho.`);

    const snapshotProfile = obj(item.taxProfile);
    const profileId = text(snapshotProfile.id);
    if (!profileId || text(product.tax_profile_id) !== profileId) {
      add(`Item ${index + 1}: o perfil tributário vinculado ao produto mudou.`);
      return;
    }
    const profile = profiles.get(profileId);
    if (!profile || profile.review_status !== "reviewed") {
      add(`Item ${index + 1}: o perfil tributário atual não está revisado.`);
      return;
    }
    const approval = reviewApprovedTaxProfile(profile);
    if (!approval.ready) add(`Item ${index + 1}: ${approval.issue}`);
    const operation = reviewNfeOperation(currentIssuerUf, recipientUf, text(item.cfop), index + 1).operation;
    if (operation !== text(item.operation)) add(`Item ${index + 1}: a operação mudou após a criação do rascunho.`);
    const rules = obj(profile.rules);
    const operations = obj(rules.operations);
    const selectedRules = obj(operations[operation]);
    if (!Object.keys(selectedRules).length || stableJson(selectedRules) !== stableJson(obj(item.taxRules)))
      add(`Item ${index + 1}: a regra fiscal aprovada mudou; crie um novo rascunho.`);
    else reviewProfileConsistency(selectedRules, text(item.cfop), text(item.csosn), index + 1, operation)
      .forEach(problem => add(problem));
  });

  const sourceOrder = obj(payload.sourceOrder);
  const sourceOrderId = text(sourceOrder.id);
  if (sourceOrderId) {
    if (!uuidPattern.test(sourceOrderId)) add("O pedido de origem tem identificador inválido.");
    else {
      const orderRows = await dbRequest<DbRow[]>(
        `/rest/v1/jvg_orders?${scope(account)}&id=${filterEq(sourceOrderId)}&select=id,customer_id,status,total,items&limit=1`,
      );
      const order = orderRows[0];
      if (!order || !["open", "fulfilled"].includes(String(order.status))) add("O pedido de origem não está mais disponível para faturamento.");
      else {
        const orderItems = Array.isArray(order.items) ? order.items.map(obj) : [];
        if (String(order.customer_id || "") !== recipientId || orderItems.length !== items.length)
          add("Cliente ou quantidade de itens do pedido de origem mudou.");
        else orderItems.forEach((orderItem, index) => {
          const quantityMilli = Math.round(Number(orderItem.quantity) * 1000);
          const unitPriceCents = Math.round(Number(orderItem.unitPrice) * 100);
          if (String(orderItem.productId || "") !== text(items[index].productId) ||
              quantityMilli !== Math.round(Number(items[index].quantity) * 1000) ||
              unitPriceCents !== Number(items[index].unitPriceCents))
            add(`Item ${index + 1}: produto, quantidade ou preço do pedido de origem mudou.`);
        });
        const orderTotalCents = Math.round(Number(order.total) * 100);
        if (!Number.isSafeInteger(orderTotalCents) || orderTotalCents !== Number(payload.totalCents))
          add("O total do pedido de origem mudou após a criação do rascunho.");
      }
    }
  }
  return issues;
}

function documentResponsePatch(body: Json, currentStatus: string, reference: string, userId: string): Json {
  const safeBody = safeFocusBody(body);
  const nextStatus = internalStatus(body.status, currentStatus);
  const patch: Json = {
    status: nextStatus,
    provider_response: {
      operation: "focus_nfe",
      observedAt: new Date().toISOString(),
      observedBy: userId,
      reference,
      response: safeBody,
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
  if (body.confirmFiscalReview !== true)
    throw new JvgBackendError("Confirme que as regras deste rascunho foram revisadas com a contabilidade e que o envio é somente para homologação.", 400);
  if (!uuidPattern.test(id)) throw new JvgBackendError("Identificador do rascunho inválido.", 400);

  const document = await readDocument(context.account, id);
  if (!document) throw new JvgBackendError("Rascunho NF-e não encontrado nesta empresa.", 404);
  if (document.status !== "draft") throw new JvgBackendError("Este rascunho já saiu da etapa de preparação. Não envie novamente; consulte o status Focus.", 409);
  const payload = obj(document.fiscal_payload);
  if (payload.schemaVersion !== 5)
    throw new JvgBackendError("Este rascunho é de uma estrutura antiga. Crie outro para revisar os campos fiscais atuais.", 409);

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
  if (!reserved) throw new JvgBackendError("Outro processo atualizou este rascunho. Recarregue antes de tentar novamente.", 409);

  try {
    const result = await emitFocusNfeHomologacao(context.token, reference, gate.focusRequestPreview);
    const providerReference = text(result.body.ref);
    if (providerReference && providerReference !== reference) {
      await patchDocument(context.account, id, "processing", {
        provider_response: { operation: "focus_nfe", phase: "reference_mismatch", requestedAt: startedAt,
          requestedBy: context.userId, reference, response: safeFocusBody(result.body) },
      });
      return apiJson({ ok: false, status: "processing", reference, needsReconciliation: true,
        message: "A Focus retornou uma referência diferente. Não reenvie; consulte o documento pela referência salva." }, 202);
    }
    const patch = documentResponsePatch(result.body, "processing", reference, context.userId);
    await patchDocument(context.account, id, "processing", patch);
    const status = String(patch.status);
    return apiJson({ ok: true, status, reference, accessKey: patch.access_key || null,
      number: patch.document_number || null, series: patch.series || null,
      needsReconciliation: status === "processing" }, status === "processing" ? 202 : 200);
  } catch (error) {
    if (error instanceof FocusNfeApiError) {
      const httpStatus = error.httpStatus;
      const retryableNoAcceptance = [401, 403].includes(httpStatus);
      const providerRejected = [400, 422].includes(httpStatus);
      const nextStatus = retryableNoAcceptance ? "draft" : providerRejected ? "rejected" : "processing";
      await patchDocument(context.account, id, "processing", {
        status: nextStatus,
        provider_response: { operation: "focus_nfe", phase: providerRejected ? "rejected" : "http_error",
          requestedAt: startedAt, observedAt: new Date().toISOString(), observedBy: context.userId,
          reference, httpStatus, response: safeFocusBody(error.body) },
      });
      return apiJson({ ok: false, status: nextStatus, reference,
        providerResponse: safeFocusBody(error.body),
        needsReconciliation: nextStatus === "processing",
        message: providerRejected ? "A Focus rejeitou os dados. Corrija as pendências antes de criar um novo rascunho." :
          retryableNoAcceptance ? "A Focus não aceitou a solicitação; confira a conexão e tente novamente com o mesmo rascunho." :
          "A resposta da Focus não permite confirmar o resultado. Consulte a referência salva antes de qualquer novo envio." },
      providerRejected ? 422 : 502);
    }
    // Timeout ou falha de rede pode ocorrer depois que a Focus recebeu a nota.
    // Mantém status processing e referência para reconciliar sem POST duplicado.
    await patchDocument(context.account, id, "processing", {
      provider_response: { operation: "focus_nfe", phase: "outcome_unknown", requestedAt: startedAt,
        observedAt: new Date().toISOString(), observedBy: context.userId, reference },
    });
    return apiJson({ ok: false, status: "processing", reference, needsReconciliation: true,
      message: "Não foi possível confirmar a resposta da Focus. Use Consultar Focus; não envie este rascunho novamente." }, 202);
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
  try {
    const result = await queryFocusNfeHomologacao(context.token, reference, true);
    const providerReference = text(result.body.ref);
    if (providerReference && providerReference !== reference)
      throw new JvgBackendError("A resposta da Focus pertence a outra referência.", 502);
    const patch = documentResponsePatch(result.body, String(document.status), reference, context.userId);
    await patchDocument(context.account, id, String(document.status), patch);
    return apiJson({ ok: true, status: patch.status, reference,
      accessKey: patch.access_key || document.access_key || null,
      number: patch.document_number || document.document_number || null,
      series: patch.series || document.series || null,
      providerResponse: safeFocusBody(result.body) });
  } catch (error) {
    if (error instanceof FocusNfeApiError && error.httpStatus === 404)
      return apiJson({ ok: false, status: document.status, reference, needsReconciliation: true,
        message: "A Focus ainda não localizou esta referência. O status foi preservado; não reenvie automaticamente." }, 202);
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
    if (data.action !== "emit") throw new JvgBackendError("Ação fiscal inválida.", 400);
    return await emit(context, id, data);
  } catch (error) {
    return safeError(error);
  }
}
