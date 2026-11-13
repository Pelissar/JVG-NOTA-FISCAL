/**
 * Auditoria estrutural de rascunhos. Não calcula impostos, não monta XML
 * e não torna documentos aptos a transmitir.
 */
type Json = Record<string, unknown>;
export type PreflightResult = {
  dataComplete: boolean;
  fiscalValidated: false;
  transmissionEnabled: false;
  issues: string[];
};

function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function value(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}
function numbers(raw: unknown): string {
  return value(raw).replace(/\D/g, "");
}
function cpfIsValid(raw: unknown): boolean {
  const cpf = numbers(raw);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const remainder = (sum * 10) % 11;
    if (Number(cpf[length]) !== (remainder === 10 ? 0 : remainder)) return false;
  }
  return true;
}

function addressIssues(addressValue: unknown, label: string): string[] {
  const address = object(addressValue);
  const issues: string[] = [];
  for (const [field, description] of [
    ["street", "logradouro"], ["number", "número"],
    ["district", "bairro"], ["city", "município"],
  ]) {
    if (!value(address[field])) issues.push(`${label}: ${description} não informado`);
  }
  if (!/^[A-Z]{2}$/.test(value(address.state).toUpperCase()) ||
      !new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]).has(value(address.state).toUpperCase()))
    issues.push(`${label}: UF inválida ou ausente`);
  if (!/^\d{8}$/.test(numbers(address.postalCode)))
    issues.push(`${label}: CEP deve ter 8 dígitos`);
  if (!/^\d{7}$/.test(numbers(address.cityCode)))
    issues.push(`${label}: código IBGE do município deve ter 7 dígitos`);
  return issues;
}

export function reviewNfePreparation(
  issuerValue: unknown,
  recipientValue: unknown,
  itemsValue: unknown,
): PreflightResult {
  const issuer = object(issuerValue);
  const recipient = object(recipientValue);
  const items = Array.isArray(itemsValue) ? itemsValue : [];
  const issues: string[] = [];
  if (issuer.taxRegimeConfirmed !== true)
    issues.push("Emitente: regime tributário não confirmado pela contabilidade");
  if (!value(issuer.cnpj)) issues.push("Emitente: CNPJ não informado");
  if (!value(issuer.stateRegistration)) issues.push("Emitente: inscrição estadual não informada");
  const type = value(recipient.documentType).toLowerCase();
  const number = value(recipient.documentNumber).toUpperCase();
  if (type === "cpf") {
    if (!cpfIsValid(number)) issues.push("Destinatário: CPF inválido ou ausente");
  } else if (type === "cnpj") {
    if (!/^[A-Z0-9]{12}\d{2}$/.test(number))
      issues.push("Destinatário: CNPJ inválido ou ausente");
  } else {
    issues.push("Destinatário: tipo de documento requer validação específica");
  }
  if (!value(recipient.name)) issues.push("Destinatário: nome ausente");
  if (type !== "foreign") issues.push(...addressIssues(recipient.address, "Destinatário"));
  if (!items.length) issues.push("NF-e sem itens");
  items.forEach((raw, index) => {
    const item = object(raw);
    const prefix = `Item ${index + 1}`;
    if (!/^\d{8}$/.test(value(item.ncm))) issues.push(`${prefix}: NCM ausente ou inválido`);
    if (!value(item.unit)) issues.push(`${prefix}: unidade comercial ausente`);
    if (!/^[0-8]$/.test(value(item.origin))) issues.push(`${prefix}: origem da mercadoria inválida`);
    if (!value(item.description)) issues.push(`${prefix}: descrição do produto ausente`);
  });
  return { dataComplete: issues.length === 0, fiscalValidated: false, transmissionEnabled: false, issues };
}
