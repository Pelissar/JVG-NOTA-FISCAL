/** Monta o JSON da Focus a partir do rascunho. Não chama a rede. */

export const HOMOLOG_RECIPIENT_NAME =
  "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

const FOCUS_HOMOLOG = "https://homologacao.focusnfe.com.br";

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function digits(value: unknown): string {
  return text(value).replace(/\D/g, "");
}

function doc(value: unknown): string {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function focusFileUrl(path: unknown): string | null {
  if (typeof path !== "string" || !path) return null;
  if (path.startsWith(`${FOCUS_HOMOLOG}/`)) return path;
  if (path.startsWith("/") && !path.startsWith("//")) return `${FOCUS_HOMOLOG}${path}`;
  return null;
}

export function emissionBlockers(company: Json, payload: Json): string[] {
  const issues: string[] = [];
  const address = object(company.address);
  const recipient = object(payload.recipient);
  const recipientAddress = object(recipient.address);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!text(company.legal_name) || text(company.legal_name) === "Empresa Piloto JVG") {
    issues.push("Emitente: razão social definitiva não cadastrada");
  }
  if (!doc(company.cnpj)) issues.push("Emitente: CNPJ ausente");
  if (!text(company.state_registration)) issues.push("Emitente: inscrição estadual ausente");
  for (const [field, label] of [
    ["street", "logradouro"],
    ["number", "número"],
    ["district", "bairro"],
    ["city", "município"],
  ] as const) {
    if (!text(address[field])) issues.push(`Emitente: ${label} ausente`);
  }
  if (!/^[A-Z]{2}$/.test(text(address.state))) issues.push("Emitente: UF ausente");
  if (!/^\d{8}$/.test(digits(address.postalCode))) issues.push("Emitente: CEP inválido");
  if (!/^\d{7}$/.test(digits(address.cityCode))) issues.push("Emitente: código IBGE ausente");
  const kind = text(recipient.documentType).toLowerCase();
  if (kind !== "cpf" && kind !== "cnpj") issues.push("Destinatário: use CPF ou CNPJ");
  if (!doc(recipient.documentNumber)) issues.push("Destinatário: documento ausente");
  if (!text(recipientAddress.state)) issues.push("Destinatário: UF ausente");
  if (!text(recipientAddress.street) || !text(recipientAddress.city)) {
    issues.push("Destinatário: endereço incompleto");
  }
  if (!items.length) issues.push("NF-e sem itens");
  const issuerUf = text(address.state).toUpperCase();
  const recipientUf = text(recipientAddress.state || recipient.state).toUpperCase();
  items.forEach((raw, index) => {
    const item = object(raw);
    const prefix = `Item ${index + 1}`;
    if (!/^\d{8}$/.test(digits(item.ncm))) issues.push(`${prefix}: NCM inválido`);
    if (!/^[0-8]$/.test(text(item.origin))) issues.push(`${prefix}: origem inválida`);
    if (!text(item.unit) || !text(item.description)) issues.push(`${prefix}: unidade ou descrição ausente`);
    const cfop = text(item.cfop);
    const csosn = text(item.csosn);
    if (!/^[567]\d{3}$/.test(cfop)) issues.push(`${prefix}: CFOP de saída ausente`);
    if (!/^\d{3}$/.test(csosn)) issues.push(`${prefix}: CSOSN ausente`);
    if (issuerUf && recipientUf && cfop) {
      if (issuerUf === recipientUf && cfop[0] !== "5") issues.push(`${prefix}: CFOP não é de saída interna`);
      if (issuerUf !== recipientUf && cfop[0] !== "6") issues.push(`${prefix}: CFOP não é de saída interestadual`);
    }
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) issues.push(`${prefix}: quantidade inválida`);
  });
  return issues;
}

