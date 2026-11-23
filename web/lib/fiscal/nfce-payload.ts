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
  deliveryAddress: NfceDeliveryAddressInput;
  transporter: NfceTransporterInput;
  intermediaryIndicator: string;
  intermediaryCnpj: string;
  intermediaryId: string;
  payments: NfcePaymentInput[];
  changeAmount: number;
  naturezaOperacao: string;
  localDestino: string;
  presencaComprador: string;
};

export type NfceDeliveryAddressInput = {
  street: string; number: string; complement: string; district: string;
  city: string; cityCode: string; state: string; postalCode: string;
};

export type NfceTransporterInput = {
  mode: string; cpf: string; cnpj: string; name: string; stateRegistration: string;
  address: string; city: string; state: string;
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
  if (input.localDestino !== "1") issues.push("NFC-e não permite operação interestadual ou com o exterior. Para esse destino, use a emissão de NF-e.");
  if (!new Set(["1", "4"]).has(input.presencaComprador)) issues.push("Selecione a presença do comprador conforme a operação.");
  const cpf = digits(input.cpf);
  const recipientCnpj = cnpjValue(input.cnpj);
  if (cpf && !isValidCpf(cpf)) issues.push("CPF do consumidor inválido; confira os dígitos verificadores ou deixe o campo vazio.");
  if (recipientCnpj && !validCnpj(recipientCnpj)) issues.push("CNPJ do consumidor inválido; confira os dígitos verificadores ou deixe o campo vazio.");
  if (recipientCnpj && !/^\d{14}$/.test(recipientCnpj)) issues.push("O contrato atual do serviço fiscal documenta CNPJ do destinatário com 14 dígitos numéricos. Use o CNPJ numérico ou aguarde confirmação de suporte ao CNPJ alfanumérico.");
  if (cpf && recipientCnpj) issues.push("Informe CPF ou CNPJ do consumidor, não os dois no mesmo cupom.");
  const recipientName = text(input.recipientName, 120);
  if (recipientName && !cpf && !recipientCnpj) issues.push("Para identificar o consumidor pelo nome, informe também o CPF ou CNPJ. Para venda sem identificação, deixe os campos vazios.");
  const homeDelivery = input.presencaComprador === "4";
  const hasIntermediaryRule = ["1", "4"].includes(input.presencaComprador);
  if (hasIntermediaryRule && !new Set(["0", "1"]).has(text(input.intermediaryIndicator, 1))) {
    issues.push("Informe o canal da venda: direta, sem intermediador, ou por plataforma de terceiros.");
  }
  if (hasIntermediaryRule && input.intermediaryIndicator === "1") {
    const intermediaryCnpj = digits(input.intermediaryCnpj);
    const intermediaryId = text(input.intermediaryId, 60);
    if (!/^\d{14}$/.test(intermediaryCnpj) || !validCnpj(intermediaryCnpj)) issues.push("Intermediador: informe um CNPJ numérico válido da plataforma.");
    if (intermediaryId.length < 2) issues.push("Intermediador: informe seu nome de loja ou identificação de perfil na plataforma.");
  }
  const delivery = input.deliveryAddress;
  const deliveryState = text(delivery.state, 2).toUpperCase();
  const issuerState = text(place.state, 2).toUpperCase();
  if (homeDelivery) {
    if (!recipientName || recipientName.length < 2) issues.push("Entrega a domicílio: informe o nome do consumidor.");
    if (!cpf && !recipientCnpj) issues.push("Entrega a domicílio: informe o CPF ou CNPJ do consumidor.");
    if (!text(delivery.street, 2)) issues.push("Entrega a domicílio: informe o logradouro do destinatário.");
    if (!text(delivery.number, 1)) issues.push("Entrega a domicílio: informe o número do endereço.");
    if (!text(delivery.district, 2)) issues.push("Entrega a domicílio: informe o bairro do destinatário.");
    if (!text(delivery.city, 2)) issues.push("Entrega a domicílio: informe a cidade do destinatário.");
    if (!/^[A-Z]{2}$/.test(deliveryState)) issues.push("Entrega a domicílio: selecione a UF do endereço.");
    else if (issuerState && deliveryState !== issuerState) issues.push("NFC-e é limitada à operação interna neste fluxo. O endereço de entrega está em outra UF; use a emissão de NF-e.");
    if (delivery.postalCode && !/^\d{8}$/.test(digits(delivery.postalCode))) issues.push("Entrega a domicílio: CEP deve conter 8 dígitos.");
    if (delivery.cityCode && !/^\d{7}$/.test(digits(delivery.cityCode))) issues.push("Entrega a domicílio: código do município deve ter 7 dígitos.");
    const carrier = input.transporter;
    if (!new Set(["own", "third_party"]).has(text(carrier.mode, 20))) issues.push("Entrega a domicílio: informe se o transporte é próprio ou terceirizado.");
    if (carrier.mode === "third_party") {
      if (text(carrier.name, 60).length < 2) issues.push("Transportador: informe o nome ou razão social do entregador.");
      const carrierCnpj = digits(carrier.cnpj), carrierCpf = digits(carrier.cpf);
      if (carrierCnpj && carrierCpf) issues.push("Transportador: informe CPF ou CNPJ, não os dois.");
      if (carrierCnpj && (!/^\d{14}$/.test(carrierCnpj) || !validCnpj(carrierCnpj))) issues.push("Transportador: CNPJ inválido.");
      if (carrierCpf && !isValidCpf(carrierCpf)) issues.push("Transportador: CPF inválido.");
      const hasCarrierAddress = Boolean(text(carrier.address, 60) || text(carrier.city, 60) || text(carrier.state, 2));
      if (hasCarrierAddress && (!text(carrier.address, 60) || !text(carrier.city, 2) || !/^[A-Z]{2}$/.test(text(carrier.state, 2).toUpperCase()))) {
        issues.push("Transportador: complete endereço, cidade e UF ou deixe esses três campos vazios.");
      }
    }
  }
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
    if (!/^\d{8}$/.test(ncm)) issues.push(`${label}: campo NCM obrigatório (8 dígitos) ausente. Preencha em Cadastros > Produtos > Dados fiscais ou abra “Ajustes fiscais deste item” para uma exceção desta venda.`);
    const cfop = digits(item.cfop);
    if (!/^5\d{3}$/.test(cfop) || !isOfficialCfopCode(cfop)) issues.push(`${label}: NFC-e exige CFOP oficial de saída iniciado por 5 para operação dentro do estado. Para venda interestadual, use NF-e.`);
    if (!text(item.name, 120)) issues.push(`${label}: descrição ausente.`);
    if (!text(item.unit, 6)) issues.push(`${label}: unidade comercial ausente.`);
    const origin = digits(item.origin);
    if (!/^[0-8]$/.test(origin)) issues.push(`${label}: campo Origem da mercadoria obrigatório. Informe o código aplicável em Cadastros > Produtos > Dados fiscais ou ajuste este item conforme a orientação fiscal.`);
    const csosn = text(item.csosn, 3);
    const pisCst = text(item.pisCst, 2);
    const cofinsCst = text(item.cofinsCst, 2);
    const cest = digits(item.cest);
    if (!CSOSN.has(csosn)) issues.push(`${label}: campo CSOSN inválido ou ausente. Cadastre o padrão do produto em Dados fiscais ou abra “Ajustes fiscais deste item” e informe o código orientado para esta operação.`);
    if (ST_CSOSN.has(csosn) && !/^\d{7}$/.test(cest)) issues.push(`${label}: campo CEST obrigatório para o CSOSN ${csosn}. Cadastre o CEST aplicável em Cadastros > Produtos > Dados fiscais ou informe a exceção neste item.`);
    if (!/^\d{2}$/.test(pisCst)) issues.push(`${label}: campo CST do PIS ausente ou inválido. Cadastre o padrão do produto em Dados fiscais ou informe uma exceção neste item, conforme a orientação contábil.`);
    if (!/^\d{2}$/.test(cofinsCst)) issues.push(`${label}: campo CST da Cofins ausente ou inválido. Cadastre o padrão do produto em Dados fiscais ou informe uma exceção neste item, conforme a orientação contábil.`);

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
    modalidade_frete: homeDelivery ? (input.transporter.mode === "own" ? "3" : "2") : "9",
    local_destino: "1",
    cnpj_emitente: cnpj,
    nome_emitente: text(company.legal_name || company.trade_name, 60),
    nome_fantasia_emitente: text(company.trade_name, 60),
    inscricao_estadual_emitente: text(company.state_registration, 14),
    logradouro_emitente: text(place.street, 60),
    numero_emitente: text(place.number, 10) || "S/N",
    bairro_emitente: text(place.district, 60),
    municipio_emitente: text(place.city, 60),
    uf_emitente: issuerState,
    cep_emitente: digits(place.postalCode),
    indicador_inscricao_estadual_destinatario: "9",
    items,
    formas_pagamento: paymentPayload,
  };
  if (hasIntermediaryRule) {
    payload.indicador_intermediario = input.intermediaryIndicator;
    if (input.intermediaryIndicator === "1") {
      payload.cnpj_intermediario = digits(input.intermediaryCnpj);
      payload.id_intermediario = text(input.intermediaryId, 60);
    }
  }
  if (/^\d{11}$/.test(cpf)) payload.cpf_destinatario = cpf;
  if (/^[A-Z0-9]{14}$/.test(recipientCnpj)) payload.cnpj_destinatario = recipientCnpj;
  if (recipientName && (cpf || recipientCnpj)) payload.nome_destinatario = recipientName;
  if (homeDelivery) {
    const postalCode = digits(delivery.postalCode);
    const cityCode = digits(delivery.cityCode);
    Object.assign(payload, {
      logradouro_destinatario: text(delivery.street, 60),
      numero_destinatario: text(delivery.number, 60),
      bairro_destinatario: text(delivery.district, 60),
      municipio_destinatario: text(delivery.city, 60),
      uf_destinatario: deliveryState,
    });
    if (text(delivery.complement, 60)) payload.complemento_destinatario = text(delivery.complement, 60);
    if (/^\d{7}$/.test(cityCode)) payload.codigo_municipio_destinatario = cityCode;
    if (/^\d{8}$/.test(postalCode)) payload.cep_destinatario = postalCode;
    if (input.transporter.mode === "own") {
      const issuerName = text(company.trade_name || company.legal_name, 60);
      const issuerAddress = [place.street, place.number, place.complement, place.district].map(value => text(value, 60)).filter(Boolean).join(", ").slice(0, 60);
      payload.cnpj_transportador = cnpj;
      if (issuerName) payload.nome_transportador = issuerName;
      if (text(company.state_registration, 14)) payload.inscricao_estadual_transportador = text(company.state_registration, 14);
      if (issuerAddress) payload.endereco_transportador = issuerAddress;
      if (text(place.city, 60)) payload.municipio_transportador = text(place.city, 60);
      if (issuerState) payload.uf_transportador = issuerState;
    } else {
      const carrier = input.transporter;
      const carrierCnpj = digits(carrier.cnpj), carrierCpf = digits(carrier.cpf);
      if (carrierCnpj) payload.cnpj_transportador = carrierCnpj;
      if (carrierCpf) payload.cpf_transportador = carrierCpf;
      if (text(carrier.name, 60)) payload.nome_transportador = text(carrier.name, 60);
      if (text(carrier.stateRegistration, 14)) payload.inscricao_estadual_transportador = text(carrier.stateRegistration, 14);
      if (text(carrier.address, 60)) payload.endereco_transportador = text(carrier.address, 60);
      if (text(carrier.city, 60)) payload.municipio_transportador = text(carrier.city, 60);
      if (/^[A-Z]{2}$/.test(text(carrier.state, 2).toUpperCase())) payload.uf_transportador = text(carrier.state, 2).toUpperCase();
    }
  }
  if (changeCents > 0) payload.valor_troco = money(changeCents);
  return { payload, issues: [...new Set(issues)], totalCents };
}
