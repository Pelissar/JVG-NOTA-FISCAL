import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getPlatformRole, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import { focusRuntimeEnv } from "../../../../lib/focus/runtime-env";
import { parseNfeDraftInput } from "../../../../lib/fiscal/nfe-draft";
import { isOfficialCfopCode } from "../../../../lib/fiscal/cfop";
import { reviewNfeOperation } from "../../../../lib/fiscal/operation-review";
import { reviewNfePreparation } from "../../../../lib/fiscal/nfe-preflight";
import { reviewNfeDocument, reviewFocusNfePayload } from "../../../../lib/fiscal/nfe-document-review";
import { reviewNfeHomologationGate } from "../../../../lib/fiscal/nfe-homologation-gate";

export const dynamic = "force-dynamic";

type DbRow = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicProviderResponse(value: unknown): DbRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as DbRow;
  const response = stored.response && typeof stored.response === "object" && !Array.isArray(stored.response)
    ? stored.response as DbRow : {};
  const allowed = ["status", "status_sefaz", "mensagem_sefaz", "ref", "numero", "serie", "chave_nfe", "protocolo",
    "numero_protocolo", "codigo_status", "erro", "mensagem", "caminho_xml_nota_fiscal", "caminho_danfe", "eventos"];
  const safeResponse: DbRow = {};
  for (const key of allowed) {
    const item = response[key];
    if (key === "eventos" && Array.isArray(item)) {
      const safeEvents = item.slice(0, 50).flatMap(rawEvent => {
        if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return [];
        const safeEvent = Object.fromEntries(Object.entries(rawEvent as DbRow).filter(([name, value]) =>
          /^[a-zA-Z0-9_]{1,64}$/.test(name) &&
          ((typeof value === "string" && value.length <= 1000) ||
            (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean")));
        return Object.keys(safeEvent).length ? [safeEvent] : [];
      });
      if (safeEvents.length) safeResponse.eventos = safeEvents;
      continue;
    }
    if ((typeof item === "string" && item.length <= 2000) || (typeof item === "number" && Number.isFinite(item)))
      safeResponse[key] = item;
  }
  const result: DbRow = {};
  if (stored.operation === "focus_nfe") result.operation = stored.operation;
  if (typeof stored.phase === "string" && stored.phase.length <= 40) result.phase = stored.phase;
  if (typeof stored.observedAt === "string" && stored.observedAt.length <= 40) result.observedAt = stored.observedAt;
  if (typeof stored.reference === "string" && stored.reference.length <= 50) result.reference = stored.reference;
  if (Object.keys(safeResponse).length) result.response = safeResponse;
  return result;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function currentAccount(): Promise<SiteAccount> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return account;
}

function scope(account: SiteAccount): string {
  return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
}

async function homologationSetup(account: SiteAccount) {
  const user = await getJvgUser();
  const pilotCompanyId = focusRuntimeEnv("JVG_FOCUS_PILOT_COMPANY_ID");
  const focusTokenConfigured = Boolean(focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN"));
  const [platformAdmin, company] = await Promise.all([
    user ? getPlatformRole(user).then(role => role === "platform_admin") : Promise.resolve(false),
    getCompany(account),
  ]);
  const pilotCompanyMatches = Boolean(pilotCompanyId && pilotCompanyId === account.company_id);
  const accountCanSubmit = account.role !== "viewer";
  const taxRegimeConfirmed = company?.tax_regime_confirmation_available === true && company.tax_regime_confirmed === true;
  const supportedTaxRegime = company?.tax_regime === "simples_nacional";
  const issuerMissing = company ? company.fiscal_missing.slice(0, 30) : ["Cadastro fiscal do emitente não encontrado"];
  const accessIssues: string[] = [];
  if (!platformAdmin) accessIssues.push("O envio de teste é restrito a um administrador da plataforma durante o piloto.");
  if (!accountCanSubmit) accessIssues.push("Seu perfil nesta empresa não tem permissão para transmitir documentos fiscais.");
  if (!pilotCompanyId) accessIssues.push("A empresa piloto ainda não está vinculada à configuração do ambiente de homologação.");
  else if (!pilotCompanyMatches) accessIssues.push("Este ambiente está vinculado a outra empresa piloto; o envio de teste é exclusivo da JVG.");
  if (!focusTokenConfigured) accessIssues.push("A credencial de homologação da Focus não está configurada no servidor.");
  if (!company) accessIssues.push("Não foi possível localizar o cadastro fiscal do emitente.");
  if (!taxRegimeConfirmed) accessIssues.push("O regime tributário precisa estar disponível e confirmado com a contabilidade nos dados da empresa.");
  if (company && !supportedTaxRegime) accessIssues.push("O fluxo atual de NF-e em homologação atende somente empresas confirmadas no Simples Nacional.");
  if (issuerMissing.length) accessIssues.push("Complete os dados fiscais obrigatórios do emitente: " + issuerMissing.join(", ") + ".");
  return {
    environment: "homologacao",
    platformAdmin,
    accountCanSubmit,
    pilotCompanyConfigured: Boolean(pilotCompanyId),
    pilotCompanyMatches,
    focusTokenConfigured,
    issuerFound: Boolean(company),
    issuerMissing,
    taxRegimeConfirmationAvailable: company?.tax_regime_confirmation_available === true,
    taxRegimeConfirmed,
    supportedTaxRegime,
    accessReady: accessIssues.length === 0,
    accessIssues,
  };
}

export async function GET(request: Request) {
  try {
    const account = await currentAccount();
    const requestedId = new URL(request.url).searchParams.get("id");
    const setup = await homologationSetup(account);
    if (requestedId !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId))
        throw new JvgBackendError("Identificador do documento inválido.", 400);
      // Filtro por empresa, tipo e ambiente aplicado também na consulta individual.
      const selected = await dbRequest<DbRow[]>(
        `/rest/v1/jvg_fiscal_documents?${scope(account)}&id=${filterEq(requestedId)}&document_type=eq.nfe&environment=eq.homologacao&select=id,status,focus_reference,access_key,series,document_number,provider_response,fiscal_payload,created_at,updated_at,authorized_at&limit=1`,
      );
      if (!selected[0]) throw new JvgBackendError("Documento fiscal não encontrado nesta empresa.", 404);
      const payload = selected[0].fiscal_payload && typeof selected[0].fiscal_payload === "object" ? selected[0].fiscal_payload as DbRow : {};
      const homologationGate = selected[0].status === "draft" ? reviewNfeHomologationGate(payload) : { ready: false, issues: [], reviewCount: 0 };
      const canUseHomologation = setup.accessReady;
      return apiJson({
        draft: {
          id: selected[0].id, status: selected[0].status, createdAt: selected[0].created_at,
          updatedAt: selected[0].updated_at, authorizedAt: selected[0].authorized_at,
          focusReference: selected[0].focus_reference, accessKey: selected[0].access_key,
          series: selected[0].series, documentNumber: selected[0].document_number,
          providerResponse: publicProviderResponse(selected[0].provider_response),
          nature: payload.nature,
          purpose: payload.purpose ?? null, issueAt: payload.issueAt ?? null, exitAt: payload.exitAt ?? null,
          consumerFinal: payload.consumerFinal ?? null, buyerPresence: payload.buyerPresence ?? null,
          recipientIeIndicator: payload.recipientIeIndicator ?? null,
          transportMode: (payload.transport as DbRow | undefined)?.mode ?? null,
          carrier: (payload.transport as DbRow | undefined)?.carrier ?? null,
          vehicle: (payload.transport as DbRow | undefined)?.vehicle ?? null,
          volumes: (payload.transport as DbRow | undefined)?.volumes ?? [],
          additionalTotals: payload.additionalTotals ?? null, payments: payload.payments ?? [],
          intermediary: payload.intermediary ?? null, additionalInfo: payload.additionalInfo ?? null,
          sourceOrder: payload.sourceOrder ?? null,
          issuer: payload.issuer, recipient: payload.recipient,
          items: payload.items, totalCents: payload.totalCents, commercialTotalCents: payload.commercialTotalCents ?? payload.totalCents,
          pending: payload.pending, taxPreview: payload.taxPreview,
          preflight: payload.preflight ?? null,
          documentReview: reviewNfeDocument(payload),
          focusPayloadReview: reviewFocusNfePayload(payload),
          homologationGate: { ready: homologationGate.ready, issues: homologationGate.issues, reviewCount: homologationGate.reviewCount },
          homologationSetup: setup,
          canSubmitHomologation: selected[0].status === "draft" && homologationGate.ready && canUseHomologation,
          homologationAccessIssue: canUseHomologation ? null : setup.accessIssues.join(" "),
          readyToTransmit: false, transmissionEnabled: false,
        },
      });
    }
    const rows = await dbRequest<DbRow[]>(
      `/rest/v1/jvg_fiscal_documents?${scope(account)}&document_type=eq.nfe&environment=eq.homologacao&select=id,status,focus_reference,access_key,fiscal_payload,created_at,updated_at&order=created_at.desc&limit=50`,
    );
    return apiJson({ homologationSetup: setup, drafts: rows.map(row => {
      const payload = row.fiscal_payload && typeof row.fiscal_payload === "object" ? row.fiscal_payload as DbRow : {};
      const recipient = payload.recipient && typeof payload.recipient === "object" ? payload.recipient as DbRow : {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      const warnings = Array.isArray(payload.pending) ? payload.pending : [];
      return {
        id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
        focusReference: row.focus_reference, accessKey: row.access_key,
        recipientName: String(recipient.name || "Destinatário"), itemsCount: items.length,
        sourceOrderId: String((payload.sourceOrder as DbRow | undefined)?.id || ""),
        sourceOrderNumber: String((payload.sourceOrder as DbRow | undefined)?.number || ""),
        totalCents: Number(payload.totalCents || 0), commercialTotalCents: Number(payload.commercialTotalCents ?? payload.totalCents ?? 0), pendingCount: warnings.length,
      };
    }) });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await currentAccount();
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para emitir NF-e.", 403);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!uuidPattern.test(idempotencyKey))
      throw new JvgBackendError("Identificador seguro da solicitação ausente ou inválido. Recarregue a página e tente novamente.", 400);
    const raw = await request.text();
    if (raw.length > 32_000) throw new JvgBackendError("Os dados da NF-e excedem o limite permitido.", 413);
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    let draft;
    try { draft = parseNfeDraftInput(data); }
    catch (error) { throw new JvgBackendError(error instanceof Error ? error.message : "Dados da NF-e inválidos.", 400); }

    const company = await getCompany(account);
    if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);

    const scoped = scope(account);
    let sourceOrder: DbRow | null = null;
    if (draft.sourceOrderId) {
      const orders = await dbRequest<DbRow[]>(
        `/rest/v1/jvg_orders?${scoped}&id=${filterEq(draft.sourceOrderId)}&select=id,quote_id,customer_id,status,total,items&limit=1`,
      );
      sourceOrder = orders[0] ?? null;
      if (!sourceOrder) throw new JvgBackendError("Pedido de origem não encontrado nesta empresa.", 404);
      if (sourceOrder.status !== "open" && sourceOrder.status !== "fulfilled")
        throw new JvgBackendError("Somente pedidos em aberto ou concluídos podem originar uma NF-e.", 409);
      if (!sourceOrder.customer_id || String(sourceOrder.customer_id) !== draft.recipientId)
        throw new JvgBackendError("O destinatário da NF-e precisa ser o mesmo do pedido.", 400);
      const orderItems = Array.isArray(sourceOrder.items) ? sourceOrder.items as DbRow[] : [];
      if (orderItems.length !== draft.items.length)
        throw new JvgBackendError("Os itens da NF-e precisam corresponder ao pedido de origem.", 400);
      orderItems.forEach((orderItem, index) => {
        const productId = typeof orderItem.productId === "string" ? orderItem.productId : "";
        if (!productId || orderItem.serviceId)
          throw new JvgBackendError("Este pedido contém serviço ou item sem produto vinculado; a emissão de NF-e aceita somente mercadorias.", 400);
        const quantityMilli = Math.round(Number(orderItem.quantity) * 1000);
        const unitPriceCents = Math.round(Number(orderItem.unitPrice) * 100);
        if (productId !== draft.items[index].productId ||
            !Number.isSafeInteger(quantityMilli) || quantityMilli !== draft.items[index].quantityMilli ||
            !Number.isSafeInteger(unitPriceCents) || unitPriceCents !== draft.items[index].unitPriceCents)
          throw new JvgBackendError("Produtos, quantidades e preços devem permanecer iguais aos do pedido vinculado.", 400);
      });
      const orderTotalCents = Math.round(Number(sourceOrder.total) * 100);
      if (!Number.isSafeInteger(orderTotalCents) || orderTotalCents !== draft.totalCents)
        throw new JvgBackendError("O total da NF-e não corresponde ao total do pedido.", 400);
    }
    const [recipientRows, products, carrierRows] = await Promise.all([
      dbRequest<DbRow[]>(`/rest/v1/jvg_parties?${scoped}&id=${filterEq(draft.recipientId)}&is_customer=eq.true&active=eq.true&select=id,display_name,legal_name,document_type,document_number,state_registration,municipal_registration,email,phone,address&limit=1`),
      dbRequest<DbRow[]>(`/rest/v1/jvg_products?${scoped}&id=in.(${draft.items.map(i => i.productId).join(",")})&active=eq.true&select=id,sku,name,unit,ncm,cest,gtin,origin,tax_profile_id,sale_price`),
      draft.carrierId
        ? dbRequest<DbRow[]>(`/rest/v1/jvg_parties?${scoped}&id=${filterEq(draft.carrierId)}&is_carrier=eq.true&active=eq.true&select=id,display_name,legal_name,document_type,document_number,state_registration,email,phone,address&limit=1`)
        : Promise.resolve([]),
    ]);
    const recipient = recipientRows[0];
    if (!recipient) throw new JvgBackendError("Destinatário não pertence a esta empresa ou está inativo.", 400);
    const carrier = carrierRows[0] ?? null;
    if (draft.carrierId && !carrier) throw new JvgBackendError("Transportadora não pertence a esta empresa, está inativa ou não está marcada como transportadora.", 400);
    const byId = new Map(products.map(product => [String(product.id), product]));
    if (draft.items.some(item => !byId.has(item.productId)))
      throw new JvgBackendError("Um ou mais produtos não pertencem à empresa ou estão inativos.", 400);

    const profileIds = [...new Set(products.map(product => String(product.tax_profile_id || '')).filter(Boolean))];
    const profiles = profileIds.length ? await dbRequest<DbRow[]>(`/rest/v1/jvg_tax_profiles?${scoped}&id=in.(${profileIds.join(',')})&document_type=eq.nfe&select=id,name,rules,review_status,reviewed_by`) : [];
    const byProfile = new Map(profiles.map(profile => [String(profile.id), profile]));
    const pending: string[] = [];
    if (company.fiscal_missing.length) pending.push("Conferir dados fiscais do emitente");
    if (company.tax_regime_confirmation_available !== true)
      pending.push("Regime tributário ainda não está disponível para conferência no cadastro da empresa; a preparação pode continuar, mas a transmissão fica bloqueada.");
    else if (company.tax_regime_confirmed !== true)
      pending.push("Regime tributário não confirmado; a preparação pode continuar, mas a transmissão fica bloqueada até a confirmação.");
    else if (company.tax_regime !== "simples_nacional")
      pending.push("O fluxo fiscal atual de homologação atende ao Simples Nacional; confirme o regime e a configuração antes de transmitir.");
    if (!recipient.document_number) pending.push("Documento CPF/CNPJ do destinatário não informado");
    const issuerAddress = company.address && typeof company.address === "object" ? company.address as DbRow : {};
    const recipientAddress = recipient.address && typeof recipient.address === "object" ? recipient.address as DbRow : {};
    const issuerUf = issuerAddress.state;
    const recipientUf = recipientAddress.state;
    const items = draft.items.map((input, index) => {
      const product = byId.get(input.productId)!;
      const itemNcm = input.ncm ?? String(product.ncm || "").replace(/\D/g, "");
      const itemCest = input.cest ?? String(product.cest || "").replace(/\D/g, "");
      const itemOrigin = input.origin ?? String(product.origin || "");
      if (!/^[0-9]{8}$/.test(itemNcm)) pending.push(`Item ${index + 1} (${product.name}): NCM ausente ou inválido. Preencha o campo NCM neste item com 8 dígitos.`);
      if (!input.cfop) pending.push(`Item ${index + 1}: CFOP pendente. Informe o CFOP aplicável no campo CFOP deste item, considerando a operação e o local de entrega.`);
      else if (!isOfficialCfopCode(input.cfop)) pending.push(`Item ${index + 1}: CFOP ${input.cfop} não consta da tabela oficial. Corrija o código no campo CFOP deste item.`);
      // O 102 é uma sugestão editável apresentada pela interface apenas para
      // a empresa piloto. Um campo vazio enviado pelo usuário deve continuar vazio.
      const itemCsosn = input.csosn;
      if (!itemCsosn) pending.push(`Item ${index + 1}: CSOSN do ICMS pendente. Informe o código indicado para este produto e operação no próprio item da NF-e.`);
      const review = reviewNfeOperation(issuerUf, recipientUf, input.cfop, index + 1);
      const profile = product.tax_profile_id ? byProfile.get(String(product.tax_profile_id)) : undefined;
      const rules = {
        csosn: itemCsosn,
        pisCst: input.pisCst,
        cofinsCst: input.cofinsCst,
        focusFields: input.focusFields,
      };
      if (!input.pisCst) pending.push(`Item ${index + 1}: CST do PIS pendente. Informe no próprio item o código aplicável ao produto e à operação; não é necessário cadastrar perfil tributário.`);
      if (!input.cofinsCst) pending.push(`Item ${index + 1}: CST da Cofins pendente. Informe no próprio item o código aplicável ao produto e à operação; não é necessário cadastrar perfil tributário.`);
      const taxPreview = { lines: [], sumOfEstimatesCents: 0, provisional: true, validForEmission: false, calculationMethod: "not_calculated" };
      return {
        productId: product.id, sku: product.sku, description: product.name,
        unit: product.unit, ncm: itemNcm, cest: itemCest, gtin: product.gtin, origin: itemOrigin,
        productSnapshot: { sku: product.sku, description: product.name, unit: product.unit,
          ncm: product.ncm ?? null, cest: product.cest ?? null, gtin: product.gtin ?? null, origin: product.origin ?? null },
        quantity: input.quantity, unitPriceCents: input.unitPriceCents,
        subtotalCents: input.subtotalCents, cfop: input.cfop, csosn: itemCsosn,
        operation: review.operation, taxPreview,
        taxRules: rules,
        taxProfile: profile ? { id: profile.id, name: profile.name, reviewStatus: profile.review_status } : null,
      };
    });
    const issuer = {
      companyId: account.company_id,
      name: company.trade_name || company.legal_name,
      legalName: company.legal_name, tradeName: company.trade_name,
      cnpj: company.cnpj, stateRegistration: company.state_registration,
      municipalRegistration: company.municipal_registration, cnae: company.cnae,
      fiscalEmail: company.fiscal_email, fiscalPhone: company.fiscal_phone,
      address: company.address, state: issuerUf,
      series: company.nfe_series_homologacao,
      nextNumber: company.nfe_next_number_homologacao,
      taxRegime: company.tax_regime, taxRegimeConfirmed: company.tax_regime_confirmed === true,
    };
    const recipientSnapshot = {
      id: recipient.id, name: recipient.display_name, legalName: recipient.legal_name,
      documentType: recipient.document_type, documentNumber: recipient.document_number,
      stateRegistration: recipient.state_registration,
      municipalRegistration: recipient.municipal_registration,
      email: recipient.email, phone: recipient.phone,
      address: recipient.address, state: recipientUf,
    };
    const carrierSnapshot = carrier ? {
      id: carrier.id, name: carrier.display_name, legalName: carrier.legal_name,
      documentType: carrier.document_type, documentNumber: carrier.document_number,
      stateRegistration: carrier.state_registration, email: carrier.email,
      phone: carrier.phone, address: carrier.address,
    } : null;
    const preflight = reviewNfePreparation(issuer, recipientSnapshot, items);
    pending.push(...preflight.issues);
    if (draft.purpose === null) pending.push("Informe explicitamente a finalidade da NF-e.");
    else if (draft.purpose !== 1) pending.push("Este fluxo prepara apenas NF-e normal; outras finalidades exigem dados de referência ainda não capturados.");
    if (!draft.issueAt) pending.push("Informe data e hora de emissão com fuso horário.");
    if (draft.consumerFinal === null) pending.push("Indique se a operação é com consumidor final.");
    if (draft.buyerPresence === null) pending.push("Informe a presença do comprador conforme a operação.");
    if (draft.transportMode === null) pending.push("Informe a modalidade de frete conforme a operação.");
    const taxPreview = {
      sumOfEstimatesCents: 0,
      provisional: true, validForEmission: false, calculationMethod: "not_calculated",
    };

    const commercialTotalCents = draft.totalCents + draft.additionalTotals.freightCents + draft.additionalTotals.insuranceCents +
      draft.additionalTotals.expensesCents - draft.additionalTotals.discountCents;
    const payload = {
      schemaVersion: 7, nature: draft.nature, purpose: draft.purpose, issueAt: draft.issueAt, exitAt: draft.exitAt,
      consumerFinal: draft.consumerFinal, buyerPresence: draft.buyerPresence,
      recipientIeIndicator: draft.recipientIeIndicator,
      transport: { mode: draft.transportMode, carrier: carrierSnapshot, vehicle: draft.vehicle, volumes: draft.volumes },
      additionalTotals: draft.additionalTotals, payments: draft.payments,
      intermediary: draft.intermediary, additionalInfo: draft.additionalInfo,
      sourceOrder: sourceOrder ? {
        id: String(sourceOrder.id),
        number: "PED-" + String(sourceOrder.id).slice(0, 8).toUpperCase(),
        quoteId: String(sourceOrder.quote_id || ""), status: String(sourceOrder.status || ""),
      } : null,
      issuer, recipient: recipientSnapshot,
      items, totalCents: draft.totalCents, commercialTotalCents, taxPreview, preflight, pending, readyToTransmit: false,
    };

    const documentId = typeof (data as DbRow).documentId === "string" ? String((data as DbRow).documentId).trim() : "";
    if (documentId) {
      if (!uuidPattern.test(documentId)) throw new JvgBackendError("Identificador do documento inválido.", 400);
      const editable = await dbRequest<Array<{ id: string }>>(
        `/rest/v1/jvg_fiscal_documents?${scope(account)}&id=${filterEq(documentId)}&document_type=eq.nfe&environment=eq.homologacao&status=eq.draft&focus_reference=is.null&select=id&limit=1`,
      );
      if (!editable[0]) throw new JvgBackendError("Este documento já foi enviado ou não pertence a esta empresa; somente documentos ainda não transmitidos em homologação podem ser editados.", 409);
      const updated = await dbRequest<Array<{ id: string }>>(
        `/rest/v1/jvg_fiscal_documents?${scope(account)}&id=${filterEq(documentId)}&document_type=eq.nfe&environment=eq.homologacao&status=eq.draft&focus_reference=is.null&select=id`,
        { method: "PATCH", body: JSON.stringify({
          recipient_party_id: recipient.id, recipient_document: recipient.document_number || null,
          carrier_party_id: carrier?.id || null, carrier_document: carrier?.document_number || null,
          carrier_name: carrier?.display_name || null, fiscal_payload: payload,
          updated_at: new Date().toISOString(),
        }) },
      );
      if (!updated[0]) throw new JvgBackendError("A NF-e mudou de estado durante a edição. Atualize o histórico antes de tentar novamente.", 409);
      return apiJson({ ok: true, id: documentId, status: "draft", totalCents: draft.totalCents,
        commercialTotalCents, pending, sourceOrderId: draft.sourceOrderId, transmissionEnabled: false }, 200);
    }

    const existing = await dbRequest<Array<{ id: string; status: string; fiscal_payload: unknown }>>(
      `/rest/v1/jvg_fiscal_documents?${scope(account)}&document_type=eq.nfe&environment=eq.homologacao&idempotency_key=${filterEq(idempotencyKey)}&select=id,status,fiscal_payload&limit=1`,
    );
    if (existing[0]) {
      if (stableJson(existing[0].fiscal_payload) !== stableJson(payload))
        throw new JvgBackendError("Esta solicitação já foi usada com outros dados. Recarregue a página antes de salvar novamente.", 409);
      return apiJson({ ok: true, id: existing[0].id, status: existing[0].status,
        totalCents: draft.totalCents, commercialTotalCents, pending, sourceOrderId: draft.sourceOrderId, transmissionEnabled: false }, 200);
    }
    const created = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_fiscal_documents", {
      method: "POST",
      body: JSON.stringify({
        tenant_id: account.tenant_id, company_id: account.company_id,
        document_type: "nfe", environment: "homologacao", status: "draft",
        recipient_party_id: recipient.id, recipient_document: recipient.document_number || null,
        carrier_party_id: carrier?.id || null, carrier_document: carrier?.document_number || null,
        carrier_name: carrier?.display_name || null,
        idempotency_key: idempotencyKey, fiscal_payload: payload,
      }),
    });
    if (!created[0]?.id) throw new JvgBackendError("Não foi possível salvar a NF-e.", 502);
    return apiJson({ ok: true, id: created[0].id, status: "draft",
      totalCents: draft.totalCents, commercialTotalCents, pending, sourceOrderId: draft.sourceOrderId, transmissionEnabled: false }, 201);
  } catch (error) { return safeError(error); }
}
