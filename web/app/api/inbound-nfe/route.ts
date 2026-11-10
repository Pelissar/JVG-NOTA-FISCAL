import { getJvgUser } from "../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../lib/jvg-backend";
import { parseAuthorizedInboundNfe, type InboundNfeItem, type InboundPartySnapshot } from "../../../lib/fiscal/inbound-nfe";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;

async function context() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return { user, account };
}

function scope(account: SiteAccount) {
  return "tenant_id=" + filterEq(account.tenant_id) + "&company_id=" + filterEq(account.company_id);
}

function validId(value: unknown, label: string) {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new JvgBackendError(label + " inválido.", 400);
  return value;
}

function decodeXml(bytes: Uint8Array): string {
  const header = new TextDecoder("windows-1252").decode(bytes.slice(0, 300));
  const declaration = header.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i);
  const declared = (declaration?.[1] || "UTF-8").toLowerCase();
  const encodings: Record<string, string> = {
    "utf-8": "utf-8", "utf8": "utf-8",
    "iso-8859-1": "windows-1252", "latin1": "windows-1252",
    "windows-1252": "windows-1252", "utf-16": "utf-16le",
    "utf-16le": "utf-16le", "utf-16be": "utf-16be",
  };
  const encoding = encodings[declared];
  if (!encoding) throw new JvgBackendError("Codificação do XML não suportada.", 400);
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new JvgBackendError("Não foi possível ler o XML. Salve o arquivo em UTF-8 e tente novamente.", 400); }
}

async function readDocument(account: SiteAccount, id: string) {
  const rows = await dbRequest<Row[]>(
    "/rest/v1/jvg_inbound_nfe_documents?" + scope(account) + "&id=" + filterEq(id) +
    "&select=id,status,access_key,invoice_number,series,issued_at,issuer_document,issuer_name,authorization_status,authorization_reason,total_amount,supplier_party_id,carrier_party_id,carrier_document,carrier_name,fiscal_data,items,created_at,received_at&limit=1",
  );
  if (!rows[0]) throw new JvgBackendError("NF-e de entrada não encontrada nesta empresa.", 404);
  return rows[0];
}

function partyDocumentType(document: string): "cpf" | "cnpj" | null {
  const normalized = document.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[0-9]{11}$/.test(normalized)) return "cpf";
  if (/^[A-Z0-9]{12}[0-9]{2}$/.test(normalized)) return "cnpj";
  return null;
}

function mergeAddress(existing: unknown, incoming: Record<string, string>) {
  const current = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Row : {};
  return Object.fromEntries(Object.entries(incoming).map(([key, value]) => [key, current[key] || value]));
}

async function findParty(account: SiteAccount, documentType: "cpf" | "cnpj", document: string) {
  return dbRequest<Row[]>(
    "/rest/v1/jvg_parties?" + scope(account) + "&document_type=" + filterEq(documentType) +
    "&document_number=" + filterEq(document) +
    "&select=id,display_name,legal_name,document_type,document_number,state_registration,email,phone,address,is_customer,is_supplier,is_carrier,active&limit=2",
  );
}

