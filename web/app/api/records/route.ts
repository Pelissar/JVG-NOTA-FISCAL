import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, positiveMoney, safeError, str, type SiteAccount } from "../../../lib/jvg-backend";
import { fiscalAddress, validCnpj } from "../../../lib/fiscal-company";
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
    const sku = str(input.sku, 40), name = str(input.name, 160);
    const ncm = str(input.ncm, 8), cest = str(input.cest, 7), origin = str(input.origin, 1);
    const defaultCfop = str(input.defaultCfop, 4);
    const taxProfileId = input.taxProfileId ? validUuid(input.taxProfileId) : null;
    if (!sku || !name) throw new JvgBackendError("SKU e descrição são obrigatórios.", 400);
    if (ncm && !/^\d{8}$/.test(ncm)) throw new JvgBackendError("NCM precisa ter 8 dígitos.", 400);
    if (cest && !/^\d{7}$/.test(cest)) throw new JvgBackendError("CEST precisa ter 7 dígitos.", 400);
    if (origin && !/^[0-8]$/.test(origin)) throw new JvgBackendError("Origem inválida.", 400);
    if (defaultCfop && !isOfficialCfopCode(defaultCfop)) throw new JvgBackendError("CFOP sugerido não existe na tabela oficial.", 400);
    return { ...base, sku, name, category: str(input.category, 80), unit: str(input.unit, 8) || "UN",
      ncm: ncm || null, cest: cest || null, gtin: str(input.gtin, 20) || "SEM GTIN", origin: origin || "0",
      default_cfop: defaultCfop || null, tax_profile_id: taxProfileId,
      cost_price: positiveMoney(input.cost ?? 0), sale_price: positiveMoney(input.price ?? 0), active: input.active !== false };
  }
  if (kind === "client") {
    const displayName = str(input.name, 160), type = input.type;
    const document = str(input.document, 22).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!displayName) throw new JvgBackendError("Nome é obrigatório.", 400);
    if (type === "PF" && document && !/^\d{11}$/.test(document))
      throw new JvgBackendError("Documento incompatível com o tipo de pessoa.", 400);
    if (type === "PJ" && document && !validCnpj(document))
      throw new JvgBackendError("CNPJ inválido: confira os caracteres e dígitos verificadores.", 400);
    const documentType = type === "PF" ? "cpf" : type === "EXT" ? "foreign" : "cnpj";
    return { ...base, display_name: displayName, document_type: documentType,
      document_number: document || null, email: str(input.email, 160) || null,
      phone: str(input.phone, 25) || null,
      address: fiscalAddress(input),
      is_customer: true, active: input.active !== false };
  }
  const code = str(input.code, 40), name = str(input.name, 160);
  if (!code || !name) throw new JvgBackendError("Código e descrição são obrigatórios.", 400);
  return { ...base, code, name, description: str(input.description, 255),
    national_service_code: str(input.lc116, 12) || null, nbs: str(input.nbs, 12) || null,
    sale_price: positiveMoney(input.price ?? 0), active: input.active !== false };
}

async function authenticatedAccount() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return account;
}

export async function GET() {
  try {
    const account = await authenticatedAccount();
    const scope = `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
    const [products, parties, services, movements, company] = await Promise.all([
      dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_products?${scope}&select=id,sku,name,category,unit,ncm,cest,gtin,origin,default_cfop,tax_profile_id,cost_price,sale_price,active&order=created_at.desc&limit=1000`),
      dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_parties?${scope}&is_customer=eq.true&select=id,display_name,document_type,document_number,email,phone,address,active&order=created_at.desc&limit=1000`),
      dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_services?${scope}&select=id,code,name,description,national_service_code,nbs,sale_price,active&order=created_at.desc&limit=1000`),
      dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_inventory_movements?${scope}&select=product_id,quantity_delta,reason,created_at&order=created_at.desc&limit=10000`),
      getCompany(account),
    ]);
    const balances = new Map<string, number>();
    for (const m of movements) {
      const key = String(m.product_id);
      balances.set(key, (balances.get(key) ?? 0) + Number(m.quantity_delta || 0));
    }
    return apiJson({ status: "ready", companyName: String(company?.trade_name || company?.legal_name || "Empresa piloto"),
      products: products.map(p => ({ id: p.id, sku: p.sku, name: p.name, category: p.category || "", unit: p.unit,
        ncm: p.ncm || "", cest: p.cest || "", gtin: p.gtin || "SEM GTIN", origin: p.origin || "0", defaultCfop: p.default_cfop || "", taxProfileId: p.tax_profile_id || "",
        cost: Number(p.cost_price), price: Number(p.sale_price), stock: balances.get(String(p.id)) || 0, active: p.active })),
      clients: parties.map(p => {
        const address = p.address && typeof p.address === "object" ? p.address as Record<string, unknown> : {};
        return { id: p.id, name: p.display_name, type: p.document_type === "cpf" ? "PF" : p.document_type === "foreign" ? "EXT" : "PJ",
          document: p.document_number || "", email: p.email || "", phone: p.phone || "",
          street: address.street || "", number: address.number || "", complement: address.complement || "",
          district: address.district || "", postalCode: address.postalCode || "", cityCode: address.cityCode || "",
          city: address.city || "", state: address.state || "", active: p.active };
      }),
      services: services.map(p => ({ id: p.id, code: p.code, name: p.name, description: p.description || "",
        lc116: p.national_service_code || "", nbs: p.nbs || "", price: Number(p.sale_price), active: p.active })),
      movements: movements.map(m => ({ productId: m.product_id, delta: Number(m.quantity_delta), reason: m.reason || "",
        at: m.created_at })),
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
    let savedId: string | undefined;
    if (data.id) {
      const id = validUuid(data.id);
      savedId = id;
      const { tenant_id: _tenantId, company_id: _companyId, ...update } = row;
      await dbRequest(`/rest/v1/${table}?id=${filterEq(id)}&tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`, {
        method: "PATCH", body: JSON.stringify({ ...update, updated_at: new Date().toISOString() }),
      });
    } else {
      const created = await dbRequest<Array<{ id: string }>>(`/rest/v1/${table}`, { method: "POST", body: JSON.stringify(row) });
      savedId = created[0]?.id;
    }
    return apiJson({ ok: true, id: savedId });
  } catch (error) { return safeError(error); }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await authenticatedAccount();
    const data = await request.json() as Record<string, unknown>;
    const kind = validKind(data.kind), id = validUuid(data.id);
    await dbRequest(`/rest/v1/${tableByKind[kind]}?id=${filterEq(id)}&tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`, {
      method: "PATCH", body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
    });
    return apiJson({ ok: true });
  } catch (error) { return safeError(error); }
}
