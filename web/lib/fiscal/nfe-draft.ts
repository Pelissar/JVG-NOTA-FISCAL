import { parseFocusTaxFields, type FocusTaxFields } from "./focus-tax-fields.ts";

export const MAX_NFE_DRAFT_ITEMS = 20;

export type NfeDraftItemInput = {
  productId: string;
  ncm?: string;
  cest?: string;
  origin?: string;
  quantity: number;
  quantityMilli: number;
  unitPriceCents: number;
  subtotalCents: number;
  cfop: string;
  csosn: string;
  pisCst: string;
  cofinsCst: string;
  focusFields: FocusTaxFields;
};

export type NfeDraftVehicleInput = {
  plate: string;
  state: string | null;
  rntc: string | null;
};

export type NfeDraftVolumeInput = {
  quantity: number;
  species: string | null;
  brand: string | null;
  number: string | null;
  netWeightMilli: number | null;
  grossWeightMilli: number | null;
};

export type NfeDraftPaymentInput = {
  indicator: number;
  method: string;
  amountCents: number;
  description: string | null;
  paymentDate: string | null;
  integration: number | null;
  acquirerCnpj: string | null;
  authorizationNumber: string | null;
};

export type NfeDraftAdditionalTotals = {
  freightCents: number;
  insuranceCents: number;
  discountCents: number;
  expensesCents: number;
};

export type NfeDraftInput = {
  recipientId: string;
  nature: string;
  purpose: number | null;
  issueAt: string | null;
  exitAt: string | null;
  consumerFinal: boolean | null;
  buyerPresence: number | null;
  recipientIeIndicator: number | null;
  transportMode: number | null;
  carrierId: string | null;
  vehicle: NfeDraftVehicleInput | null;
  volumes: NfeDraftVolumeInput[];
  additionalTotals: NfeDraftAdditionalTotals;
  payments: NfeDraftPaymentInput[];
  intermediary: { indicator: number | null; cnpj: string | null; id: string | null };
  additionalInfo: string | null;
  items: NfeDraftItemInput[];
  totalCents: number;
  sourceOrderId: string | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const csosnCodes = new Set(["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]);
const purposeCodes = new Set([1, 2, 3, 4]);
const buyerPresenceCodes = new Set([0, 1, 2, 3, 4, 5, 9]);
const freightModeCodes = new Set([0, 1, 2, 3, 4, 9]);
const ieIndicatorCodes = new Set([1, 2, 9]);
const intermediaryCodes = new Set([0, 1]);
const paymentIndicatorCodes = new Set([0, 1]);
const paymentMethods = new Set(["01", "02", "03", "04", "05", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "90", "91", "99"]);

function optionalCode(value: unknown, allowed: Set<number>, label: string): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || !allowed.has(parsed)) throw new Error(`${label} inválido.`);
  return parsed;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  throw new Error("Informe se a operação é com consumidor final.");
}


function optionalText(value: unknown, maxLength: number, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} inválido.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error(`${label} deve ter no máximo ${maxLength} caracteres.`);
  return normalized;
}

function parseVehicle(raw: unknown): NfeDraftVehicleInput | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Dados do veículo inválidos.");
  const data = raw as Record<string, unknown>;
  const plate = (optionalText(data.plate, 7, "Placa do veículo") || "").toUpperCase();
  const state = (optionalText(data.state, 2, "UF do veículo") || "").toUpperCase() || null;
  const rntc = optionalText(data.rntc, 20, "RNTC do veículo");
  if (!plate && !state && !rntc) return null;
  if (!/^[A-Z0-9]{7}$/.test(plate)) throw new Error("Informe a placa do veículo com 7 letras ou números.");
  if (state && !/^[A-Z]{2}$/.test(state)) throw new Error("A UF do veículo deve ter duas letras.");
  return { plate, state, rntc };
}

function optionalWeightMilli(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,12}(?:\.\d{1,3})?$/.test(raw))
    throw new Error(`${label} deve ser positivo e ter no máximo 3 casas decimais.`);
  const milli = Math.round(Number(raw) * 1000);
  if (!Number.isSafeInteger(milli) || milli <= 0)
    throw new Error(`${label} deve ser positivo e ter no máximo 3 casas decimais.`);
  return milli;
}

