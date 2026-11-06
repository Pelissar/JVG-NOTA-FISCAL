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
  items: NfeDraftItemInput[];
  totalCents: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const csosnCodes = new Set(["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]);

/** Valida rascunho comercial; NÃO calcula tributos nem cria um XML fiscal. */
export function parseNfeDraftInput(raw: unknown): NfeDraftInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Informe os dados da NF-e.");
  const data = raw as Record<string, unknown>;
  const recipientId = typeof data.recipientId === "string" ? data.recipientId : "";
  if (!uuid.test(recipientId)) throw new Error("Escolha um destinatário cadastrado.");
  const nature = typeof data.nature === "string" ? data.nature.trim() : "";
  if (nature.length < 3 || nature.length > 100) throw new Error("Informe a natureza da operação (3 a 100 caracteres).");
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

  return { recipientId, nature, items, totalCents };
}
