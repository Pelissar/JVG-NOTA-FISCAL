import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getSiteAccount, JvgBackendError,
  safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import { parseAuthorizedInboundNfe, type InboundNfeItem } from "../../../../lib/fiscal/inbound-nfe";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fiscalStatuses = new Set(["draft", "waiting_certificate", "queued", "processing", "authorized", "rejected", "cancelled", "denied", "contingency"]);

async function context(): Promise<SiteAccount> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return account;
}

function scope(account: SiteAccount): string {
  return "tenant_id=" + filterEq(account.tenant_id) + "&company_id=" + filterEq(account.company_id);
}

function queryDates(params: URLSearchParams) {
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T00:00:00Z");
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (from && !validDate(from)) throw new JvgBackendError("Data inicial inválida.", 400);
  if (to && !validDate(to)) throw new JvgBackendError("Data final inválida.", 400);
  if (from && to && from > to) throw new JvgBackendError("A data inicial precisa ser anterior à final.", 400);
  return (from ? "&issued_at=gte." + encodeURIComponent(from + "T00:00:00.000Z") : "") +
    (to ? "&issued_at=lte." + encodeURIComponent(to + "T23:59:59.999Z") : "");
}

function partyFilter(partyId: string, columns: [string, string]) {
  if (!partyId) return "";
  const expression = "(" + columns.map(column => column + ".eq." + partyId).join(",") + ")";
  return "&or=" + encodeURIComponent(expression);
}