function parseVolumes(raw: unknown): NfeDraftVolumeInput[] {
  if (raw == null || raw === "") return [];
  if (!Array.isArray(raw) || raw.length > 5000) throw new Error("Informe uma lista válida de volumes.");
  const volumes: NfeDraftVolumeInput[] = [];
  raw.forEach((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Volume ${index + 1} inválido.`);
    const data = entry as Record<string, unknown>;
    const quantityRaw = data.quantity == null ? "" : String(data.quantity).trim();
    const species = optionalText(data.species, 60, `Espécie do volume ${index + 1}`);
    const brand = optionalText(data.brand, 60, `Marca do volume ${index + 1}`);
    const number = optionalText(data.number, 60, `Identificação do volume ${index + 1}`);
    const netWeightMilli = optionalWeightMilli(data.netWeight, `Peso líquido do volume ${index + 1}`);
    const grossWeightMilli = optionalWeightMilli(data.grossWeight, `Peso bruto do volume ${index + 1}`);
    if (!quantityRaw && !species && !brand && !number && netWeightMilli === null && grossWeightMilli === null) return;
    const quantity = /^\d{1,15}$/.test(quantityRaw) ? Number(quantityRaw) : NaN;
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      throw new Error(`Informe a quantidade inteira de volumes no item ${index + 1}.`);
    if (netWeightMilli !== null && grossWeightMilli !== null && netWeightMilli > grossWeightMilli)
      throw new Error(`O peso líquido do volume ${index + 1} não pode superar o peso bruto.`);
    volumes.push({ quantity, species, brand, number, netWeightMilli, grossWeightMilli });
  });
  return volumes;
}

function optionalIssueAt(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Data e hora devem incluir um fuso horário válido.");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value)))
    throw new Error("Data e hora devem incluir um fuso horário válido.");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const offsetHour = Number(offsetHourText || 0), offsetMinute = Number(offsetMinuteText || 0);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const validCalendar = year >= 1900 && month >= 1 && month <= 12 && day >= 1 &&
    calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
  const validTime = hour <= 23 && minute <= 59 && second <= 59;
  const validOffset = offsetHour < 14 || (offsetHour === 14 && offsetMinute === 0);
  if (!validCalendar || !validTime || !validOffset || offsetMinute > 59)
    throw new Error("Data e hora devem incluir um fuso horário válido.");
  return value;
}

/** Valida rascunho comercial; NÃO calcula tributos nem cria um XML fiscal. */
function optionalDate(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(label + " inválida.");
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(label + " inválida.");
  return value;
}
function optionalMoneyCents(value: unknown, label: string): number {
  if (value == null || value === "") return 0;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999999999.99 || Math.abs(Math.round(parsed * 100) - parsed * 100) > 0.000001)
    throw new Error(label + " deve ser não negativo e ter no máximo duas casas decimais.");
  return Math.round(parsed * 100);
}
function parsePayments(raw: unknown): NfeDraftPaymentInput[] {
  if (raw == null || raw === "") return [];
  if (!Array.isArray(raw) || raw.length > 100) throw new Error("Informe no máximo 100 formas de pagamento.");
  return raw.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("A forma de pagamento " + (index + 1) + " é inválida.");
    const payment = entry as Record<string, unknown>;
    const indicator = optionalCode(payment.indicator, paymentIndicatorCodes, "Indicador de pagamento");
    const method = typeof payment.method === "string" ? payment.method.trim() : "";
    if (indicator === null) throw new Error("Selecione se o pagamento " + (index + 1) + " é à vista ou a prazo.");
    if (!paymentMethods.has(method)) throw new Error("Selecione uma forma de pagamento válida na linha " + (index + 1) + ".");
    if (payment.amount == null || payment.amount === "") throw new Error("Informe o valor do pagamento " + (index + 1) + ".");
    const amountCents = optionalMoneyCents(payment.amount, "Valor do pagamento " + (index + 1));
    const integration = optionalCode(payment.integration, new Set([1, 2]), "Tipo de integração do pagamento");
    const description = optionalText(payment.description, 60, "Descrição do pagamento");
    const acquirerCnpj = optionalText(payment.acquirerCnpj, 18, "CNPJ da credenciadora");
    const authorizationNumber = optionalText(payment.authorizationNumber, 128, "Número de autorização do pagamento");
    return {
      indicator, method, amountCents, description,
      paymentDate: optionalDate(payment.paymentDate, "Data do pagamento"),
      integration, acquirerCnpj, authorizationNumber,
    };
  });
}
export function parseNfeDraftInput(raw: unknown): NfeDraftInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Informe os dados da NF-e.");
  const data = raw as Record<string, unknown>;
  const recipientId = typeof data.recipientId === "string" ? data.recipientId : "";
  if (!uuid.test(recipientId)) throw new Error("Escolha um destinatário cadastrado.");
  const sourceOrderRaw = data.sourceOrderId;
  if (sourceOrderRaw != null && sourceOrderRaw !== "" && (typeof sourceOrderRaw !== "string" || !uuid.test(sourceOrderRaw)))
    throw new Error("Pedido de origem inválido.");
  const sourceOrderId = typeof sourceOrderRaw === "string" && sourceOrderRaw ? sourceOrderRaw : null;
  const nature = typeof data.nature === "string" ? data.nature.trim() : "";
  if (nature.length < 3 || nature.length > 60) throw new Error("Informe a natureza da operação (3 a 60 caracteres).");
  const purpose = optionalCode(data.purpose, purposeCodes, "Finalidade da emissão");
  const issueAt = optionalIssueAt(data.issueAt);
  const exitAt = optionalIssueAt(data.exitAt);
  const consumerFinal = optionalBoolean(data.consumerFinal);
  const buyerPresence = optionalCode(data.buyerPresence, buyerPresenceCodes, "Presença do comprador");
  const recipientIeIndicator = optionalCode(data.recipientIeIndicator, ieIndicatorCodes, "Recipient IE indicator");
  const transportMode = optionalCode(data.transportMode, freightModeCodes, "Modalidade do frete");
  const vehicle = parseVehicle(data.vehicle);
  const volumes = parseVolumes(data.volumes);
  const totalsRaw = data.additionalTotals && typeof data.additionalTotals === "object" && !Array.isArray(data.additionalTotals)
    ? data.additionalTotals as Record<string, unknown> : {};
  const additionalTotals = {
    freightCents: optionalMoneyCents(totalsRaw.freight, "Frete"),
    insuranceCents: optionalMoneyCents(totalsRaw.insurance, "Seguro"),
    discountCents: optionalMoneyCents(totalsRaw.discount, "Desconto"),
    expensesCents: optionalMoneyCents(totalsRaw.expenses, "Outras despesas"),
  };
  const payments = parsePayments(data.payments);
  const intermediaryRaw = data.intermediary && typeof data.intermediary === "object" && !Array.isArray(data.intermediary)
    ? data.intermediary as Record<string, unknown> : {};
  const intermediary = {
    indicator: optionalCode(intermediaryRaw.indicator, intermediaryCodes, "Indicador de intermediador"),
    cnpj: optionalText(intermediaryRaw.cnpj, 18, "CNPJ do intermediador"),
    id: optionalText(intermediaryRaw.id, 60, "Identificador no intermediador"),
  };
  const additionalInfo = optionalText(data.additionalInfo, 5000, "Informações adicionais");
  let carrierId: string | null = null;
  if (data.carrierId != null && data.carrierId !== "") {
    if (typeof data.carrierId !== "string" || !uuid.test(data.carrierId))
      throw new Error("Selecione uma transportadora cadastrada válida.");
    carrierId = data.carrierId;
  }
  if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > MAX_NFE_DRAFT_ITEMS)
    throw new Error("Informe entre 1 e 20 produtos.");

  let totalCents = 0;
  const items: NfeDraftItemInput[] = data.items.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Item inválido.");
    const p = item as Record<string, unknown>;
    if (typeof p.productId !== "string" || !uuid.test(p.productId)) throw new Error("Selecione um produto válido.");
    if (p.quantity === "" || p.unitPrice === "") throw new Error("Informe quantidade e preço.");
    const quantity = Number(p.quantity), unitPrice = Number(p.unitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) throw new Error("Quantidade inválida.");
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 999999.99) throw new Error("Preço unitário inválido.");
    const quantityMilli = Math.round(quantity * 1000), unitPriceCents = Math.round(unitPrice * 100);
    if (Math.abs(quantityMilli - quantity * 1000) > 0.000001) throw new Error("Quantidade aceita até 3 casas decimais.");
    if (Math.abs(unitPriceCents - unitPrice * 100) > 0.000001) throw new Error("Preço aceito até 2 casas decimais.");
    const cfop = typeof p.cfop === "string" ? p.cfop.trim() : "";
    const ncm = Object.hasOwn(p, "ncm") ? (typeof p.ncm === "string" ? p.ncm.replace(/\D/g, "") : "") : undefined;
    const cest = Object.hasOwn(p, "cest") ? (typeof p.cest === "string" ? p.cest.replace(/\D/g, "") : "") : undefined;
    const origin = Object.hasOwn(p, "origin") ? (typeof p.origin === "string" ? p.origin.trim() : "") : undefined;
    const csosn = typeof p.csosn === "string" ? p.csosn.trim() : "";
    const pisCst = typeof p.pisCst === "string" ? p.pisCst.trim() : "";
    const cofinsCst = typeof p.cofinsCst === "string" ? p.cofinsCst.trim() : "";
    if (cfop && !/^[1-7][0-9]{3}$/.test(cfop)) throw new Error("CFOP deve ter quatro dígitos.");
    if (ncm !== undefined && ncm && !/^\d{8}$/.test(ncm)) throw new Error("NCM do item deve conter oito dígitos.");
    if (cest !== undefined && cest && !/^\d{7}$/.test(cest)) throw new Error("CEST do item deve conter sete dígitos.");
    if (origin !== undefined && origin && !/^[0-8]$/.test(origin)) throw new Error("Origem da mercadoria deve ser um código de 0 a 8.");
    if (csosn && !csosnCodes.has(csosn)) throw new Error("CSOSN inválido para o Simples Nacional.");
    if (pisCst && !/^\d{2}$/.test(pisCst)) throw new Error("CST do PIS deve ter dois dígitos.");
    if (cofinsCst && !/^\d{2}$/.test(cofinsCst)) throw new Error("CST da Cofins deve ter dois dígitos.");
    let focusFields: FocusTaxFields;
    try { focusFields = parseFocusTaxFields(p.focusFields); }
    catch (error) { throw new Error(error instanceof Error ? error.message : "Campos fiscais do item inválidos."); }
    const subtotalCents = Math.round(quantityMilli * unitPriceCents / 1000);
    totalCents += subtotalCents;
    if (!Number.isSafeInteger(totalCents) || totalCents > 100_000_000_000)
      throw new Error("Valor total acima do limite para rascunho.");
    return { productId: p.productId, ...(ncm !== undefined ? { ncm } : {}), ...(cest !== undefined ? { cest } : {}),
      ...(origin !== undefined ? { origin } : {}), quantity, quantityMilli, unitPriceCents, subtotalCents,
      cfop, csosn, pisCst, cofinsCst, focusFields };
  });

  const grossCommercialCents = totalCents + additionalTotals.freightCents + additionalTotals.insuranceCents + additionalTotals.expensesCents;
  if (additionalTotals.discountCents > grossCommercialCents)
    throw new Error("O desconto comercial não pode superar o valor dos produtos e dos demais acréscimos.");

  return {
    recipientId, nature, purpose, issueAt, exitAt, consumerFinal, buyerPresence, recipientIeIndicator,
    transportMode, carrierId, vehicle, volumes, additionalTotals, payments, intermediary, additionalInfo,
    items, totalCents, sourceOrderId,
  };
}
