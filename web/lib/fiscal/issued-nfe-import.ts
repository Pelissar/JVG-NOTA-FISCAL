import { XMLParser, XMLValidator } from "fast-xml-parser";

type XmlObject = Record<string, unknown>;

export type IssuedNfeParty = {
  name: string;
  document: string;
  stateRegistration: string;
  email: string;
  phone: string;
  address: Record<string, string>;
};

export type IssuedNfeItem = {
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
  taxes: XmlObject | null;
};

export type ParsedIssuedNfe = {
  accessKey: string;
  invoiceNumber: string;
  series: string;
  issuedAt: string | null;
  authorizedAt: string | null;
  issuerDocument: string;
  issuerName: string;
  recipient: IssuedNfeParty;
  carrier: IssuedNfeParty | null;
  statusCode: string;
  statusReason: string;
  protocol: string;
  total: number;
  cfop: string;
  fiscalData: { schemaVersion: 1; infNFe: XmlObject; protocol: XmlObject };
  items: IssuedNfeItem[];
};

function object(value: unknown): XmlObject {
  if (Array.isArray(value)) return object(value[0]);
  return value && typeof value === "object" ? value as XmlObject : {};
}

function value(parent: unknown, key: string): string {
  const item = object(parent)[key];
  if (typeof item === "string" || typeof item === "number") return String(item).trim();
  return "";
}

function normalizeDocument(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function numeric(raw: string, label: string, allowZero = true): number {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(raw))
    throw new Error("Valor inválido em " + label + " no XML.");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0) || parsed > 999999999999)
    throw new Error("Valor inválido em " + label + " no XML.");
  return parsed;
}

function party(valueNode: unknown, addressNode: unknown, nameField: string): IssuedNfeParty {
  const person = object(valueNode);
  const address = object(addressNode);
  return {
    name: value(person, nameField).slice(0, 180),
    document: normalizeDocument(value(person, "CNPJ") || value(person, "CPF")),
    stateRegistration: value(person, "IE").slice(0, 40),
    email: value(person, "email").slice(0, 160),
    phone: value(address, "fone").slice(0, 25),
    address: {
      street: value(address, "xLgr").slice(0, 160),
      number: value(address, "nro").slice(0, 20),
      complement: value(address, "xCpl").slice(0, 100),
      district: value(address, "xBairro").slice(0, 100),
      cityCode: value(address, "cMun").slice(0, 7),
      city: value(address, "xMun").slice(0, 100),
      state: value(address, "UF").slice(0, 2).toUpperCase(),
      postalCode: value(address, "CEP").replace(/\D/g, "").slice(0, 8),
      country: value(address, "xPais").slice(0, 60),
    },
  };
}

function validTaxDocument(value: string): boolean {
  return /^[A-Z0-9]{14}$/.test(value) || /^[0-9]{11}$/.test(value);
}

