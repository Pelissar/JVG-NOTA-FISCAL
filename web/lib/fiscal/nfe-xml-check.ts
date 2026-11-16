import { XMLParser, XMLValidator } from "fast-xml-parser";

export type NfeXmlReport = {
  ok: boolean;
  environment: "homologacao" | "producao" | "";
  accessKey: string;
  series: string;
  number: string;
  issuerName: string;
  issuerDocument: string;
  recipientName: string;
  total: string;
  statusCode: string;
  statusReason: string;
  issues: string[];
};

type XmlObject = Record<string, unknown>;

function object(value: unknown): XmlObject {
  if (Array.isArray(value)) return object(value[0]);
  return value && typeof value === "object" ? value as XmlObject : {};
}

function text(parent: unknown, key: string): string {
  const item = object(parent)[key];
  return typeof item === "string" || typeof item === "number" ? String(item).trim() : "";
}

function digits(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function accessKeyDigit(base: string): string {
  let weight = 2;
  let sum = 0;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    sum += Number(base[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return String(rest < 2 ? 0 : 11 - rest);
}

const empty = (): NfeXmlReport => ({
  ok: false, environment: "", accessKey: "", series: "", number: "",
  issuerName: "", issuerDocument: "", recipientName: "", total: "",
  statusCode: "", statusReason: "", issues: [],
});

/** Confere a estrutura do XML processado. Não arquiva, não transmite e não verifica assinatura digital. */
export function checkNfeXml(xml: string, companyTaxId: string): NfeXmlReport {
  const report = empty();
  const issues = report.issues;
  if (!xml.trim() || Buffer.byteLength(xml, "utf8") > 2_000_000) {
    issues.push("XML vazio ou acima do limite de 2 MB.");
    return report;
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    issues.push("XML com DTD ou entidade declarada não é aceito.");
    return report;
  }
  if (XMLValidator.validate(xml) !== true) {
    issues.push("XML malformado. Confira se o arquivo está completo.");
    return report;
  }
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false,
    trimValues: true, processEntities: true, allowBooleanAttributes: false,
  });
  const process = object(object(parser.parse(xml)).nfeProc);
  const info = object(object(process.NFe).infNFe);
  const protocol = object(object(process.protNFe).infProt);
  const ide = object(info.ide);
  const issuer = object(info.emit);
  const destination = object(info.dest);
  if (!Object.keys(process).length || !Object.keys(info).length || !Object.keys(protocol).length) {
    issues.push("Envie o XML processado (nfeProc), com a NF-e e o protocolo.");
    return report;
  }

  report.statusCode = text(protocol, "cStat");
  report.statusReason = text(protocol, "xMotivo").slice(0, 180);
  report.series = text(ide, "serie");
  report.number = text(ide, "nNF");
  report.issuerName = text(issuer, "xNome").slice(0, 180);
  report.issuerDocument = digits(text(issuer, "CNPJ") || text(issuer, "CPF"));
  report.recipientName = text(destination, "xNome").slice(0, 180);
  report.total = text(object(info.total).ICMSTot, "vNF");
  const environment = text(ide, "tpAmb");
  report.environment = environment === "1" ? "producao" : environment === "2" ? "homologacao" : "";
  const accessKey = digits(text(protocol, "chNFe") || text(info, "@_Id").replace(/^NFe/i, ""));
  const infoKey = digits(text(info, "@_Id").replace(/^NFe/i, ""));
  report.accessKey = accessKey;

  if (report.statusCode !== "100" && report.statusCode !== "150") issues.push("O protocolo não informa autorização (cStat 100 ou 150).");
  if (!/^\d{44}$/.test(accessKey)) issues.push("A chave de acesso precisa ter 44 dígitos.");
  else if (accessKeyDigit(accessKey.slice(0, 43)) !== accessKey.slice(43)) issues.push("O dígito verificador da chave de acesso não confere.");
  if (!infoKey) issues.push("O identificador infNFe não informa a chave.");
  else if (infoKey !== accessKey) issues.push("A chave do protocolo difere da chave da NF-e.");
  if (text(ide, "mod") !== "55") issues.push("Este conferidor aceita somente NF-e modelo 55.");
  if (!report.environment) issues.push("O ambiente (tpAmb) precisa ser 1, produção, ou 2, homologação.");
  if (!report.issuerName || !report.recipientName) issues.push("Faltam o nome do emitente ou do destinatário.");
  if (!/^[A-Z0-9]{14}$/.test(report.issuerDocument) && !/^\d{11}$/.test(report.issuerDocument)) issues.push("CPF/CNPJ do emitente ausente ou inválido.");
  const company = digits(companyTaxId);
  if (/^[A-Z0-9]{14}$/.test(company) && report.issuerDocument && report.issuerDocument !== company) {
    issues.push("O emitente do XML não é a empresa ativa.");
  }
  if (/^\d{44}$/.test(accessKey)) {
    if (report.issuerDocument && accessKey.slice(6, 20) !== report.issuerDocument) issues.push("O documento do emitente não bate com a chave.");
    if (accessKey.slice(20, 22) !== "55") issues.push("O modelo gravado na chave não é 55.");
    if (!/^\d{1,3}$/.test(report.series) || accessKey.slice(22, 25) !== report.series.padStart(3, "0")) issues.push("A série não corresponde à chave.");
    if (!/^\d{1,9}$/.test(report.number) || Number(report.number) < 1 || accessKey.slice(25, 34) !== report.number.padStart(9, "0")) issues.push("O número não corresponde à chave.");
    const issuedAt = text(ide, "dhEmi") || text(ide, "dEmi");
    const yearMonth = issuedAt.slice(2, 4) + issuedAt.slice(5, 7);
    if (!/^\d{4}$/.test(yearMonth) || accessKey.slice(2, 6) !== yearMonth) issues.push("O ano e o mês da emissão não correspondem à chave.");
  }
  if (!report.total) issues.push("O XML não informa o valor total da NF-e.");
  const details = Array.isArray(info.det) ? info.det : info.det ? [info.det] : [];
  if (!details.length || details.length > 500) issues.push("A NF-e precisa ter de 1 a 500 itens.");
  const lines = new Set<string>();
  details.forEach((raw, index) => {
    const line = object(raw);
    const product = object(line.prod);
    const lineNumber = text(line, "@_nItem");
    if (!lineNumber || lines.has(lineNumber)) issues.push("Item " + (index + 1) + " está sem número ou repetido.");
    lines.add(lineNumber);
    if (!text(product, "xProd") || !text(product, "uCom")) issues.push("Item " + (lineNumber || index + 1) + " está sem descrição ou unidade.");
    if (!/^\d{8}$/.test(text(product, "NCM"))) issues.push("Item " + (lineNumber || index + 1) + " está sem NCM de 8 dígitos.");
  });
  report.ok = issues.length === 0;
  return report;
}