export function buildFocusNfePayload(company: Json, payload: Json, emittedAtIso: string): Json {
  const address = object(company.address);
  const recipient = object(payload.recipient);
  const recipientAddress = object(recipient.address);
  const items = (Array.isArray(payload.items) ? payload.items : []).map((raw) => object(raw));
  const issuerUf = text(address.state).toUpperCase();
  const recipientUf = text(recipientAddress.state || recipient.state).toUpperCase();
  const totalCents = items.reduce((sum, item) => sum + Number(item.subtotalCents || 0), 0);
  const kind = text(recipient.documentType).toLowerCase();
  const recipientDoc = doc(recipient.documentNumber);
  const ie = text(recipient.stateRegistration || recipient.ie).replace(/[^0-9A-Za-z]/g, "");
  return {
    natureza_operacao: text(payload.nature).slice(0, 60) || "Venda de mercadoria",
    data_emissao: emittedAtIso,
    tipo_documento: "1",
    finalidade_emissao: "1",
    regime_tributario_emitente: "1",
    local_destino: issuerUf && recipientUf && issuerUf !== recipientUf ? "2" : "1",
    presenca_comprador: "1",
    consumidor_final: "1",
    cnpj_emitente: doc(company.cnpj),
    nome_emitente: text(company.legal_name).slice(0, 60),
    nome_fantasia_emitente: text(company.trade_name || company.legal_name).slice(0, 60),
    logradouro_emitente: text(address.street).slice(0, 60),
    numero_emitente: text(address.number).slice(0, 60) || "S/N",
    bairro_emitente: text(address.district).slice(0, 60),
    municipio_emitente: text(address.city).slice(0, 60),
    uf_emitente: issuerUf,
    cep_emitente: digits(address.postalCode),
    inscricao_estadual_emitente: text(company.state_registration).replace(/\D/g, ""),
    nome_destinatario: HOMOLOG_RECIPIENT_NAME,
    ...(kind === "cpf" ? { cpf_destinatario: recipientDoc } : { cnpj_destinatario: recipientDoc }),
    indicador_inscricao_estadual_destinatario: ie ? "1" : "9",
    ...(ie ? { inscricao_estadual_destinatario: ie } : {}),
    logradouro_destinatario: text(recipientAddress.street).slice(0, 60),
    numero_destinatario: text(recipientAddress.number).slice(0, 60) || "S/N",
    bairro_destinatario: text(recipientAddress.district).slice(0, 60),
    municipio_destinatario: text(recipientAddress.city).slice(0, 60),
    uf_destinatario: recipientUf,
    cep_destinatario: digits(recipientAddress.postalCode),
    pais_destinatario: "Brasil",
    modalidade_frete: "9",
    valor_produtos: money(totalCents),
    valor_total: money(totalCents),
    items: items.map((item, index) => ({
      numero_item: String(index + 1),
      codigo_produto: text(item.sku).slice(0, 60) || String(index + 1),
      descricao: text(item.description).slice(0, 120),
      codigo_ncm: digits(item.ncm),
      cfop: text(item.cfop),
      unidade_comercial: text(item.unit).slice(0, 6) || "UN",
      quantidade_comercial: Number(item.quantity),
      valor_unitario_comercial: money(Number(item.unitPriceCents || 0)),
      valor_bruto: money(Number(item.subtotalCents || 0)),
      unidade_tributavel: text(item.unit).slice(0, 6) || "UN",
      quantidade_tributavel: Number(item.quantity),
      valor_unitario_tributavel: money(Number(item.unitPriceCents || 0)),
      inclui_no_total: "1",
      icms_origem: text(item.origin) || "0",
      icms_situacao_tributaria: text(item.csosn),
      pis_situacao_tributaria: "07",
      cofins_situacao_tributaria: "07",
    })),
    formas_pagamento: [{ forma_pagamento: "01", valor_pagamento: money(totalCents) }],
    informacoes_adicionais_contribuinte:
      "Documento emitido em homologacao pelo JVG. Sem valor fiscal.",
  };
}
