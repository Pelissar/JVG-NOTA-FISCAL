export const MAX_NFE_DRAFT_ITEMS = 20;

export type NfeDraftItemInput = {
  productId: string;
  quantity: number;
  quantityMilli: number;
  unitPriceCents: number;
  subtotalCents: number;
  cfop: string;
  csosn: string;
};

export type NfeDraftInput = {
  recipientId: string;
  nature: string;
  purpose: number | null;
  issueAt: string | null;
  consumerFinal: boolean | null;
  buyerPresence: number | null;
  transportMode: number | null;
  carrierId: string | null;
  items: NfeDraftItemInput[];
  totalCents: number;
  sourceOrderId: string | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const csosnCodes = new Set(["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]);
const purposeCodes = new Set([1, 2, 3, 4]);
const buyerPresenceCodes = new Set([0, 1, 2, 3, 4, 5, 9]);
const freightModeCodes = new Set([0, 1, 2, 3, 4, 9]);

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
  const consumerFinal = optionalBoolean(data.consumerFinal);
  const buyerPresence = optionalCode(data.buyerPresence, buyerPresenceCodes, "Presença do comprador");
  const transportMode = optionalCode(data.transportMode, freightModeCodes, "Modalidade do frete");
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
    const csosn = typeof p.csosn === "string" ? p.csosn.trim() : "";
    if (cfop && !/^[1-7][0-9]{3}$/.test(cfop)) throw new Error("CFOP deve ter quatro dígitos.");
    if (csosn && !csosnCodes.has(csosn)) throw new Error("CSOSN inválido para o Simples Nacional.");
    const subtotalCents = Math.round(quantityMilli * unitPriceCents / 1000);
    totalCents += subtotalCents;
    if (!Number.isSafeInteger(totalCents) || totalCents > 100_000_000_000)
      throw new Error("Valor total acima do limite para rascunho.");
    return { productId: p.productId, quantity, quantityMilli, unitPriceCents, subtotalCents, cfop, csosn };
  });

  return { recipientId, nature, purpose, issueAt, consumerFinal, buyerPresence, transportMode, carrierId, items, totalCents, sourceOrderId };
}
