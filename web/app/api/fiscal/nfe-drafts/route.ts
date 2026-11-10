import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import { parseNfeDraftInput } from "../../../../lib/fiscal/nfe-draft";
import { isOfficialCfopCode } from "../../../../lib/fiscal/cfop";
import { reviewNfeOperation, reviewProfileConsistency } from "../../../../lib/fiscal/operation-review";
import { calculateTaxPreview, parsePreviewRate, PREVIEW_TAXES, type PreviewRates } from "../../../../lib/fiscal/tax-preview";
import { reviewNfePreparation } from "../../../../lib/fiscal/nfe-preflight";
import { reviewNfeDocument } from "../../../../lib/fiscal/nfe-document-review";

export const dynamic = "force-dynamic";

type DbRow = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function GET(request: Request) {
  try {
    const account = await currentAccount();
    const requestedId = new URL(request.url).searchParams.get("id");
    if (requestedId !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId))
        throw new JvgBackendError("Identificador do rascunho inválido.", 400);
      // Filtro por empresa, tipo e ambiente aplicado também na consulta individual.
      const selected = await dbRequest<DbRow[]>(
        `/rest/v1/jvg_fiscal_documents?${scope(account)}&id=${filterEq(requestedId)}&document_type=eq.nfe&environment=eq.homologacao&status=eq.draft&select=id,status,fiscal_payload,created_at&limit=1`,
      );
      if (!selected[0]) throw new JvgBackendError("Rascunho não encontrado nesta empresa.", 404);
      const payload = selected[0].fiscal_payload && typeof selected[0].fiscal_payload === "object" ? selected[0].fiscal_payload as DbRow : {};
      return apiJson({
        draft: {
          id: selected[0].id, status: selected[0].status, createdAt: selected[0].created_at,
          nature: payload.nature,
          sourceOrder: payload.sourceOrder ?? null,
          issuer: payload.issuer, recipient: payload.recipient,
          items: payload.items, totalCents: payload.totalCents,
          pending: payload.pending, taxPreview: payload.taxPreview,
          preflight: payload.preflight ?? null,
          documentReview: reviewNfeDocument(payload),
          readyToTransmit: false, transmissionEnabled: false,
        },
      });
    }
    const rows = await dbRequest<DbRow[]>(
      `/rest/v1/jvg_fiscal_documents?${scope(account)}&document_type=eq.nfe&environment=eq.homologacao&select=id,status,fiscal_payload,created_at,updated_at&order=created_at.desc&limit=50`,
    );
    return apiJson({ drafts: rows.map(row => {
      const payload = row.fiscal_payload && typeof row.fiscal_payload === "object" ? row.fiscal_payload as DbRow : {};
      const recipient = payload.recipient && typeof payload.recipient === "object" ? payload.recipient as DbRow : {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      const warnings = Array.isArray(payload.pending) ? payload.pending : [];
      return {
        id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
        recipientName: String(recipient.name || "Destinatário"), itemsCount: items.length,
        sourceOrderId: String((payload.sourceOrder as DbRow | undefined)?.id || ""),
        sourceOrderNumber: String((payload.sourceOrder as DbRow | undefined)?.number || ""),
        totalCents: Number(payload.totalCents || 0), pendingCount: warnings.length,
        previewTotalCents: Number((payload.taxPreview as DbRow | undefined)?.sumOfEstimatesCents || 0),
      };
    }) });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await currentAccount();
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para criar rascunhos fiscais.", 403);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!uuidPattern.test(idempotencyKey))
      throw new JvgBackendError("Identificador seguro da solicitação ausente ou inválido. Recarregue a página e tente novamente.", 400);
    const raw = await request.text();
    if (raw.length > 32_000) throw new JvgBackendError("Rascunho muito grande.", 413);
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    let draft;
    try { draft = parseNfeDraftInput(data); }
    catch (error) { throw new JvgBackendError(error instanceof Error ? error.message : "Rascunho inválido.", 400); }

    const company = await getCompany(account);
    if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
    if (company.tax_regime_confirmation_available !== true)
      throw new JvgBackendError("Aplique a migration fiscal pendente no Supabase antes de preparar rascunhos de NF-e.", 409);
    if (company.tax_regime_confirmed !== true)
      throw new JvgBackendError("Confirme o regime tributário com a contabilidade nos dados da empresa antes de preparar NF-e.", 409);
    if (company.tax_regime !== "simples_nacional")
      throw new JvgBackendError("Esta versão do rascunho NF-e está disponível apenas para o Simples Nacional.", 400);

    const scoped = scope(account);
    let sourceOrder: DbRow | null = null;
    if (draft.sourceOrderId) {
      const orders = await dbRequest<DbRow[]>(
        `/rest/v1/jvg_orders?${scoped}&id=${filterEq(draft.sourceOrderId)}&select=id,quote_id,customer_id,status,total,items&limit=1`,
      );
      sourceOrder = orders[0] ?? null;
      if (!sourceOrder) throw new JvgBackendError("Pedido de origem não encontrado nesta empresa.", 404);
      if (sourceOrder.status !== "open" && sourceOrder.status !== "fulfilled")
        throw new JvgBackendError("Somente pedidos em aberto ou concluídos podem originar rascunho NF-e.", 409);
      if (!sourceOrder.customer_id || String(sourceOrder.customer_id) !== draft.recipientId)
        throw new JvgBackendError("O destinatário do rascunho precisa ser o mesmo do pedido.", 400);
      const orderItems = Array.isArray(sourceOrder.items) ? sourceOrder.items as DbRow[] : [];
      if (orderItems.length !== draft.items.length)
        throw new JvgBackendError("Os itens do rascunho precisam corresponder ao pedido de origem.", 400);
      orderItems.forEach((orderItem, index) => {
        const productId = typeof orderItem.productId === "string" ? orderItem.productId : "";
        if (!productId || orderItem.serviceId)
          throw new JvgBackendError("Este pedido contém serviço ou item sem produto vinculado; o rascunho NF-e aceita somente mercadorias.", 400);
        const quantityMilli = Math.round(Number(orderItem.quantity) * 1000);
        const unitPriceCents = Math.round(Number(orderItem.unitPrice) * 100);
        if (productId !== draft.items[index].productId ||
            !Number.isSafeInteger(quantityMilli) || quantityMilli !== draft.items[index].quantityMilli ||
            !Number.isSafeInteger(unitPriceCents) || unitPriceCents !== draft.items[index].unitPriceCents)
          throw new JvgBackendError("Produtos, quantidades e preços devem permanecer iguais aos do pedido vinculado.", 400);
      });
      const orderTotalCents = Math.round(Number(sourceOrder.total) * 100);
      if (!Number.isSafeInteger(orderTotalCents) || orderTotalCents !== draft.totalCents)
        throw new JvgBackendError("O total do rascunho não corresponde ao total do pedido.", 400);
    }
    const [recipientRows, products] = await Promise.all([
      dbRequest<DbRow[]>(`/rest/v1/jvg_parties?${scoped}&id=${filterEq(draft.recipientId)}&is_customer=eq.true&active=eq.true&select=id,display_name,legal_name,document_type,document_number,state_registration,municipal_registration,email,phone,address&limit=1`),
      dbRequest<DbRow[]>(`/rest/v1/jvg_products?${scoped}&id=in.(${draft.items.map(i => i.productId).join(",")})&active=eq.true&select=id,sku,name,unit,ncm,cest,gtin,origin,tax_profile_id,sale_price`),
    ]);
    const recipient = recipientRows[0];
    if (!recipient) throw new JvgBackendError("Destinatário não pertence a esta empresa ou está inativo.", 400);
    const byId = new Map(products.map(product => [String(product.id), product]));
    if (draft.items.some(item => !byId.has(item.productId)))
      throw new JvgBackendError("Um ou mais produtos não pertencem à empresa ou estão inativos.", 400);

    const profileIds = [...new Set(products.map(product => String(product.tax_profile_id || '')).filter(Boolean))];
    const profiles = profileIds.length ? await dbRequest<DbRow[]>(`/rest/v1/jvg_tax_profiles?${scoped}&id=in.(${profileIds.join(',')})&document_type=eq.nfe&select=id,name,rules,review_status`) : [];
    const byProfile = new Map(profiles.map(profile => [String(profile.id), profile]));
    const pending: string[] = [];
    if (company.fiscal_missing.length) pending.push("Conferir dados fiscais do emitente");
    if (!recipient.document_number) pending.push("Documento CPF/CNPJ do destinatário não informado");
    const issuerAddress = company.address && typeof company.address === "object" ? company.address as DbRow : {};
    const recipientAddress = recipient.address && typeof recipient.address === "object" ? recipient.address as DbRow : {};
    const issuerUf = issuerAddress.state;
    const recipientUf = recipientAddress.state;
    const estimatedLines: Array<{ tax: string; amountCents: number }> = [];
    const items = draft.items.map((input, index) => {
      const product = byId.get(input.productId)!;
      if (!/^[0-9]{8}$/.test(String(product.ncm || ""))) pending.push(`Item ${index + 1}: NCM pendente`);
      if (!input.cfop) pending.push(`Item ${index + 1}: CFOP pendente`);
      else if (!isOfficialCfopCode(input.cfop)) pending.push(`Item ${index + 1}: CFOP não consta da tabela oficial`);
      if (!input.csosn) pending.push(`Item ${index + 1}: CSOSN pendente`);
      const review = reviewNfeOperation(issuerUf, recipientUf, input.cfop, index + 1);
      pending.push(...review.pending);
      const profile = product.tax_profile_id ? byProfile.get(String(product.tax_profile_id)) : undefined;
      if (!profile) pending.push(`Item ${index + 1}: perfil tributário não associado ou indisponível`);
      else {
        if (profile.review_status !== 'reviewed') pending.push(`Item ${index + 1}: perfil tributário ainda não revisado`);
        const rules = profile.rules && typeof profile.rules === "object" && !Array.isArray(profile.rules) ? profile.rules as DbRow : {};
        pending.push(...reviewProfileConsistency(rules, input.cfop, input.csosn, index + 1));
      }
      const rules = profile?.rules && typeof profile.rules === "object" && !Array.isArray(profile.rules) ? profile.rules as DbRow : {};
      const rawRates = rules.previewRates && typeof rules.previewRates === "object" && !Array.isArray(rules.previewRates) ? rules.previewRates as DbRow : {};
      const previewRates: PreviewRates = {};
      for (const tax of PREVIEW_TAXES) {
        try { const rate = parsePreviewRate(rawRates[tax]); if (rate !== null) previewRates[tax] = rate; }
        catch { pending.push(`Item ${index + 1}: alíquota ${tax.toUpperCase()} inválida no perfil`); }
      }
      const taxPreview = calculateTaxPreview(input.subtotalCents, previewRates);
      for (const line of taxPreview.lines) estimatedLines.push({ tax: line.tax, amountCents: line.estimateCents });
      if (taxPreview.lines.length) pending.push(`Item ${index + 1}: estimativas tributárias exigem conferência; não são impostos apurados`);
      return {
        productId: product.id, sku: product.sku, description: product.name,
        unit: product.unit, ncm: product.ncm, cest: product.cest, gtin: product.gtin, origin: product.origin,
        quantity: input.quantity, unitPriceCents: input.unitPriceCents,
        subtotalCents: input.subtotalCents, cfop: input.cfop, csosn: input.csosn,
        operation: review.operation, taxPreview,
        taxProfile: profile ? { id: profile.id, name: profile.name, reviewStatus: profile.review_status, rules: profile.rules } : null,
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
    const preflight = reviewNfePreparation(issuer, recipientSnapshot, items);
    pending.push(...preflight.issues);
    pending.push("Conferência tributária com contador: ICMS, PIS/Cofins, IBS/CBS e demais totalizadores");
    const taxPreview = {
      sumOfEstimatesCents: estimatedLines.reduce((sum, line) => sum + line.amountCents, 0),
      provisional: true, validForEmission: false, calculationMethod: "arithmetic_only",
    };

    const payload = {
      schemaVersion: 4, nature: draft.nature, purpose: "1",
      sourceOrder: sourceOrder ? {
        id: String(sourceOrder.id),
        number: "PED-" + String(sourceOrder.id).slice(0, 8).toUpperCase(),
        quoteId: String(sourceOrder.quote_id || ""), status: String(sourceOrder.status || ""),
      } : null,
      issuer, recipient: recipientSnapshot,
      items, totalCents: draft.totalCents, taxPreview, preflight, pending, readyToTransmit: false,
    };

    const existing = await dbRequest<Array<{ id: string; status: string; fiscal_payload: unknown }>>(
      `/rest/v1/jvg_fiscal_documents?${scope(account)}&document_type=eq.nfe&environment=eq.homologacao&idempotency_key=${filterEq(idempotencyKey)}&select=id,status,fiscal_payload&limit=1`,
    );
    if (existing[0]) {
      if (stableJson(existing[0].fiscal_payload) !== stableJson(payload))
        throw new JvgBackendError("Esta solicitação já foi usada com outros dados. Recarregue a página antes de salvar novamente.", 409);
      return apiJson({ ok: true, id: existing[0].id, status: existing[0].status,
        totalCents: draft.totalCents, pending, sourceOrderId: draft.sourceOrderId, transmissionEnabled: false }, 200);
    }
    const created = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_fiscal_documents", {
      method: "POST",
      body: JSON.stringify({
        tenant_id: account.tenant_id, company_id: account.company_id,
        document_type: "nfe", environment: "homologacao", status: "draft",
        idempotency_key: idempotencyKey, fiscal_payload: payload,
      }),
    });
    if (!created[0]?.id) throw new JvgBackendError("Não foi possível salvar o rascunho.", 502);
    return apiJson({ ok: true, id: created[0].id, status: "draft",
      totalCents: draft.totalCents, pending, sourceOrderId: draft.sourceOrderId, transmissionEnabled: false }, 201);
  } catch (error) { return safeError(error); }
}
