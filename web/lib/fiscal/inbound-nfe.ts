import { XMLParser, XMLValidator } from "fast-xml-parser";

export type InboundNfeItem = {
  lineNumber: number;
  supplierCode: string;
  gtin: string;
  description: string;
  ncm: string;
  cest: string;
  cfop: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  productId: string | null;
  trackStock: boolean;
};

export type ParsedInboundNfe = {
  accessKey: string;
  invoiceNumber: string;
  series: string;
  issuedAt: string | null;
  issuerDocument: string;
  issuerName: string;
  destinationDocument: string;
  statusCode: string;
  statusReason: string;
  total: number;
  items: InboundNfeItem[];
};

type XmlObject = Record<string, unknown>;

function object(value: unknown): XmlObject {
  if (Array.isArray(value)) return object(value[0]);
  return value && typeof value === "object" ? value as XmlObject : {};
}

function value(parent: unknown, key: string): string {
  const item = object(parent)[key];
  if (typeof item === "string" || typeof item === "number") return String(item).trim();
  return "";
}

function normalizeTaxId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isTaxDocument(value: string): boolean {
  return /^[A-Z0-9]{12}[0-9]{2}$/.test(value) || /^[0-9]{11}$/.test(value);
}

function numeric(value: string, label: string, allowZero = true): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0) || parsed > 999999999999)
    throw new Error("Valor inválido em " + label + " no XML.");
  return parsed;
}

export function parseAuthorizedInboundNfe(xml: string, companyTaxId: string): ParsedInboundNfe {
  if (!xml.trim() || xml.length > 2_000_000) throw new Error("XML vazio ou acima do limite de 2 MB.");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error("XML com DTD ou entidade declarada não é aceito.");
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error("XML malformado; confira o arquivo recebido do fornecedor.");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
    processEntities: true,
    allowBooleanAttributes: false,
  });
  const root = object(parser.parse(xml));
  const process = object(root.nfeProc);
  if (!Object.keys(process).length) throw new Error("Envie o XML processado (nfeProc), com protocolo de autorização.");
  const invoice = object(process.NFe);
  const info = object(invoice.infNFe);
  const protocol = object(object(process.protNFe).infProt);
  if (!Object.keys(info).length || !Object.keys(protocol).length) throw new Error("XML sem NF-e e protocolo de autorização.");

  const statusCode = value(protocol, "cStat");
  if (statusCode !== "100" && statusCode !== "150")
    throw new Error("A NF-e não consta autorizada no protocolo informado (cStat " + (statusCode || "ausente") + ").");
  const keyFromProtocol = normalizeTaxId(value(protocol, "chNFe"));
  const id = value(info, "@_Id").replace(/^NFe/i, "");
  const accessKey = normalizeTaxId(keyFromProtocol || id);
  if (!/^[A-Z0-9]{44}$/.test(accessKey)) throw new Error("Chave de acesso da NF-e inválida ou ausente.");
  if (keyFromProtocol && id && keyFromProtocol !== normalizeTaxId(id)) throw new Error("Chave do protocolo difere da chave da NF-e.");

  const ide = object(info.ide);
  if (value(ide, "mod") !== "55") throw new Error("Este lançamento aceita NF-e modelo 55; NFC-e e outros documentos não são suportados.");
  if (value(ide, "tpAmb") !== "1") throw new Error("Somente NF-e autorizada em produção pode ser recebida no estoque.");
  const issuer = object(info.emit);
  const destination = object(info.dest);
  const issuerDocument = normalizeTaxId(value(issuer, "CNPJ") || value(issuer, "CPF"));
  const destinationDocument = normalizeTaxId(value(destination, "CNPJ") || value(destination, "CPF"));
  const expectedDocument = normalizeTaxId(companyTaxId);
  if (!isTaxDocument(expectedDocument)) throw new Error("Informe um CNPJ/CPF válido da empresa em Conta antes de importar NF-e de entrada.");
  if (!isTaxDocument(issuerDocument)) throw new Error("O XML não informa CPF/CNPJ válido do emitente.");
  if (!isTaxDocument(destinationDocument)) throw new Error("O XML não informa CPF/CNPJ válido do destinatário.");
  if (!destinationDocument || destinationDocument !== expectedDocument)
    throw new Error("O destinatário do XML não corresponde ao CNPJ/CPF da empresa ativa.");

  const rawDetails = Array.isArray(info.det) ? info.det : [info.det];
  if (!rawDetails.length || rawDetails.length > 500) throw new Error("A NF-e precisa conter de 1 a 500 itens.");
  const lineNumbers = new Set<number>();
  const items: InboundNfeItem[] = rawDetails.map(raw => {
    const line = object(raw);
    const product = object(line.prod);
    const lineNumberText = value(line, "@_nItem");
    const lineNumber = Number(lineNumberText);
    if (!/^[1-9][0-9]*$/.test(lineNumberText) || !Number.isSafeInteger(lineNumber) || lineNumber > 500)
      throw new Error("Número de item inválido no XML.");
    if (lineNumbers.has(lineNumber)) throw new Error("O XML contém número de item repetido.");
    lineNumbers.add(lineNumber);
    const quantity = numeric(value(product, "qCom"), "quantidade", false);
    return {
      lineNumber,
      supplierCode: value(product, "cProd").slice(0, 60),
      gtin: normalizeTaxId(value(product, "cEAN") || value(product, "cEANTrib")),
      description: value(product, "xProd").slice(0, 255),
      ncm: value(product, "NCM"),
      cest: value(product, "CEST"),
      cfop: value(product, "CFOP"),
      unit: value(product, "uCom").slice(0, 8),
      quantity,
      unitPrice: numeric(value(product, "vUnCom"), "valor unitário"),
      total: numeric(value(product, "vProd"), "total do item"),
      productId: null,
      trackStock: false,
    };
  });
  if (items.some(item => !item.description || !item.unit)) throw new Error("Há item sem descrição ou unidade no XML.");

  const invoiceNumber = value(ide, "nNF");
  if (!/^[0-9]{1,30}$/.test(invoiceNumber)) throw new Error("Número da NF-e ausente ou inválido no XML.");
  const issuerName = value(issuer, "xNome").slice(0, 180);
  if (!issuerName) throw new Error("O XML não informa o nome do emitente.");
  const rawTotal = value(object(info.total).ICMSTot, "vNF");
  if (!rawTotal) throw new Error("O XML não informa o valor total da NF-e.");
  const issuedAt = value(ide, "dhEmi") || value(ide, "dEmi") || null;
  if (issuedAt && Number.isNaN(Date.parse(issuedAt))) throw new Error("Data de emissão inválida no XML.");
  return {
    accessKey,
    invoiceNumber,
    series: value(ide, "serie").slice(0, 10),
    issuedAt,
    issuerDocument,
    issuerName,
    destinationDocument,
    statusCode,
    statusReason: value(protocol, "xMotivo").slice(0, 255),
    total: numeric(rawTotal, "valor total"),
    items,
  };
}
