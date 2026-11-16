export type NfceItemInput = { sku: string; name: string; ncm: string; cfop: string; unit: string; origin: string; quantity: number; unitPrice: number };
export type NfceBuildInput = {
  company: Record<string, unknown>;
  items: NfceItemInput[];
  cpf: string;
  paymentMethod: string;
  naturezaOperacao: string;
};

const PAYMENTS = new Set(["01", "03", "04", "17", "99"]);

function digits(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function address(company: Record<string, unknown>): Record<string, unknown> {
  const value = company.address;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function brazilNow(): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());
  return parts.replace(" ", "T") + "-03:00";
}

export function buildNfceHomologacaoPayload(input: NfceBuildInput): { payload: Record<string, unknown>; issues: string[]; totalCents: number } {
  const issues: string[] = [];
  const company = input.company;
  const place = address(company);
  const cnpj = digits(company.cnpj);
  if (!/^\d{14}$/.test(cnpj)) issues.push("CNPJ do emitente inválido.");
  if (company.tax_regime !== "simples_nacional" || company.tax_regime_confirmed !== true) {
    issues.push("A NFC-e de teste desta etapa atende empresa confirmada no Simples Nacional.");
  }
  const natureza = text(input.naturezaOperacao, 60);
  if (natureza.length < 3) issues.push("Informe a natureza da operação.");
  if (!input.items.length || input.items.length > 20) issues.push("Informe de 1 a 20 itens.");
  const cpf = digits(input.cpf);
  if (cpf && !/^\d{11}$/.test(cpf)) issues.push("CPF do consumidor inválido.");
  if (!PAYMENTS.has(input.paymentMethod)) issues.push("Forma de pagamento inválida.");
  if (!text(place.street, 120) || !text(place.city, 60) || !/^[A-Z]{2}$/.test(text(place.state, 2).toUpperCase())) {
    issues.push("Complete o endereço da empresa antes de emitir a NFC-e.");
  }

  let totalCents = 0;
  const items = input.items.map((item, index) => {
    const quantity = item.quantity;
    const unitCents = Math.round(item.unitPrice * 100);
    if (!Number.isInteger(unitCents) || unitCents <= 0 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999) {
      issues.push(`Item ${index + 1}: quantidade ou preço inválido.`);
    }
    const lineCents = Math.round(quantity * unitCents);
    if (!Number.isSafeInteger(lineCents) || lineCents <= 0) issues.push(`Item ${index + 1}: total inválido.`);
    else totalCents += lineCents;
    if (!/^\d{8}$/.test(digits(item.ncm))) issues.push(`Item ${index + 1}: NCM de 8 dígitos ausente no produto.`);
    if (!/^[56]\d{3}$/.test(item.cfop)) issues.push(`Item ${index + 1}: informe um CFOP de saída de 4 dígitos.`);
    if (!item.name.trim()) issues.push(`Item ${index + 1}: descrição ausente.`);
    if (!/^[0-8]$/.test(item.origin)) issues.push(`Item ${index + 1}: origem do produto ausente.`);
    return {
      numero_item: String(index + 1),
      codigo_produto: item.sku.slice(0, 60) || String(index + 1),
      descricao: item.name.trim().slice(0, 120),
      codigo_ncm: digits(item.ncm),
      cfop: item.cfop,
      unidade_comercial: (item.unit || "UN").slice(0, 6),
      quantidade_comercial: quantity,
      valor_unitario_comercial: money(unitCents),
      valor_bruto: money(Math.max(lineCents, 0)),
      icms_origem: item.origin,
      icms_situacao_tributaria: "102",
    };
  });

  const payload: Record<string, unknown> = {
    natureza_operacao: natureza || "VENDA AO CONSUMIDOR",
    data_emissao: brazilNow(),
    tipo_documento: "1",
    finalidade_emissao: "1",
    consumidor_final: "1",
    presenca_comprador: "1",
    modalidade_frete: "9",
    local_destino: "1",
    cnpj_emitente: cnpj,
    nome_emitente: text(company.legal_name || company.trade_name, 60),
    nome_fantasia_emitente: text(company.trade_name, 60),
    inscricao_estadual_emitente: text(company.state_registration, 14),
    logradouro_emitente: text(place.street, 60),
    numero_emitente: text(place.number, 10) || "S/N",
    bairro_emitente: text(place.district, 60),
    municipio_emitente: text(place.city, 60),
    uf_emitente: text(place.state, 2).toUpperCase(),
    cep_emitente: digits(place.postalCode),
    indicador_inscricao_estadual_destinatario: "9",
    items,
    formas_pagamento: [{ forma_pagamento: input.paymentMethod, valor_pagamento: money(Math.max(totalCents, 0)) }],
  };
  if (/^\d{11}$/.test(cpf)) payload.cpf_destinatario = cpf;
  return { payload, issues, totalCents };
}
