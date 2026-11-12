import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbCount, dbRequest, filterEq, getCompany, getDashboardSummary, getSiteAccount, isSameOrigin, JvgBackendError, positiveMoney, safeError, str, type SiteAccount } from "../../../lib/jvg-backend";
import { fiscalAddress, validCnpj } from "../../../lib/fiscal-company";
import { isValidCpf } from "../../../lib/fiscal/cpf";
import { isOfficialCfopCode } from "../../../lib/fiscal/cfop";

export const dynamic = "force-dynamic";

type RecordKind = "product" | "client" | "service";

const tableByKind: Record<RecordKind, string> = {
  product: "jvg_products", client: "jvg_parties", service: "jvg_services",
};

function validKind(input: unknown): RecordKind {
  if (input === "product" || input === "client" || input === "service") return input;
  throw new JvgBackendError("Tipo de cadastro inválido.", 400);
}

function validUuid(input: unknown): string {
  if (typeof input !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input))
    throw new JvgBackendError("Identificador inválido.", 400);
  return input;
}


function buildRow(kind: RecordKind, input: Record<string, unknown>, account: SiteAccount) {
  const base = { tenant_id: account.tenant_id, company_id: account.company_id };
  if (kind === "product") {
    const sku = str(input.sku, 40), name = str(input.name, 160), unit = str(input.unit, 8);
    const ncm = str(input.ncm, 8), cest = str(input.cest, 7), origin = str(input.origin, 1);
    const defaultCfop = str(input.defaultCfop, 4);
    const taxProfileId = input.taxProfileId ? validUuid(input.taxProfileId) : null;
    if (!sku || !name) throw new JvgBackendError("SKU e descrição são obrigatórios.", 400);
    if (!unit) throw new JvgBackendError("Unidade do produto é obrigatória.", 400);
    if (input.price === undefined || input.price === null || String(input.price).trim() === "") throw new JvgBackendError("Preço de venda é obrigatório; informe 0,00 se o item não tiver preço.", 400);
    if (ncm && !/^\d{8}$/.test(ncm)) throw new JvgBackendError("NCM precisa ter 8 dígitos.", 400);
    if (cest && !/^\d{7}$/.test(cest)) throw new JvgBackendError("CEST precisa ter 7 dígitos.", 400);
    if (origin && !/^[0-8]$/.test(origin)) throw new JvgBackendError("Origem inválida.", 400);
    if (defaultCfop && !isOfficialCfopCode(defaultCfop)) throw new JvgBackendError("CFOP sugerido não existe na tabela oficial.", 400);
    return { ...base, sku, name, category: str(input.category, 80), unit,
      ncm: ncm || null, cest: cest || null, gtin: str(input.gtin, 20) || "SEM GTIN", origin: origin || null,
      default_cfop: defaultCfop || null, tax_profile_id: taxProfileId,
      cost_price: positiveMoney(input.cost ?? 0), sale_price: positiveMoney(input.price ?? 0), active: input.active !== false };
  }
  if (kind === "client") {
    const displayName = str(input.name, 160), type = input.type;
    const document = str(input.document, 22).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!displayName) throw new JvgBackendError("Nome é obrigatório.", 400);
    if (type !== "PJ" && type !== "PF" && type !== "EXT") throw new JvgBackendError("Selecione um tipo de pessoa válido.", 400);
    if (type === "PF" && document && !isValidCpf(document))
      throw new JvgBackendError("CPF inválido: confira os dígitos verificadores.", 400);
    if (type === "PJ" && document && !validCnpj(document))
      throw new JvgBackendError("CNPJ inválido: confira os caracteres e dígitos verificadores.", 400);
    const documentType = type === "PF" ? "cpf" : type === "EXT" ? "foreign" : "cnpj";
    const isCustomer = input.isCustomer === true, isSupplier = input.isSupplier === true, isCarrier = input.isCarrier === true;
    if (!isCustomer && !isSupplier && !isCarrier) throw new JvgBackendError("Selecione ao menos um tipo de cadastro: cliente, fornecedor ou transportadora.", 400);
    if (isSupplier && type !== "EXT" && !document) throw new JvgBackendError("CPF/CNPJ é obrigatório para vincular fornecedor a NF-e de entrada.", 400);
    return { ...base, display_name: displayName, legal_name: str(input.legalName, 180) || null, document_type: documentType,
      document_number: document || null, state_registration: str(input.stateRegistration, 40) || null,
      municipal_registration: str(input.municipalRegistration, 40) || null, email: str(input.email, 160) || null,
      phone: str(input.phone, 25) || null,
      address: fiscalAddress(input),
      is_customer: isCustomer, is_supplier: isSupplier, is_carrier: isCarrier, active: input.active !== false };
  }
  const code = str(input.code, 40), name = str(input.name, 160);
  if (!code || !name) throw new JvgBackendError("Código e descrição são obrigatórios.", 400);
  if (input.price === undefined || input.price === null || String(input.price).trim() === "") throw new JvgBackendError("Preço do serviço é obrigatório; informe 0,00 se não houver cobrança.", 400);
  const nationalTaxationCode = typeof input.nationalTaxationCode === "string" ? input.nationalTaxationCode.trim() : "";
  if (nationalTaxationCode && !/^\d{6}$/.test(nationalTaxationCode))
    throw new JvgBackendError("O código nacional ISS deve ter 6 dígitos e ser informado pela contabilidade.", 400);
  return { ...base, code, name, description: str(input.description, 255),
    national_service_code: str(input.lc116, 12) || null, nbs: str(input.nbs, 12) || null,
    national_taxation_code: nationalTaxationCode || null,
    sale_price: positiveMoney(input.price ?? 0), active: input.active !== false };
}

