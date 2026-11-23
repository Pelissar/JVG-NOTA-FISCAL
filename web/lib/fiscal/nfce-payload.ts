import { isOfficialCfopCode } from "./cfop";
import { filterFocusTaxFieldsForRule, inspectFocusTaxFields, reviewFocusTaxRule } from "./focus-tax-fields";
import { isValidCpf } from "./cpf";
import { validCnpj } from "../fiscal-company-profile";

export type NfceItemInput = {
  sku: string;
  name: string;
  ncm: string;
  cest: string;
  cfop: string;
  unit: string;
  origin: string;
  quantity: number;
  unitPrice: number;
  csosn: string;
  pisCst: string;
  cofinsCst: string;
  focusFields: unknown;
};

export type NfceBuildInput = {
  company: Record<string, unknown>;
  items: NfceItemInput[];
  cpf: string;
  cnpj: string;
  recipientName: string;
  payments: NfcePaymentInput[];
  changeAmount: number;
  naturezaOperacao: string;
  localDestino: string;
  presencaComprador: string;
};

export type NfcePaymentInput = {
  method: string;
  indicatorPayment: string;
  amount: number;
  description: string;
  integrationType: string;
  acquirerCnpj: string;
  cardBrand: string;
  authorization: string;
};

const PAYMENTS = new Set(["01", "02", "03", "04", "05", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "91", "99"]);
const CARD_PAYMENTS = new Set(["03", "04", "17"]);
const CARD_BRANDS = new Set(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "99"]);
const CSOSN = new Set(["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]);
const ST_CSOSN = new Set(["201", "202", "203", "500"]);

function digits(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function cnpjValue(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
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
  if (!(["simples_nacional", "1"].includes(String(company.tax_regime || "").trim().toLowerCase())) || company.tax_regime_confirmed !== true) {
    issues.push("A NFC-e em homologação nesta etapa exige regime Simples Nacional confirmado no cadastro da empresa.");
  }
  const natureza = text(input.naturezaOperacao, 60);
  if (natureza.length < 3) issues.push("Informe a natureza da operação.");
  if (!input.items.length || input.items.length > 20) issues.push("Informe de 1 a 20 itens.");
  if (!new Set(["1", "2"]).has(input.localDestino)) issues.push("Selecione se a operação é interna ou interestadual.");
  if (!new Set(["1", "4"]).has(input.presencaComprador)) issues.push("Selecione a presença do comprador conforme a operação.");
  const cpf = digits(input.cpf);
  const recipientCnpj = cnpjValue(input.cnpj);
  if (cpf && !isValidCpf(cpf)) issues.push("CPF do consumidor inválido; confira os dígitos verificadores ou deixe o campo vazio.");
  if (recipientCnpj && !validCnpj(recipientCnpj)) issues.push("CNPJ do consumidor inválido; confira os dígitos verificadores ou deixe o campo vazio.");
  if (recipientCnpj && !/^\d{14}$/.test(recipientCnpj)) issues.push("O contrato atual do serviço fiscal documenta CNPJ do destinatário com 14 dígitos numéricos. Use o CNPJ numérico ou aguarde confirmação de suporte ao CNPJ alfanumérico.");
  if (cpf && recipientCnpj) issues.push("Informe CPF ou CNPJ do consumidor, não os dois no mesmo cupom.");
  const recipientName = text(input.recipientName, 120);
  if (recipientName && !cpf && !recipientCnpj) issues.push("Para identificar o consumidor pelo nome, informe também o CPF ou CNPJ. Para venda sem identificação, deixe os campos vazios.");
  if (!text(place.street, 120) || !text(place.city, 60) || !/^[A-Z]{2}$/.test(text(place.state, 2).toUpperCase())) {
    issues.push("Complete o endereço fiscal da empresa antes de emitir a NFC-e.");
  }
  if (!text(company.state_registration, 14)) issues.push("Inscrição estadual do emitente ausente. Corrija o cadastro fiscal da empresa antes de emitir o cupom.");

  let totalCents = 0;
  const items = input.items.map((item, index) => {
    const label = `Item ${index + 1} (${text(item.name, 80) || "produto"})`;
    const quantity = item.quantity;
    const unitCents = Math.round(item.unitPrice * 100);
    if (!Number.isInteger(unitCents) || unitCents <= 0 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999) {
      issues.push(`${label}: quantidade ou preço inválido.`);
    }
    const lineCents = Math.round(quantity * unitCents);
    if (!Number.isSafeInteger(lineCents) || lineCents <= 0) issues.push(`${label}: total inválido.`);
    else totalCents += lineCents;
    const ncm = digits(item.ncm);
    if (!/^\d{8}$/.test(ncm)) issues.push(`${label}: NCM de 8 dígitos ausente; corrija o cadastro do produto ou este item.`);
    const cfop = digits(item.cfop);
    if (!/^[56]\d{3}$/.test(cfop) || !isOfficialCfopCode(cfop)) issues.push(`${label}: informe um CFOP oficial de saída de 4 dígitos para esta operação.`);
    else if ((input.localDestino === "1" && !cfop.startsWith("5")) || (input.localDestino === "2" && !cfop.startsWith("6"))) {
      issues.push(`${label}: o primeiro dígito do CFOP não corresponde ao local da operação escolhido.`);
    }
    if (!text(item.name, 120)) issues.push(`${label}: descrição ausente.`);
    if (!text(item.unit, 6)) issues.push(`${label}: unidade comercial ausente.`);
    const origin = digits(item.origin);
    if (!/^[0-8]$/.test(origin)) issues.push(`${label}: origem da mercadoria precisa ser informada no cadastro do produto.`);
    const csosn = text(item.csosn, 3);
    const pisCst = text(item.pisCst, 2);
    const cofinsCst = text(item.cofinsCst, 2);
    const cest = digits(item.cest);
    if (!CSOSN.has(csosn)) issues.push(`${label}: informe o CSOSN orientado para este produto e operação.`);
    if (ST_CSOSN.has(csosn) && !/^\d{7}$/.test(cest)) issues.push(`${label}: CSOSN ${csosn} exige CEST de 7 dígitos; informe o CEST aplicável ao produto.`);
    if (!/^\d{2}$/.test(pisCst)) issues.push(`${label}: CST do PIS não configurado para esta operação.`);
    if (!/^\d{2}$/.test(cofinsCst)) issues.push(`${label}: CST da Cofins não configurado para esta operação.`);

    const inspected = inspectFocusTaxFields(item.focusFields);
    if (inspected.invalid.length) issues.push(`${label}: corrija os campos tributários numéricos inválidos (${inspected.invalid.join(", ")}).`);
    const focusFields = filterFocusTaxFieldsForRule(inspected.fields, { csosn, pisCst, cofinsCst });
    const taxReview = reviewFocusTaxRule({ csosn, pisCst, cofinsCst, focusFields });
    const taxIssues = [...taxReview.icmsMissing, ...taxReview.pisCofinsMissing, ...taxReview.unsupported];
    if (taxIssues.length) issues.push(`${label}: ${taxIssues.join("; ")}.`);

    const focusItem: Record<string, unknown> = {
      numero_item: String(index + 1),
      codigo_produto: text(item.sku, 60) || `CFOP${cfop}`,
      descricao: text(item.name, 120),
      codigo_ncm: ncm,
      cfop,
      unidade_comercial: text(item.unit, 6),
      quantidade_comercial: quantity,
      valor_unitario_comercial: money(unitCents),
      valor_bruto: money(Math.max(lineCents, 0)),
      icms_origem: origin,
      icms_situacao_tributaria: csosn,
      pis_situacao_tributaria: pisCst,
      cofins_situacao_tributaria: cofinsCst,
    };
    if (/^\d{7}$/.test(cest)) focusItem.cest = cest;
    for (const [name, value] of Object.entries(focusFields)) {
      if (Number.isFinite(value) && value >= 0) focusItem[name] = value;
    }
    return focusItem;
  });

  const paymentRows = Array.isArray(input.payments) ? input.payments : [];
  if (!paymentRows.length || paymentRows.length > 20) issues.push("Inclua de 1 a 20 formas de pagamento para o cupom.");
  let paidCents = 0;
  const paymentPayload = paymentRows.slice(0, 20).map((payment, index) => {
    const label = `Pagamento ${index + 1}`;
    const method = text(payment.method, 2);
    if (!PAYMENTS.has(method)) issues.push(`${label}: selecione uma forma de pagamento válida.`);
    const indicator = text(payment.indicatorPayment, 1);
    if (!new Set(["0", "1"]).has(indicator)) issues.push(`${label}: selecione se o pagamento é à vista ou a prazo.`);
    if (method === "91" && indicator !== "1") issues.push(`${label}: “Pagamento posterior” precisa ser informado como pagamento a prazo.`);
    const amountCents = Math.round(Number(payment.amount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
      issues.push(`${label}: informe um valor válido, sem centavos fracionados.`);
    } else if (method === "91") {
      if (amountCents !== 0) issues.push(`${label}: “Pagamento posterior” deve ser enviado com valor R$ 0,00; ele indica que o total ficará pendente.`);
    } else if (amountCents <= 0) {
      issues.push(`${label}: informe um valor maior que zero.`);
    } else {
      paidCents += amountCents;
    }
    const row: Record<string, unknown> = {
      indicador_pagamento: indicator,
      forma_pagamento: method,
      valor_pagamento: money(Math.max(amountCents, 0)),
    };
    const description = text(payment.description, 60);
    if (method === "99") {
      if (description.length < 2) issues.push(`${label}: descreva a forma de pagamento escolhida em “Outros”.`);
      else row.descricao_pagamento = description;
    }
    if (CARD_PAYMENTS.has(method)) {
      const integrationType = text(payment.integrationType, 1);
      if (!new Set(["1", "2"]).has(integrationType)) issues.push(`${label}: informe se o cartão é integrado ao sistema ou usado em POS.`);
      else row.tipo_integracao = integrationType;
      const acquirerCnpj = cnpjValue(payment.acquirerCnpj);
      const authorization = text(payment.authorization, 128);
      const cardBrand = text(payment.cardBrand, 2);
      if (integrationType === "1") {
        if (!/^\d{14}$/.test(acquirerCnpj) || !validCnpj(acquirerCnpj)) issues.push(`${label}: para pagamento integrado, informe o CNPJ numérico válido da credenciadora ou instituição de pagamento.`);
        else row.cnpj_credenciadora = acquirerCnpj;
        if (!authorization) issues.push(`${label}: para pagamento integrado, informe o código de autorização da transação.`);
      }
      if (cardBrand && !CARD_BRANDS.has(cardBrand)) issues.push(`${label}: selecione um código de bandeira válido.`);
      if (cardBrand) row.bandeira_operadora = cardBrand;
      if (authorization) row.numero_autorizacao = authorization;
    }
    return row;
  });
  const changeCents = Math.round(Number(input.changeAmount || 0) * 100);
  if (!Number.isSafeInteger(changeCents) || changeCents < 0) issues.push("Informe um valor de troco válido.");
  if (changeCents > 0 && !paymentRows.some(payment => payment.method === "01")) {
    issues.push("Informe troco somente quando houver pagamento em dinheiro.");
  }
  const hasPaymentLater = paymentRows.some(payment => payment.method === "91");
  if (hasPaymentLater ? paidCents - Math.max(changeCents, 0) > totalCents : paidCents - Math.max(changeCents, 0) !== totalCents) {
    issues.push(hasPaymentLater
      ? "Pagamentos já recebidos, descontado o troco, não podem superar o total dos itens quando parte ficou para pagamento posterior."
      : "A soma dos pagamentos, descontado o troco, precisa ser igual ao total dos itens.");
  }

  const payload: Record<string, unknown> = {
    natureza_operacao: natureza,
    data_emissao: brazilNow(),
    tipo_documento: "1",
    finalidade_emissao: "1",
    consumidor_final: "1",
    presenca_comprador: input.presencaComprador,
    modalidade_frete: "9",
    local_destino: input.localDestino,
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
    formas_pagamento: paymentPayload,
  };
  if (/^\d{11}$/.test(cpf)) payload.cpf_destinatario = cpf;
  if (/^[A-Z0-9]{14}$/.test(recipientCnpj)) payload.cnpj_destinatario = recipientCnpj;
  if (recipientName && (cpf || recipientCnpj)) payload.nome_destinatario = recipientName;
  if (changeCents > 0) payload.valor_troco = money(changeCents);
  return { payload, issues: [...new Set(issues)], totalCents };
}
