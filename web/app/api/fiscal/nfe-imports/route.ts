import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import {
  parseAuthorizedIssuedNfe, type IssuedNfeParty,
} from "../../../../lib/fiscal/issued-nfe-import";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

async function context() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return { user, account };
}

function scope(account: SiteAccount): string {
  return "tenant_id=" + filterEq(account.tenant_id) + "&company_id=" + filterEq(account.company_id);
}

function decodeXml(bytes: Uint8Array): string {
  const header = new TextDecoder("windows-1252").decode(bytes.slice(0, 300));
  const declaration = header.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i);
  const declared = (declaration?.[1] || "UTF-8").toLowerCase();
  const encodings: Record<string, string> = {
    "utf-8": "utf-8", utf8: "utf-8", "iso-8859-1": "windows-1252",
    latin1: "windows-1252", "windows-1252": "windows-1252",
    "utf-16": "utf-16le", "utf-16le": "utf-16le", "utf-16be": "utf-16be",
  };
  const encoding = encodings[declared];
  if (!encoding) throw new JvgBackendError("Codificação do XML não suportada.", 400);
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new JvgBackendError("Não foi possível ler o XML. Salve o arquivo em UTF-8 e tente novamente.", 400); }
}

function partyDocumentType(document: string): "cpf" | "cnpj" | null {
  const normalized = document.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[0-9]{11}$/.test(normalized)) return "cpf";
  if (/^[A-Z0-9]{14}$/.test(normalized)) return "cnpj";
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
  snapshot: IssuedNfeParty,
  role: "customer" | "carrier",
  legalName = "",
) {
  const documentType = partyDocumentType(snapshot.document);
  if (!documentType) return { id: null as string | null, created: false };
  const base = {
    tenant_id: account.tenant_id, company_id: account.company_id,
    display_name: snapshot.name || legalName || "Cadastro importado de NF-e",
    legal_name: legalName || snapshot.name || null,
    document_type: documentType, document_number: snapshot.document,
    state_registration: snapshot.stateRegistration || null,
    email: snapshot.email || null, phone: snapshot.phone || null, address: snapshot.address,
    is_customer: role === "customer", is_supplier: false, is_carrier: role === "carrier", active: true,
  };
  let matches = await findParty(account, documentType, snapshot.document);
  if (matches.length > 1)
    throw new JvgBackendError("Há cadastros duplicados com o documento do destinatário. Corrija Pessoas antes de importar esta NF-e.", 409);
  if (!matches.length) {
    try {
      const inserted = await dbRequest<Row[]>("/rest/v1/jvg_parties", {
        method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(base),
      });
      if (inserted[0]?.id) return { id: String(inserted[0].id), created: true };
    } catch (error) {
      matches = await findParty(account, documentType, snapshot.document);
      if (!matches.length) throw error;
    }
  }
  const existing = matches[0];
  if (!existing) throw new JvgBackendError("Não foi possível localizar o cadastro do documento fiscal.", 502);
  const patch: Row = {
    is_customer: existing.is_customer === true || role === "customer",
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
    method: "PATCH", body: JSON.stringify(patch),
  });
  return { id: String(existing.id), created: false };
}