export function parseAuthorizedIssuedNfe(xml: string, companyTaxId: string): ParsedIssuedNfe {
  if (!xml.trim() || Buffer.byteLength(xml, "utf8") > 2_000_000)
    throw new Error("XML vazio ou acima do limite de 2 MB.");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
    throw new Error("XML com DTD ou entidade declarada não é aceito.");
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error("XML malformado; confira o arquivo original da NF-e.");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
    processEntities: true,
    allowBooleanAttributes: false,
  });
  const process = object(object(parser.parse(xml)).nfeProc);
  if (!Object.keys(process).length)
    throw new Error("Envie o XML processado (nfeProc), com protocolo de autorização.");
  const info = object(object(process.NFe).infNFe);
  const protocol = object(object(process.protNFe).infProt);
  if (!Object.keys(info).length || !Object.keys(protocol).length)
    throw new Error("XML sem NF-e e protocolo de autorização.");

  const statusCode = value(protocol, "cStat");
  if (statusCode !== "100" && statusCode !== "150")
    throw new Error("A NF-e não consta autorizada no protocolo informado (cStat " + (statusCode || "ausente") + ").");
  const accessKey = normalizeDocument(value(protocol, "chNFe") || value(info, "@_Id").replace(/^NFe/i, ""));
  const keyFromInfo = normalizeDocument(value(info, "@_Id").replace(/^NFe/i, ""));
  if (!/^[A-Z0-9]{44}$/.test(accessKey))
    throw new Error("Chave de acesso da NF-e inválida ou ausente.");
  if (!keyFromInfo)
    throw new Error("O XML não informa a chave da NF-e no identificador infNFe.");
  if (keyFromInfo && keyFromInfo !== accessKey)
    throw new Error("Chave do protocolo difere da chave da NF-e.");

  const ide = object(info.ide);
  if (value(ide, "mod") !== "55")
    throw new Error("Este fluxo aceita somente NF-e modelo 55.");
  if (value(ide, "tpAmb") !== "1")
    throw new Error("Somente NF-e autorizada em produção pode ser arquivada aqui.");

  const issuer = object(info.emit);
  const destination = object(info.dest);
  const issuerDocument = normalizeDocument(value(issuer, "CNPJ") || value(issuer, "CPF"));
  const destinationDocument = normalizeDocument(value(destination, "CNPJ") || value(destination, "CPF"));
  const expectedDocument = normalizeDocument(companyTaxId);
  if (!/^[A-Z0-9]{14}$/.test(expectedDocument))
    throw new Error("Informe o CNPJ da empresa ativa antes de importar uma NF-e emitida.");
  if (!/^[A-Z0-9]{14}$/.test(issuerDocument) || issuerDocument !== expectedDocument)
    throw new Error("O CNPJ emitente do XML não corresponde à empresa ativa.");
  if (accessKey.slice(6, 20) !== issuerDocument)
    throw new Error("O CNPJ do emitente difere do CNPJ registrado na chave de acesso.");
  if (accessKey.slice(20, 22) !== "55")
    throw new Error("O modelo informado na chave de acesso não é NF-e 55.");
  if (!validTaxDocument(destinationDocument))
    throw new Error("O XML não informa CPF/CNPJ válido do destinatário.");

  const invoiceNumber = value(ide, "nNF");
  const series = value(ide, "serie");
  if (!/^[0-9]{1,9}$/.test(invoiceNumber) || Number(invoiceNumber) < 1)
    throw new Error("Número da NF-e ausente ou inválido no XML.");
  if (!/^[0-9]{1,3}$/.test(series) || Number(series) < 1)
    throw new Error("Série ausente ou inválida no XML.");
  if (accessKey.slice(22, 25) !== series.padStart(3, "0") ||
      accessKey.slice(25, 34) !== invoiceNumber.padStart(9, "0"))
    throw new Error("Série ou número da NF-e não corresponde à chave de acesso.");

  const rawDetails = Array.isArray(info.det) ? info.det : [info.det];
  if (!rawDetails.length || rawDetails.length > 500)
    throw new Error("A NF-e precisa conter de 1 a 500 itens.");
  const lines = new Set<number>();
  const items = rawDetails.map(raw => {
    const line = object(raw);
    const product = object(line.prod);
    const lineText = value(line, "@_nItem");
    const lineNumber = Number(lineText);
    if (!/^[1-9][0-9]*$/.test(lineText) || !Number.isSafeInteger(lineNumber) || lineNumber > 500)
      throw new Error("Número de item inválido no XML.");
    if (lines.has(lineNumber)) throw new Error("O XML contém número de item repetido.");
    lines.add(lineNumber);
    return {
      lineNumber,
      supplierCode: value(product, "cProd").slice(0, 60),
      gtin: normalizeDocument(value(product, "cEAN") || value(product, "cEANTrib")),
      description: value(product, "xProd").slice(0, 255),
      ncm: value(product, "NCM"),
      cest: value(product, "CEST"),
      cfop: value(product, "CFOP"),
      unit: value(product, "uCom").slice(0, 8),
      quantity: numeric(value(product, "qCom"), "quantidade", false),
      unitPrice: numeric(value(product, "vUnCom"), "valor unitário"),
      total: numeric(value(product, "vProd"), "total do item"),
      taxes: line.imposto ? object(line.imposto) : null,
    };
  });
  if (items.some(item => !item.description || !item.unit))
    throw new Error("Há item sem descrição ou unidade no XML.");

  const issuerName = value(issuer, "xNome").slice(0, 180);
  const recipientName = value(destination, "xNome").slice(0, 180);
  if (!issuerName || !recipientName)
    throw new Error("O XML precisa informar os nomes do emitente e do destinatário.");
  const rawTotal = value(object(info.total).ICMSTot, "vNF");
  if (!rawTotal) throw new Error("O XML não informa o valor total da NF-e.");
  const issuedAt = value(ide, "dhEmi") || value(ide, "dEmi") || null;
  const authorizedAt = value(protocol, "dhRecbto") || null;
  if (issuedAt && Number.isNaN(Date.parse(issuedAt)))
    throw new Error("Data de emissão inválida no XML.");
  if (authorizedAt && Number.isNaN(Date.parse(authorizedAt)))
    throw new Error("Data de autorização inválida no XML.");
  const transport = object(object(info.transp).transporta);
  const carrierDocument = normalizeDocument(value(transport, "CNPJ") || value(transport, "CPF"));
  const carrier = validTaxDocument(carrierDocument)
    ? {
        ...party(transport, {}, "xNome"),
        address: {
          ...party(transport, {}, "xNome").address,
          street: value(transport, "xEnder").slice(0, 160),
          city: value(transport, "xMun").slice(0, 100),
          state: value(transport, "UF").slice(0, 2).toUpperCase(),
        },
      }
    : null;
  const recipient = party(destination, destination.enderDest, "xNome");
  const cfop = items.find(item => item.cfop)?.cfop || "";

  return {
    accessKey,
    invoiceNumber,
    series,
    issuedAt,
    authorizedAt,
    issuerDocument,
    issuerName,
    recipient,
    carrier,
    statusCode,
    statusReason: value(protocol, "xMotivo").slice(0, 255),
    protocol: value(protocol, "nProt").slice(0, 80),
    total: numeric(rawTotal, "valor total"),
    cfop,
    fiscalData: { schemaVersion: 1, infNFe: info, protocol },
    items,
  };
}