function parsedJson(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function safeSearch(value: string): string {
  return value.trim().slice(0, 80).replace(/[,*()%_\\]/g, " ").replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  try {
    const account = await context();
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const direction = params.get("direction") || "";
    if (id) {
      if (!uuidPattern.test(id)) throw new JvgBackendError("Identificador de documento inválido.", 400);
      if (direction === "incoming") {
        const rows = await dbRequest<Row[]>(
          "/rest/v1/jvg_inbound_nfe_documents?" + scope(account) + "&id=" + filterEq(id) +
          "&select=id,status,access_key,invoice_number,series,issued_at,issuer_document,issuer_name,destination_document,authorization_status,authorization_reason,total_amount,supplier_party_id,carrier_party_id,carrier_document,carrier_name,fiscal_data,items,xml_content,created_at,received_at&limit=1",
        );
        const row = rows[0];
        if (!row) throw new JvgBackendError("NF-e recebida não encontrada nesta empresa.", 404);
        let fiscalData = parsedJson(row.fiscal_data);
        let items = Array.isArray(row.items) ? row.items as InboundNfeItem[] : [];
        if (!Object.keys(fiscalData).length) {
          const parsed = parseAuthorizedInboundNfe(String(row.xml_content || ""), String(row.destination_document || ""));
          fiscalData = parsed.fiscalData;
          const savedByLine = new Map(items.map(item => [Number(item.lineNumber), item]));
          items = parsed.items.map(item => ({ ...item, ...(savedByLine.get(item.lineNumber) || {}) }));
        }
        return apiJson({ document: {
          id: row.id, direction: "incoming", status: row.status, environment: "produção (XML recebido)",
          documentType: "NF-e 55", accessKey: row.access_key, invoiceNumber: row.invoice_number,
          series: row.series || "", issuedAt: row.issued_at, issuerDocument: row.issuer_document,
          issuerName: row.issuer_name, destinationDocument: row.destination_document,
          authorizationStatus: row.authorization_status, authorizationReason: row.authorization_reason || "",
          total: Number(row.total_amount), supplierPartyId: row.supplier_party_id || "",
          carrierPartyId: row.carrier_party_id || "", carrierDocument: row.carrier_document || "",
          carrierName: row.carrier_name || "", fiscalData, items,
        } });
      }
      if (direction === "outgoing") {
        const rows = await dbRequest<Row[]>(
          "/rest/v1/jvg_fiscal_documents?" + scope(account) + "&id=" + filterEq(id) +
          "&select=id,document_type,environment,status,series,document_number,access_key,focus_reference,recipient_party_id,recipient_document,carrier_party_id,carrier_document,carrier_name,fiscal_payload,provider_response,issued_at,authorized_at,created_at&limit=1",
        );
        const row = rows[0];
        if (!row) throw new JvgBackendError("Documento fiscal emitido/preparado não encontrado nesta empresa.", 404);
        const payload = parsedJson(row.fiscal_payload);
        const providerResponse = parsedJson(row.provider_response);
        const source = parsedJson(payload.source);
        return apiJson({ document: {
          id: row.id, direction: "outgoing", status: row.status, environment: row.environment,
          documentType: row.document_type, accessKey: row.access_key || "", invoiceNumber: row.document_number || "",
          series: row.series || "", reference: row.focus_reference || "", issuedAt: row.authorized_at || row.issued_at || row.created_at,
          recipientPartyId: row.recipient_party_id || "", recipientDocument: row.recipient_document || "",
          recipient: payload.recipient || null, carrierPartyId: row.carrier_party_id || "",
          carrierDocument: row.carrier_document || "", carrierName: row.carrier_name || "",
          transport: payload.transport || null, total: Number(payload.totalCents || 0) / 100,
          hasImportedXml: source.kind === "authorized_xml_archive",
          providerResponse: Object.fromEntries(
            ["status", "status_sefaz", "mensagem_sefaz", "protocolo", "numero_protocolo", "caminho_xml_nota_fiscal", "caminho_danfe"]
              .filter(key => providerResponse[key] !== undefined)
              .map(key => [key, providerResponse[key]]),
          ),
          fiscalData: payload, sourceOrder: payload.sourceOrder || null,
        } });
      }
      throw new JvgBackendError("Informe se a nota é recebida ou emitida.", 400);
    }

    const kind = params.get("kind") || "all";
    if (!(kind === "all" || kind === "incoming" || kind === "outgoing"))
      throw new JvgBackendError("Tipo de histórico inválido.", 400);
    const partyId = params.get("partyId") || "";
    if (partyId && !uuidPattern.test(partyId)) throw new JvgBackendError("Pessoa inválida para filtrar o histórico.", 400);
    const status = params.get("status") || "";
    if (status && status !== "received" && !fiscalStatuses.has(status)) throw new JvgBackendError("Situação inválida.", 400);
    const documentType = params.get("documentType") || "";
    if (documentType && !["nfe", "nfce", "nfse", "cte", "mdfe"].includes(documentType))
      throw new JvgBackendError("Tipo de documento inválido.", 400);
    const environment = params.get("environment") || "";
    if (environment && environment !== "homologacao" && environment !== "producao")
      throw new JvgBackendError("Ambiente fiscal inválido.", 400);
    const number = params.get("number") || "";
    if (number && !/^[0-9]{1,15}$/.test(number)) throw new JvgBackendError("Número da NF-e inválido.", 400);
    const customer = safeSearch(params.get("customer") || "");
    if (params.has("customer") && customer.length < 2)
      throw new JvgBackendError("Digite ao menos dois caracteres para pesquisar o cliente.", 400);
    const cfop = params.get("cfop") || "";
    if (cfop && !/^[0-9]{4}$/.test(cfop)) throw new JvgBackendError("CFOP deve ter quatro dígitos.", 400);
    if ((documentType || environment || number || customer || cfop) && kind !== "outgoing")
      throw new JvgBackendError("Os filtros de NF-e emitida exigem o movimento de saída.", 400);
    const pageText = params.get("page") || "1";
    if (!/^[1-9][0-9]{0,4}$/.test(pageText)) throw new JvgBackendError("Página inválida.", 400);
    const page = Number(pageText);
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    const dates = queryDates(params);
    const includeInbound = kind !== "outgoing" && (!status || ["received", "draft", "authorized"].includes(status));
    const includeOutbound = kind !== "incoming" && status !== "received";
    const incomingStatus = status === "received" || status === "draft" ? "&status=" + filterEq(status) : "";
    const outgoingStatus = status && status !== "received" && includeOutbound ? "&status=" + filterEq(status) : "";
    let customerFilter = "";
    let customerHasNoMatches = false;
    if (customer) {
      const pattern = encodeURIComponent("ilike.*" + customer + "*");
      const partyRows = await dbRequest<Row[]>(
        "/rest/v1/jvg_parties?" + scope(account) + "&is_customer=eq.true&or=" +
        encodeURIComponent("(display_name." + decodeURIComponent(pattern) + ",legal_name." + decodeURIComponent(pattern) + ")") +
        "&select=id&limit=500",
      );
      const ids = [...new Set(partyRows.map(row => String(row.id)).filter(id => uuidPattern.test(id)))];
      if (!ids.length) customerHasNoMatches = true;
      else customerFilter = "&recipient_party_id=in.(" + ids.join(",") + ")";
    }
    const documentNumberFilter = number ? "&document_number=" + filterEq(number) : "";
    const documentTypeFilter = documentType ? "&document_type=" + filterEq(documentType) : "&document_type=in.(nfe,nfce,nfse,cte,mdfe)";
    const environmentFilter = environment ? "&environment=" + filterEq(environment) : "";
    const cfopFilter = cfop
      ? "&fiscal_payload=cs." + encodeURIComponent(JSON.stringify({ items: [{ cfop }] }))
      : "";
    const incoming = !includeInbound ? Promise.resolve([] as Row[]) : dbRequest<Row[]>(
      "/rest/v1/jvg_inbound_nfe_documents?" + scope(account) +
      "&select=id,status,access_key,invoice_number,series,issued_at,issuer_document,issuer_name,authorization_status,authorization_reason,total_amount,supplier_party_id,carrier_party_id,carrier_document,carrier_name,created_at,received_at" +
      incomingStatus + dates + partyFilter(partyId, ["supplier_party_id", "carrier_party_id"]) +
      "&order=issued_at.desc.nullslast,created_at.desc&limit=" + pageSize + "&offset=" + offset,
    );
    const outgoing = !includeOutbound || customerHasNoMatches ? Promise.resolve([] as Row[]) : dbRequest<Row[]>(
      "/rest/v1/jvg_fiscal_documents?" + scope(account) +
      documentTypeFilter + environmentFilter +
      "&select=id,document_type,environment,status,series,document_number,access_key,focus_reference,recipient_party_id,recipient_document,carrier_party_id,carrier_document,carrier_name,fiscal_payload,issued_at,authorized_at,created_at" +
      outgoingStatus + dates + documentNumberFilter + customerFilter + cfopFilter +
      partyFilter(partyId, ["recipient_party_id", "carrier_party_id"]) +
      "&order=authorized_at.desc.nullslast,issued_at.desc.nullslast,created_at.desc&limit=" + pageSize + "&offset=" + offset,
    );
    const [inboundRows, outboundRows] = await Promise.all([incoming, outgoing]);
    const documents = [
      ...inboundRows.map(row => ({
        id: row.id, direction: "incoming", status: row.status, environment: "produção",
        documentType: "NF-e 55", number: row.invoice_number || "", series: row.series || "",
        accessKey: row.access_key || "", date: row.issued_at || row.created_at,
        total: Number(row.total_amount || 0), contactPartyId: row.supplier_party_id || "",
        contactName: row.issuer_name || "Fornecedor", contactDocument: row.issuer_document || "",
        carrierPartyId: row.carrier_party_id || "", carrierName: row.carrier_name || "",
        carrierDocument: row.carrier_document || "", authorizationStatus: row.authorization_status || "",
      })),
      ...outboundRows.map(row => {
        const payload = parsedJson(row.fiscal_payload);
        const recipient = parsedJson(payload.recipient);
        const transport = parsedJson(payload.transport);
        const carrier = parsedJson(transport.carrier);
        const source = parsedJson(payload.source);
        const items = Array.isArray(payload.items) ? payload.items.map(parsedJson) : [];
        const environment = row.environment === "producao" ? "produção" : "homologação";
        const typeNames: Record<string, string> = { nfe: "NF-e 55", nfce: "NFC-e 65", nfse: "NFS-e", cte: "CT-e", mdfe: "MDF-e" };
        return {
          id: row.id, direction: "outgoing", status: row.status, environment,
          documentType: typeNames[String(row.document_type)] || String(row.document_type),
          number: row.document_number || "", series: row.series || "", accessKey: row.access_key || "",
          date: row.authorized_at || row.issued_at || row.created_at,
          total: Number(payload.totalCents || 0) / 100,
          contactPartyId: row.recipient_party_id || recipient.id || "",
          contactName: recipient.name || recipient.legalName || "Destinatário",
          contactDocument: row.recipient_document || recipient.documentNumber || "",
          carrierPartyId: row.carrier_party_id || carrier.id || "",
          carrierName: row.carrier_name || carrier.name || "",
          carrierDocument: row.carrier_document || carrier.documentNumber || "",
          cfop: items.find(item => typeof item.cfop === "string" && item.cfop)?.cfop || "",
          hasImportedXml: source.kind === "authorized_xml_archive",
          authorizationStatus: "",
        };
      }),
    ].sort((left, right) => Date.parse(String(right.date || "")) - Date.parse(String(left.date || "")));
    return apiJson({ documents, page, pageSize, hasMore: inboundRows.length === pageSize || outboundRows.length === pageSize });
  } catch (error) { return safeError(error); }
}