export async function GET(request: Request) {
  try {
    const { account } = await context();
    const documentId = new URL(request.url).searchParams.get("xml");
    if (!documentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId))
      throw new JvgBackendError("Identificador de NF-e inválido.", 400);
    const rows = await dbRequest<Row[]>(
      "/rest/v1/jvg_fiscal_documents?" + scope(account) + "&id=" + filterEq(documentId) +
      "&document_type=eq.nfe&environment=eq.producao&select=document_number,access_key,imported_xml&limit=1",
    );
    const row = rows[0];
    if (!row || typeof row.imported_xml !== "string")
      throw new JvgBackendError("XML importado não encontrado nesta empresa.", 404);
    const safeName = String(row.document_number || row.access_key || "NF-e").replace(/[^A-Za-z0-9_-]/g, "_");
    return new Response(row.imported_xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"NFe-" + safeName + ".xml\"",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { user, account } = await context();
    if (account.role === "viewer") throw new JvgBackendError("Seu perfil não pode importar documentos fiscais.", 403);
    if (!(request.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data"))
      throw new JvgBackendError("Envie o arquivo XML e a confirmação pelo formulário.", 400);
    const form = await request.formData();
    const uploaded = form.get("xml");
    if (!(uploaded instanceof File)) throw new JvgBackendError("Selecione o XML autorizado da NF-e.", 400);
    if (uploaded.size < 1 || uploaded.size > 2_000_000)
      throw new JvgBackendError("O XML deve ter até 2 MB.", 413);
    if (!/\.xml$/i.test(uploaded.name) && !/xml/i.test(uploaded.type))
      throw new JvgBackendError("Envie somente o arquivo XML da NF-e.", 400);
    if (form.get("confirmedOfficialStatus") !== "true")
      throw new JvgBackendError("Confirme a consulta da chave e da autorização no portal oficial da SEFAZ.", 400);

    const company = await getCompany(account);
    const companyDocument = String(company?.cnpj || "");
    if (!company) throw new JvgBackendError("Empresa ativa não encontrada.", 404);
    const xml = decodeXml(new Uint8Array(await uploaded.arrayBuffer()));
    let parsed;
    try { parsed = parseAuthorizedIssuedNfe(xml, companyDocument); }
    catch (error) { throw new JvgBackendError(error instanceof Error ? error.message : "XML inválido.", 400); }

    const duplicates = await dbRequest<Row[]>(
      "/rest/v1/jvg_fiscal_documents?" + scope(account) + "&document_type=eq.nfe&access_key=" +
      filterEq(parsed.accessKey) + "&select=id,status&limit=1",
    );
    if (duplicates.length)
      throw new JvgBackendError("Esta chave de acesso já está registrada nesta empresa.", 409);

    const recipient = await ensurePartyRole(account, parsed.recipient, "customer");
    const carrier = parsed.carrier
      ? await ensurePartyRole(account, parsed.carrier, "carrier")
      : { id: null as string | null, created: false };
    const sourceFileName = uploaded.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "NF-e.xml";
    const fiscalPayload = {
      schemaVersion: 1,
      source: { kind: "authorized_xml_archive", fileName: sourceFileName, importedAt: new Date().toISOString() },
      issuer: { name: parsed.issuerName, cnpj: parsed.issuerDocument },
      recipient: {
        id: recipient.id, name: parsed.recipient.name, legalName: parsed.recipient.name,
        documentType: partyDocumentType(parsed.recipient.document),
        documentNumber: parsed.recipient.document, stateRegistration: parsed.recipient.stateRegistration,
        email: parsed.recipient.email, phone: parsed.recipient.phone, address: parsed.recipient.address,
      },
      transport: {
        carrier: parsed.carrier ? {
          id: carrier.id, name: parsed.carrier.name, documentNumber: parsed.carrier.document,
          stateRegistration: parsed.carrier.stateRegistration, address: parsed.carrier.address,
        } : null,
      },
      items: parsed.items,
      totalCents: Math.round(parsed.total * 100),
      fiscalData: parsed.fiscalData,
      authorization: {
        statusCode: parsed.statusCode, reason: parsed.statusReason,
        protocol: parsed.protocol, statusCheckedByUser: true,
      },
    };
    const providerResponse = {
      source: "authorized_xml_archive",
      status: "autorizado",
      status_sefaz: parsed.statusCode,
      mensagem_sefaz: parsed.statusReason,
      protocolo: parsed.protocol,
      importedAt: new Date().toISOString(),
    };
    const inserted = await dbRequest<Row[]>("/rest/v1/jvg_fiscal_documents", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        tenant_id: account.tenant_id, company_id: account.company_id,
        document_type: "nfe", environment: "producao", status: "authorized",
        series: parsed.series, document_number: Number(parsed.invoiceNumber),
        access_key: parsed.accessKey, idempotency_key: "authorized-xml-" + parsed.accessKey,
        recipient_party_id: recipient.id, recipient_document: parsed.recipient.document,
        carrier_party_id: carrier.id, carrier_document: parsed.carrier?.document || null,
        carrier_name: parsed.carrier?.name || null,
        fiscal_payload: fiscalPayload, provider_response: providerResponse,
        imported_xml: xml, issued_at: parsed.issuedAt, authorized_at: parsed.authorizedAt || parsed.issuedAt,
      }),
    });
    const id = String(inserted[0]?.id || "");
    if (!id) throw new JvgBackendError("O XML foi analisado, mas o ERP não retornou o identificador da NF-e.", 502);

    let eventLogged = true;
    try {
      await dbRequest("/rest/v1/jvg_fiscal_events", {
        method: "POST",
        body: JSON.stringify({
          tenant_id: account.tenant_id, company_id: account.company_id, fiscal_document_id: id,
          event_type: "authorization", status: "imported_authorized_xml",
          protocol: parsed.protocol || null,
          event_payload: {
            source: "authorized_xml_archive", environment: "producao",
            cStat: parsed.statusCode, statusCheckedByUser: true, importedBy: user.userId,
            originalFileName: sourceFileName, authorizationMessage: parsed.statusReason,
          },
        }),
      });
    } catch { eventLogged = false; }

    return apiJson({
      ok: true, id, number: parsed.invoiceNumber, accessKey: parsed.accessKey,
      itemCount: parsed.items.length, recipientMatched: !!recipient.id,
      recipientCreated: recipient.created, carrierMatched: !!carrier.id,
      eventLogged, source: "local_archive", focusImported: false,
    }, 201);
  } catch (error) { return safeError(error); }
}