async function authenticatedAccount() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return account;
}

export async function GET(request: Request) {
  try {
    const account = await authenticatedAccount();
    const scope = `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
    const requestedScope = new URL(request.url).searchParams.get("scope") || "full";
    const supportedScopes = ["dashboard", "products", "clients", "services", "inventory", "reports", "quotes", "sales", "orders", "documents", "full"];
    const dataScope = supportedScopes.includes(requestedScope) ? requestedScope : "full";

    const shouldTryDashboardRpc = dataScope === "dashboard" && new URL(request.url).searchParams.get("summary") !== "skip";
    if (shouldTryDashboardRpc) {
      try {
        const dashboard = await getDashboardSummary(account);
        return apiJson({ status: "ready", dashboardAvailable: true, dashboard: {
          productsCount: Number(dashboard.productsCount || 0),
          clientsCount: Number(dashboard.clientsCount || 0),
          unitsStock: Number(dashboard.unitsStock || 0),
          lowStockCount: Number(dashboard.lowStockCount || 0),
          stockValue: Number(dashboard.stockValue || 0),
          recentMovements: Array.isArray(dashboard.recentMovements) ? dashboard.recentMovements : [],
        } });
      } catch {
        // Mantém a tela funcional enquanto a migração do resumo agregado não for aplicada.
      }
    }

    const dashboardFallback = dataScope === "dashboard";
    const wantsProducts = ["full", "reports", "products", "inventory", "dashboard", "quotes", "sales"].includes(dataScope);
    const wantsParties = ["full", "reports", "clients", "quotes", "sales", "orders", "documents"].includes(dataScope);
    const wantsPartyCount = dashboardFallback;
    const wantsServices = ["full", "reports", "services", "quotes", "sales"].includes(dataScope);
    const wantsMovements = ["full", "reports", "products", "inventory", "dashboard"].includes(dataScope);
    const wantsCompany = ["full", "reports", "documents"].includes(dataScope);
    const emptyRows: Array<Record<string, unknown>> = [];
    const productFields = dashboardFallback ? "id,name,cost_price,active" : "id,sku,name,category,unit,ncm,cest,gtin,origin,default_cfop,tax_profile_id,cost_price,sale_price,tracks_stock,active";
    const [products, parties, services, movements, company, partyCount] = await Promise.all([
      wantsProducts
        ? dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_products?${scope}&select=${productFields}&order=created_at.desc&limit=1000`)
        : Promise.resolve(emptyRows),
      wantsParties
        ? dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_parties?${scope}&select=id,registration_number,display_name,legal_name,document_type,document_number,state_registration,municipal_registration,email,phone,address,is_customer,is_supplier,is_carrier,active&order=registration_number.desc&limit=5000`)
        : Promise.resolve(emptyRows),
      wantsServices
        ? dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_services?${scope}&select=id,code,name,description,national_service_code,national_taxation_code,nbs,sale_price,active&order=created_at.desc&limit=1000`)
          .catch(() => dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_services?${scope}&select=id,code,name,description,national_service_code,nbs,sale_price,active&order=created_at.desc&limit=1000`))
        : Promise.resolve(emptyRows),
      wantsMovements
        ? dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_inventory_movements?${scope}&select=product_id,quantity_delta,reason,created_at&order=created_at.desc&limit=10000`)
        : Promise.resolve(emptyRows),
      wantsCompany ? getCompany(account) : Promise.resolve(null),
      wantsPartyCount ? dbCount(`/rest/v1/jvg_parties?${scope}&select=id`) : Promise.resolve(null),
    ]);
    const balances = new Map<string, number>();
    for (const m of movements) {
      const key = String(m.product_id);
      balances.set(key, (balances.get(key) ?? 0) + Number(m.quantity_delta || 0));
    }
    const productRecords = products.map(p => ({ id: p.id, sku: p.sku, name: p.name, category: p.category || "", unit: p.unit,
      ncm: p.ncm || "", cest: p.cest || "", gtin: p.gtin || "SEM GTIN", origin: p.origin || "", defaultCfop: p.default_cfop || "", taxProfileId: p.tax_profile_id || "",
      cost: Number(p.cost_price), price: Number(p.sale_price), stock: balances.get(String(p.id)) || 0, tracksStock: p.tracks_stock !== false, active: p.active }));
    const clientRecords = parties.map(p => {
      const address = p.address && typeof p.address === "object" ? p.address as Record<string, unknown> : {};
      return { id: p.id, registrationNumber: p.registration_number, name: p.display_name, legalName: p.legal_name || "", stateRegistration: p.state_registration || "", municipalRegistration: p.municipal_registration || "", isCustomer: p.is_customer, isSupplier: p.is_supplier, isCarrier: p.is_carrier, type: p.document_type === "cpf" ? "PF" : p.document_type === "foreign" ? "EXT" : "PJ",
        document: p.document_number || "", email: p.email || "", phone: p.phone || "",
        street: address.street || "", number: address.number || "", complement: address.complement || "",
        district: address.district || "", postalCode: address.postalCode || "", cityCode: address.cityCode || "",
        city: address.city || "", state: address.state || "", active: p.active };
    });
    const serviceRecords = services.map(p => ({ id: p.id, code: p.code, name: p.name, description: p.description || "",
      lc116: p.national_service_code || "", nationalTaxationCode: p.national_taxation_code || "",
      nbs: p.nbs || "", price: Number(p.sale_price), active: p.active }));
    const movementRecords = movements.map(m => ({ productId: m.product_id, delta: Number(m.quantity_delta), reason: m.reason || "",
      at: m.created_at }));
    if (dashboardFallback) {
      const names = new Map<string, string>();
      for (const product of productRecords) names.set(String(product.id), String(product.name || "produto"));
      const recentMovements = movements.slice(0, 4).map(m => ({
        productId: String(m.product_id),
        delta: Number(m.quantity_delta || 0),
        reason: m.reason ? String(m.reason) : null,
        at: String(m.created_at || ""),
        name: names.get(String(m.product_id)) || "produto",
      }));
      return apiJson({ status: "ready", dashboardAvailable: false, dashboard: {
        productsCount: products.length,
        clientsCount: Number(partyCount || 0),
        unitsStock: productRecords.reduce((sum, p) => sum + Number(p.stock || 0), 0),
        lowStockCount: productRecords.filter(p => p.active && Number(p.stock) <= 10).length,
        stockValue: productRecords.reduce((sum, p) => sum + Number(p.stock || 0) * Number(p.cost || 0), 0),
        recentMovements,
      } });
    }
    if (dataScope === "products" || dataScope === "inventory") return apiJson({ status: "ready", products: productRecords });
    if (dataScope === "clients") return apiJson({ status: "ready", clients: clientRecords });
    if (dataScope === "services") return apiJson({ status: "ready", services: serviceRecords });
    if (dataScope === "quotes" || dataScope === "sales") return apiJson({ status: "ready", products: productRecords, clients: clientRecords, services: serviceRecords });
    if (dataScope === "orders") return apiJson({ status: "ready", clients: clientRecords });
    if (dataScope === "documents") return apiJson({ status: "ready", company: company ? {
      legalName: company.legal_name || "", tradeName: company.trade_name || "", cnpj: company.cnpj || "",
      stateRegistration: company.state_registration || "", municipalRegistration: company.municipal_registration || "",
      email: company.fiscal_email || "", phone: company.fiscal_phone || "", address: company.address || {},
    } : null, clients: clientRecords });

    return apiJson({ status: "ready", companyName: String(company?.trade_name || company?.legal_name || "Empresa piloto"),
      company: company ? {
        legalName: company.legal_name || "", tradeName: company.trade_name || "",
        cnpj: company.cnpj || "", stateRegistration: company.state_registration || "",
        municipalRegistration: company.municipal_registration || "",
        email: company.fiscal_email || "", phone: company.fiscal_phone || "",
        address: company.address || {},
      } : null,
      products: productRecords,
      clients: clientRecords,
      services: serviceRecords,
      movements: movementRecords,
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await authenticatedAccount();
    if (account.role === 'viewer') throw new JvgBackendError('Sem permissão para alterar cadastros.', 403);
    const data = await request.json() as Record<string, unknown>;
    const kind = validKind(data.kind);
    const record = data.record && typeof data.record === "object" ? data.record as Record<string, unknown> : {};
    const row = buildRow(kind, record, account);
    const table = tableByKind[kind];
    if (kind === "product" && "tax_profile_id" in row && row.tax_profile_id) {
      const profiles = await dbRequest<Array<{ id: string }>>(`/rest/v1/jvg_tax_profiles?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(String(row.tax_profile_id))}&document_type=eq.nfe&select=id&limit=1`);
      if (!profiles.length) throw new JvgBackendError("Perfil fiscal não pertence a esta empresa.", 400);
    }
    const save = async (body: Record<string, unknown>, id?: string) => {
      if (id) {
        const update = { ...body };
        delete update.tenant_id;
        delete update.company_id;
        await dbRequest(`/rest/v1/${table}?id=${filterEq(id)}&tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`, {
          method: "PATCH", body: JSON.stringify({ ...update, updated_at: new Date().toISOString() }),
        });
        return id;
      }
      const created = await dbRequest<Array<{ id: string }>>(`/rest/v1/${table}`, { method: "POST", body: JSON.stringify(body) });
      return created[0]?.id;
    };
    const id = data.id ? validUuid(data.id) : undefined;
    let savedId: string | undefined;
    try { savedId = await save(row, id); }
    catch (error) {
      // A ausência da migration não interrompe cadastros sem esse campo opcional.
      const nationalTaxationCode = (row as Record<string, unknown>).national_taxation_code;
      if (kind !== "service" || nationalTaxationCode !== null) throw error;
      const legacyRow = { ...row };
      delete (legacyRow as Record<string, unknown>).national_taxation_code;
      savedId = await save(legacyRow, id);
    }
    return apiJson({ ok: true, id: savedId });
  } catch (error) { return safeError(error); }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await authenticatedAccount();
    if (account.role === 'viewer') throw new JvgBackendError('Sem permissão para alterar cadastros.', 403);
    const data = await request.json() as Record<string, unknown>;
    const kind = validKind(data.kind), id = validUuid(data.id);
    await dbRequest(`/rest/v1/${tableByKind[kind]}?id=${filterEq(id)}&tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`, {
      method: "PATCH", body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
    });
    return apiJson({ ok: true });
  } catch (error) { return safeError(error); }
}
