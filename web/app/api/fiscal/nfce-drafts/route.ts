import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError, type SiteAccount } from "../../../../lib/jvg-backend";
import { buildNfceHomologacaoPayload, type NfceItemInput, type NfcePaymentInput } from "../../../../lib/fiscal/nfce-payload";
import { focusReferenceForFiscalDocument } from "../../../../lib/focus/client";
import { focusRuntimeEnv } from "../../../../lib/focus/runtime-env";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;

async function account(): Promise<SiteAccount> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const site = await getSiteAccount(user, { requiredModule: "nfce" });
  if (!site) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  if (site.role === "viewer") throw new JvgBackendError("Seu perfil não prepara NFC-e.", 403);
  return site;
}

function canManageNfce(site: SiteAccount): boolean {
  return ["owner", "admin", "manager", "operator"].includes(String(site.member_role || site.role));
}

function scope(site: SiteAccount): string {
  return `tenant_id=${filterEq(site.tenant_id)}&company_id=${filterEq(site.company_id)}`;
}

function obj(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function simpleConfirmed(company: Row): boolean {
  return company.tax_regime_confirmed === true && ["simples_nacional", "1"].includes(String(company.tax_regime || "").trim().toLowerCase());
}

function operationForCfop(cfop: string): "interna" | "interestadual" {
  return cfop.startsWith("6") ? "interestadual" : "interna";
}

function profileRule(profile: Row | undefined, operation: "interna" | "interestadual"): Row {
  const rules = obj(profile?.rules);
  return obj(obj(rules.operations)[operation]);
}

function safeProviderResponse(value: unknown): Row {
  const source = obj(value);
  const allowed = ["status", "status_sefaz", "mensagem_sefaz", "ref", "chave_nfe", "numero", "serie", "protocolo",
    "numero_protocolo", "codigo_status", "erro", "mensagem", "caminho_xml_nota_fiscal", "caminho_danfe", "caminho_xml_cancelamento", "eventos"];
  const output: Row = {};
  for (const key of allowed) {
    const item = source[key];
    if (typeof item === "string" && item.length <= 2000) output[key] = item;
    else if (typeof item === "number" && Number.isFinite(item)) output[key] = item;
    else if (key === "eventos" && Array.isArray(item)) output[key] = item.slice(0, 30);
  }
  return output;
}

export async function GET() {
  try {
    const site = await account();
    const [documents, products, profiles, company] = await Promise.all([
      dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scope(site)}&document_type=eq.nfce&environment=eq.homologacao&select=id,status,document_number,series,access_key,focus_reference,provider_response,xml_storage_path,pdf_storage_path,fiscal_payload,created_at,updated_at&order=created_at.desc&limit=30`),
      dbRequest<Row[]>(`/rest/v1/jvg_products?${scope(site)}&active=eq.true&select=id,tax_profile_id,default_csosn,default_pis_cst,default_cofins_cst&limit=1000`),
      dbRequest<Row[]>(`/rest/v1/jvg_tax_profiles?${scope(site)}&document_type=eq.nfe&select=id,name,rules,review_status&order=created_at.desc&limit=200`),
      getCompany(site),
    ]);
    const pilotCompanyId = focusRuntimeEnv("JVG_FOCUS_PILOT_COMPANY_ID");
    const isJvgPilot = Boolean(pilotCompanyId && site.company_id === pilotCompanyId);
    return apiJson({
      environment: "homologacao",
      documents: documents.map(row => {
        const stored = obj(row.fiscal_payload);
        const publicRow = { ...row };
        delete publicRow.fiscal_payload;
        return {
          ...publicRow,
          totalCents: Number.isSafeInteger(stored.totalCents) ? stored.totalCents : 0,
          provider_response: safeProviderResponse(obj(row.provider_response).response),
        };
      }),
      productProfileIds: Object.fromEntries(products.map(product => [String(product.id), String(product.tax_profile_id || "")])),
      productTaxDefaults: Object.fromEntries(products.map(product => [String(product.id), {
        csosn: String(product.default_csosn || ""), pisCst: String(product.default_pis_cst || ""), cofinsCst: String(product.default_cofins_cst || ""),
      }])),
      profiles,
      capabilities: { canIssue: canManageNfce(site), canCancel: canManageNfce(site) },
      defaults: { isJvgPilot, simplesNacionalConfirmado: company ? simpleConfirmed(company) : false },
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const site = await account();
    if (!canManageNfce(site)) throw new JvgBackendError("Seu perfil pode consultar dados fiscais, mas não preparar ou alterar cupons.", 403);
    const body = await request.json() as Row;
    const company = await getCompany(site);
    if (!company) throw new JvgBackendError("Empresa emitente não encontrada.", 404);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length || rawItems.length > 20) throw new JvgBackendError("Informe de 1 a 20 itens para preparar a NFC-e.", 400);
    const productIds = rawItems.map(raw => cleanText(obj(raw).productId, 80));
    if (productIds.some(id => !uuidPattern.test(id))) throw new JvgBackendError("Selecione um produto cadastrado em cada item.", 400);
    const uniqueIds = [...new Set(productIds)];
    const products = await dbRequest<Row[]>(
      `/rest/v1/jvg_products?${scope(site)}&id=in.(${uniqueIds.join(",")})&active=eq.true&select=id,sku,name,ncm,cest,unit,origin,default_cfop,sale_price,tax_profile_id,default_csosn,default_pis_cst,default_cofins_cst&limit=20`,
    );
    const byId = new Map(products.map(product => [String(product.id), product]));
    if (productIds.some(id => !byId.has(id))) throw new JvgBackendError("Um produto não pertence a esta empresa ou está inativo. Atualize a seleção e tente novamente.", 400);
    const profileIds = [...new Set(products.map(product => cleanText(product.tax_profile_id, 80)).filter(Boolean))];
    const profiles = profileIds.length
      ? await dbRequest<Row[]>(`/rest/v1/jvg_tax_profiles?${scope(site)}&id=in.(${profileIds.join(",")})&document_type=eq.nfe&select=id,rules,review_status&limit=200`)
      : [];
    const byProfile = new Map(profiles.map(profile => [String(profile.id), profile]));
    const isPilotCompany = focusRuntimeEnv("JVG_FOCUS_PILOT_COMPANY_ID") === site.company_id;
    const canUseJvgDefault = isPilotCompany && simpleConfirmed(company);
    const rawNfeItems = rawItems.map(obj);
    const items: NfceItemInput[] = rawNfeItems.map((input, index) => {
      const product = byId.get(productIds[index])!;
      const cfop = cleanText(input.cfop, 4) || cleanText(product.default_cfop, 4);
      const operation = operationForCfop(cfop);
      const rule = profileRule(byProfile.get(String(product.tax_profile_id || "")), operation);
      const manual = new Set(Array.isArray(input.manualTaxFields)
        ? input.manualTaxFields.filter((field): field is string => typeof field === "string") : []);
      const entered = (key: string) => cleanText(input[key], key === "focusFields" ? 2000 : 20);
      const choose = (key: "csosn" | "pisCst" | "cofinsCst", fallback = "") => {
        if (manual.has(key)) return entered(key);
        const productDefault = key === "csosn" ? product.default_csosn : key === "pisCst" ? product.default_pis_cst : product.default_cofins_cst;
        return entered(key) || cleanText(productDefault, 20) || cleanText(rule[key], 20) || fallback;
      };
      const csosn = choose("csosn", canUseJvgDefault && ["5101", "5102"].includes(cfop) ? "102" : "");
      const pisCst = choose("pisCst");
      const cofinsCst = choose("cofinsCst");
      const productCest = cleanText(product.cest, 20).replace(/\D/g, "");
      const enteredCest = cleanText(input.cest, 20).replace(/\D/g, "");
      const focusFields = obj(input.focusFields);
      const profileFocusFields = obj(rule.focusFields);
      const mergedFocusFields: Row = { ...profileFocusFields, ...focusFields };
      if (Array.isArray(input.manualFocusFields)) {
        for (const field of input.manualFocusFields) {
          if (typeof field === "string" && !Object.hasOwn(focusFields, field)) delete mergedFocusFields[field];
        }
      }
      return {
        sku: cleanText(product.sku, 60), name: cleanText(product.name, 120),
        ncm: cleanText(input.ncm, 20) || cleanText(product.ncm, 20), cest: enteredCest || productCest,
        cfop, unit: cleanText(product.unit, 6), origin: cleanText(input.origin, 3) || cleanText(product.origin, 3),
        quantity: Number(input.quantity), unitPrice: Number(input.unitPrice ?? product.sale_price),
        csosn, pisCst, cofinsCst, focusFields: mergedFocusFields,
      };
    });
    const payments: NfcePaymentInput[] = (Array.isArray(body.payments) ? body.payments : []).slice(0, 20).map(value => {
      const payment = obj(value);
      return {
        method: cleanText(payment.method, 2),
        indicatorPayment: cleanText(payment.indicatorPayment, 1),
        amount: Number(payment.amount),
        description: cleanText(payment.description, 60),
        integrationType: cleanText(payment.integrationType, 1),
        acquirerCnpj: cleanText(payment.acquirerCnpj, 24),
        cardBrand: cleanText(payment.cardBrand, 2),
        authorization: cleanText(payment.authorization, 128),
      };
    });
    const built = buildNfceHomologacaoPayload({
      company,
      items,
      cpf: cleanText(body.cpf, 20),
      cnpj: cleanText(body.cnpj, 24),
      recipientName: cleanText(body.recipientName, 60),
      deliveryAddress: (() => {
        const address = obj(body.deliveryAddress);
        return {
          street: cleanText(address.street, 60),
          number: cleanText(address.number, 60),
          complement: cleanText(address.complement, 60),
          district: cleanText(address.district, 60),
          city: cleanText(address.city, 60),
          cityCode: cleanText(address.cityCode, 12),
          state: cleanText(address.state, 2).toUpperCase(),
          postalCode: cleanText(address.postalCode, 12),
        };
      })(),
      transporter: (() => {
        const transporter = obj(body.transporter);
        return {
          mode: cleanText(transporter.mode, 20),
          cpf: cleanText(transporter.cpf, 20),
          cnpj: cleanText(transporter.cnpj, 24),
          name: cleanText(transporter.name, 60),
          stateRegistration: cleanText(transporter.stateRegistration, 20),
          address: cleanText(transporter.address, 60),
          city: cleanText(transporter.city, 60),
          state: cleanText(transporter.state, 2).toUpperCase(),
        };
      })(),
      intermediaryIndicator: cleanText(body.intermediaryIndicator, 1),
      intermediaryCnpj: cleanText(body.intermediaryCnpj, 24),
      intermediaryId: cleanText(body.intermediaryId, 60),
      payments,
      changeAmount: Number(body.changeAmount || 0),
      naturezaOperacao: cleanText(body.naturezaOperacao, 60),
      localDestino: "1",
      presencaComprador: cleanText(body.presencaComprador, 1),
    });
    if (built.issues.length) return apiJson({ error: "A NFC-e não foi preparada. Corrija as pendências listadas.", issues: built.issues }, 400);
    const id = crypto.randomUUID();
    const reference = focusReferenceForFiscalDocument(id);
    const saved = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_fiscal_documents", {
      method: "POST",
      body: JSON.stringify({
        id, tenant_id: site.tenant_id, company_id: site.company_id,
        document_type: "nfce", environment: "homologacao", status: "draft",
        focus_reference: reference,
        idempotency_key: `nfce-${id}`,
        fiscal_payload: { schema: "jvg_nfce_homologacao_v2", payload: built.payload, totalCents: built.totalCents },
      }),
    });
    return apiJson({ ok: true, id: saved[0]?.id || id, reference, environment: "homologacao", totalCents: built.totalCents, issues: [] }, 201);
  } catch (error) { return safeError(error); }
}