async function ensurePartyRole(
  account: SiteAccount,
  snapshot: InboundPartySnapshot,
  role: "supplier" | "carrier",
  legalName = "",
) {
  const documentType = partyDocumentType(snapshot.document);
  if (!documentType) return { id: null as string | null, created: false, active: false };
  const base = {
    tenant_id: account.tenant_id,
    company_id: account.company_id,
    display_name: snapshot.name || legalName || "Cadastro importado de NF-e",
    legal_name: legalName || snapshot.name || null,
    document_type: documentType,
    document_number: snapshot.document,
    state_registration: snapshot.stateRegistration || null,
    email: snapshot.email || null,
    phone: snapshot.phone || null,
    address: snapshot.address,
    is_customer: false,
    is_supplier: role === "supplier",
    is_carrier: role === "carrier",
    active: true,
  };
  let matches = await findParty(account, documentType, snapshot.document);
  if (matches.length > 1) throw new JvgBackendError("Há cadastros duplicados com o documento do emitente. Corrija Pessoas antes de importar esta NF-e.", 409);
  if (!matches.length) {
    try {
      const inserted = await dbRequest<Row[]>("/rest/v1/jvg_parties", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(base),
      });
      if (inserted[0]?.id) return { id: String(inserted[0].id), created: true, active: true };
    } catch (error) {
      // Uma importação paralela pode ter criado o mesmo documento; buscar novamente pela chave única.
      matches = await findParty(account, documentType, snapshot.document);
      if (!matches.length) throw error;
    }
  }
  const existing = matches[0];
  if (!existing) throw new JvgBackendError("Não foi possível localizar o cadastro fiscal do documento.", 502);
  const patch: Row = {
    is_supplier: existing.is_supplier === true || role === "supplier",
    is_carrier: existing.is_carrier === true || role === "carrier",
    updated_at: new Date().toISOString(),
  };
  if (!existing.display_name && base.display_name) patch.display_name = base.display_name;
  if (!existing.legal_name && base.legal_name) patch.legal_name = base.legal_name;
  if (!existing.state_registration && base.state_registration) patch.state_registration = base.state_registration;
  if (!existing.email && base.email) patch.email = base.email;
  if (!existing.phone && base.phone) patch.phone = base.phone;
  patch.address = mergeAddress(existing.address, snapshot.address);
  await dbRequest("/rest/v1/jvg_parties?" + scope(account) + "&id=" + filterEq(String(existing.id)), {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return { id: String(existing.id), created: false, active: existing.active === true };
}

export async function GET(request: Request) {
  try {
    const { account } = await context();
    const params = new URL(request.url).searchParams;
    const requestedId = params.get("id");
    if (requestedId) {
      const id = validId(requestedId, "Identificador");
      const rows = await dbRequest<Row[]>(
        "/rest/v1/jvg_inbound_nfe_documents?" + scope(account) + "&id=" + filterEq(id) +
        "&select=id,status,access_key,invoice_number,series,issued_at,issuer_document,issuer_name,destination_document,authorization_status,authorization_reason,total_amount,supplier_party_id,carrier_party_id,carrier_document,carrier_name,fiscal_data,items,xml_content,created_at,received_at&limit=1",
      );
      const row = rows[0];
      if (!row) throw new JvgBackendError("NF-e de entrada não encontrada nesta empresa.", 404);
      let fiscalData = row.fiscal_data && typeof row.fiscal_data === "object" ? row.fiscal_data : {};
      let items = Array.isArray(row.items) ? row.items as InboundNfeItem[] : [];
      if (!Object.keys(fiscalData as Row).length) {
        const parsed = parseAuthorizedInboundNfe(String(row.xml_content || ""), String(row.destination_document || ""));
        fiscalData = parsed.fiscalData;
        const savedByLine = new Map(items.map(item => [Number(item.lineNumber), item]));
        items = parsed.items.map(item => ({ ...item, ...(savedByLine.get(item.lineNumber) || {}) }));
      }
      return apiJson({ document: {
        id: row.id, status: row.status, accessKey: row.access_key, invoiceNumber: row.invoice_number,
        series: row.series || "", issuedAt: row.issued_at, issuerDocument: row.issuer_document,
        issuerName: row.issuer_name, destinationDocument: row.destination_document,
        authorizationStatus: row.authorization_status, authorizationReason: row.authorization_reason || "",
        total: Number(row.total_amount), supplierId: row.supplier_party_id || "",
        carrierId: row.carrier_party_id || "", carrierDocument: row.carrier_document || "",
        carrierName: row.carrier_name || "", fiscalData, items,
        createdAt: row.created_at, receivedAt: row.received_at,
      } });
    }
    const xmlId = params.get("xml");
    if (xmlId) {
      const id = validId(xmlId, "Identificador");
      const rows = await dbRequest<Row[]>(
        "/rest/v1/jvg_inbound_nfe_documents?" + scope(account) + "&id=" + filterEq(id) +
        "&select=invoice_number,access_key,xml_content&limit=1",
      );
      if (!rows[0]) throw new JvgBackendError("XML não encontrado nesta empresa.", 404);
      const invoiceNumber = String(rows[0].invoice_number).replace(/[^A-Za-z0-9_-]/g, "_");
      return new Response(String(rows[0].xml_content), {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"NFe-" + invoiceNumber + ".xml\"",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }
    const rows = await dbRequest<Row[]>(
      "/rest/v1/jvg_inbound_nfe_documents?" + scope(account) +
      "&select=id,status,access_key,invoice_number,series,issued_at,issuer_document,issuer_name,authorization_status,authorization_reason,total_amount,supplier_party_id,carrier_party_id,carrier_document,carrier_name,items,created_at,received_at&order=created_at.desc&limit=100",
    );
    return apiJson({ documents: rows.map(row => ({
      id: row.id, status: row.status, accessKey: row.access_key, invoiceNumber: row.invoice_number,
      series: row.series || "", issuedAt: row.issued_at, issuerDocument: row.issuer_document,
      issuerName: row.issuer_name, authorizationStatus: row.authorization_status,
      authorizationReason: row.authorization_reason || "", total: Number(row.total_amount),
      supplierId: row.supplier_party_id || "", carrierId: row.carrier_party_id || "",
      carrierDocument: row.carrier_document || "", carrierName: row.carrier_name || "", items: row.items,
      createdAt: row.created_at, receivedAt: row.received_at,
    })) });
  } catch (error) { return safeError(error); }
}

async function importXml(request: Request, account: SiteAccount, userId: string) {
  const form = await request.formData();
  const uploaded = form.get("xml");
  if (!(uploaded instanceof File)) throw new JvgBackendError("Selecione um arquivo XML da NF-e.", 400);
  if (uploaded.size < 1 || uploaded.size > 2_000_000) throw new JvgBackendError("O XML deve ter até 2 MB.", 413);
  if (!/\.xml$/i.test(uploaded.name) && !/xml/i.test(uploaded.type))
    throw new JvgBackendError("Envie somente o XML original da NF-e.", 400);

  const company = await getCompany(account);
  const companyDocument = String(company?.cnpj || company?.cpf || "");
  const xml = decodeXml(new Uint8Array(await uploaded.arrayBuffer()));
  let parsed;
  try { parsed = parseAuthorizedInboundNfe(xml, companyDocument); }
  catch (error) { throw new JvgBackendError(error instanceof Error ? error.message : "XML inválido.", 400); }

  const duplicate = await dbRequest<Row[]>(
    "/rest/v1/jvg_inbound_nfe_documents?" + scope(account) + "&access_key=" + filterEq(parsed.accessKey) + "&select=id&limit=1",
  );
  if (duplicate.length) throw new JvgBackendError("Esta chave de acesso já foi importada nesta empresa.", 409);

  const supplier = await ensurePartyRole(account, parsed.issuer, "supplier", String((parsed.fiscalData.infNFe.emit as Row | undefined)?.xNome || ""));
  if (!supplier.id) throw new JvgBackendError("Não foi possível associar ou cadastrar o fornecedor pelo CPF/CNPJ do XML.", 422);
  const carrier = parsed.carrier && partyDocumentType(parsed.carrier.document)
    ? await ensurePartyRole(account, parsed.carrier, "carrier")
    : { id: null as string | null, created: false, active: false };
  const products = await dbRequest<Row[]>(
    "/rest/v1/jvg_products?" + scope(account) + "&active=eq.true&select=id,gtin,tracks_stock&limit=5000",
  );
  const productsByGtin = new Map<string, Row[]>();
  for (const product of products) {
    const gtin = String(product.gtin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!gtin || gtin === "SEMGTIN") continue;
    productsByGtin.set(gtin, [...(productsByGtin.get(gtin) || []), product]);
  }
  const items = parsed.items.map(item => {
    const matches = productsByGtin.get(item.gtin) || [];
    const match = matches.length === 1 ? matches[0] : null;
    return { ...item, productId: match ? String(match.id) : null, trackStock: !!match && match.tracks_stock === true };
  });

  const inserted = await dbRequest<Row[]>("/rest/v1/jvg_inbound_nfe_documents", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      tenant_id: account.tenant_id, company_id: account.company_id,
      supplier_party_id: supplier.id,
      carrier_party_id: carrier.id,
      carrier_document: parsed.carrier?.document || null,
      carrier_name: parsed.carrier?.name || null,
      access_key: parsed.accessKey, invoice_number: parsed.invoiceNumber, series: parsed.series || null,
      issued_at: parsed.issuedAt, issuer_document: parsed.issuerDocument, issuer_name: parsed.issuerName,
      destination_document: parsed.destinationDocument, authorization_status: parsed.statusCode,
      authorization_reason: parsed.statusReason, total_amount: parsed.total, status: "draft",
      fiscal_data: parsed.fiscalData,
      items, xml_content: xml, imported_by: userId,
    }),
  });
  if (!inserted[0]?.id) throw new JvgBackendError("A NF-e foi analisada, mas não retornou identificador para conferência.", 502);
  return apiJson({ ok: true, id: inserted[0].id, itemCount: items.length, supplierMatched: true,
    supplierCreated: supplier.created, supplierActive: supplier.active, carrierMatched: !!carrier.id });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { user, account } = await context();
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para lançar NF-e de entrada.", 403);
    const type = request.headers.get("content-type") || "";
    if (type.toLowerCase().includes("multipart/form-data"))
      return await importXml(request, account, user.userId);

    const raw = await request.text();
    if (raw.length > 16_000) throw new JvgBackendError("Solicitação muito grande.", 413);
    let data: Row;
    try { data = JSON.parse(raw) as Row; }
    catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    if (data.action !== "confirm") throw new JvgBackendError("Ação de NF-e de entrada inválida.", 400);
    if (data.checkedOfficialStatus !== true)
      throw new JvgBackendError("Confirme que verificou a chave e a autorização na consulta oficial da NF-e.", 400);
    const id = validId(data.id, "Identificador");
    const doc = await readDocument(account, id);
    if (doc.status === "received") return apiJson({ ok: true, alreadyReceived: true });
    if (!doc.supplier_party_id) throw new JvgBackendError("Selecione o fornecedor antes de receber a NF-e.", 400);
    const items = Array.isArray(doc.items) ? doc.items as InboundNfeItem[] : [];
    if (items.some(item => item.trackStock && !item.productId))
      throw new JvgBackendError("Associe um produto a todos os itens que vão movimentar o estoque.", 400);

    const result = await dbRequest<Row>("/rest/v1/rpc/jvg_confirm_inbound_nfe", {
      method: "POST",
      body: JSON.stringify({
        p_tenant_id: account.tenant_id, p_company_id: account.company_id,
        p_document_id: id, p_actor_user_id: user.userId,
      }),
    });
    return apiJson({ ok: true, result });
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account } = await context();
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para alterar lançamento.", 403);
    const raw = await request.text();
    if (raw.length > 100_000) throw new JvgBackendError("Revisão muito grande.", 413);
    let data: Row;
    try { data = JSON.parse(raw) as Row; }
    catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    const id = validId(data.id, "Identificador");
    const doc = await readDocument(account, id);
    if (doc.status !== "draft") throw new JvgBackendError("Somente lançamentos pendentes podem ser alterados.", 409);

    const supplierId = data.supplierId ? validId(data.supplierId, "Fornecedor") : null;
    if (supplierId) {
      const suppliers = await dbRequest<Row[]>(
        "/rest/v1/jvg_parties?" + scope(account) + "&id=" + filterEq(supplierId) +
        "&is_supplier=eq.true&select=id,document_number,active&limit=1",
      );
      if (!suppliers[0] || (suppliers[0].active !== true && String(doc.supplier_party_id || "") !== supplierId))
        throw new JvgBackendError("Fornecedor não encontrado ou inativo nesta empresa.", 400);
      if (String(suppliers[0].document_number || "").toUpperCase() !== String(doc.issuer_document || "").toUpperCase())
        throw new JvgBackendError("O documento do fornecedor precisa corresponder ao emitente do XML.", 400);
    }

    if (!Array.isArray(data.items) || data.items.length !== (Array.isArray(doc.items) ? doc.items.length : -1))
      throw new JvgBackendError("A revisão precisa incluir todos os itens da NF-e.", 400);
    const original = new Map<number, InboundNfeItem>();
    for (const item of doc.items as InboundNfeItem[]) original.set(Number(item.lineNumber), item);
    const seen = new Set<number>();
    const requested = data.items as Row[];
    const productIds = requested.map(item => item.productId).filter((value): value is string => typeof value === "string" && !!value);
    if (productIds.some(productId => !uuidPattern.test(productId))) throw new JvgBackendError("Produto inválido.", 400);
    const uniqueIds = [...new Set(productIds)];
    let products: Row[] = [];
    if (uniqueIds.length) {
      products = await dbRequest<Row[]>(
        "/rest/v1/jvg_products?" + scope(account) + "&id=in.(" + uniqueIds.join(",") +
        ")&active=eq.true&select=id,tracks_stock&limit=5000",
      );
    }
    const productsById = new Map<string, Row>(products.map(product => [String(product.id), product] as const));
    const items = requested.map(requestedItem => {
      const lineNumber = Number(requestedItem.lineNumber);
      const line = original.get(lineNumber);
      if (!line || seen.has(lineNumber)) throw new JvgBackendError("Número de item repetido ou inexistente.", 400);
      seen.add(lineNumber);
      const productId = requestedItem.productId ? String(requestedItem.productId) : null;
      const trackStock = requestedItem.trackStock === true;
      if (trackStock && !productId) throw new JvgBackendError("Associe um produto antes de incluir item no estoque.", 400);
      if (productId && !productsById.has(productId)) throw new JvgBackendError("Produto não pertence a esta empresa ou está inativo.", 400);
      if (trackStock && productsById.get(productId as string)?.tracks_stock !== true)
        throw new JvgBackendError("O produto selecionado não está habilitado para controle de estoque.", 400);
      return { ...line, productId, trackStock };
    });
    await dbRequest("/rest/v1/jvg_inbound_nfe_documents?" + scope(account) + "&id=" + filterEq(id) + "&status=eq.draft", {
      method: "PATCH",
      body: JSON.stringify({ supplier_party_id: supplierId, items, updated_at: new Date().toISOString() }),
    });
    return apiJson({ ok: true });
  } catch (error) { return safeError(error); }
}
