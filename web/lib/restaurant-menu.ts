export type RestaurantMenuChoice = { id: string; name: string; price: number };
export type RestaurantMenuOption = { id: string; name: string; min: number; max: number; choices: RestaurantMenuChoice[] };
export type RestaurantMenuComponent = { productId: string; quantity: number };
export type RestaurantMenuPromotion = { label: string; price: number; startsAt: string | null; endsAt: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeMenuOptions(value: unknown): RestaurantMenuOption[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const result: RestaurantMenuOption[] = [];
  const groupIds = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const min = Number(row.min);
    const max = Number(row.max);
    if (!UUID.test(id) || groupIds.has(id) || name.length < 2 || name.length > 60 || !Array.isArray(row.choices) || row.choices.length < 1 || row.choices.length > 20) return null;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || max > row.choices.length || min > max) return null;
    groupIds.add(id);
    const choiceIds = new Set<string>();
    const choices: RestaurantMenuChoice[] = [];
    for (const rawChoice of row.choices) {
      if (!rawChoice || typeof rawChoice !== "object") return null;
      const choice = rawChoice as Record<string, unknown>;
      const choiceId = typeof choice.id === "string" ? choice.id : "";
      const choiceName = typeof choice.name === "string" ? choice.name.trim() : "";
      const price = Number(choice.price);
      if (!UUID.test(choiceId) || choiceIds.has(choiceId) || choiceName.length < 1 || choiceName.length > 60 || !Number.isFinite(price) || price < 0 || price > 100000) return null;
      choiceIds.add(choiceId);
      choices.push({ id: choiceId, name: choiceName, price: Math.round(price * 100) / 100 });
    }
    result.push({ id, name, min, max, choices });
  }
  return result;
}

export function normalizeMenuComponents(value: unknown): RestaurantMenuComponent[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const result: RestaurantMenuComponent[] = [];
  const products = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const productId = typeof row.productId === "string" ? row.productId : "";
    const quantity = Number(row.quantity);
    if (!UUID.test(productId) || products.has(productId) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 99.999 || Math.round(quantity * 1000) !== quantity * 1000) return null;
    products.add(productId);
    result.push({ productId, quantity });
  }
  return result;
}

export function normalizeMenuPromotion(value: unknown, basePrice: number): RestaurantMenuPromotion | null | undefined {
  if (value === null || value === undefined || value === false) return null;
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const label = typeof row.label === "string" ? row.label.trim() : "";
  const price = Number(row.price);
  const startsAt = typeof row.startsAt === "string" && row.startsAt ? row.startsAt : null;
  const endsAt = typeof row.endsAt === "string" && row.endsAt ? row.endsAt : null;
  if (label.length > 60 || !Number.isFinite(price) || price < 0 || price >= basePrice || (startsAt && !Number.isFinite(Date.parse(startsAt))) || (endsAt && !Number.isFinite(Date.parse(endsAt))) || (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt))) return undefined;
  return { label: label || "Oferta", price: Math.round(price * 100) / 100, startsAt, endsAt };
}

export function currentMenuPrice(basePrice: number, promotion: RestaurantMenuPromotion | null | undefined, now = Date.now()) {
  if (!promotion) return basePrice;
  if (promotion.startsAt && Date.parse(promotion.startsAt) > now) return basePrice;
  if (promotion.endsAt && Date.parse(promotion.endsAt) <= now) return basePrice;
  return promotion.price;
}

export function resolveMenuChoices(groups: RestaurantMenuOption[], selectedIds: string[]) {
  const selected = new Set(selectedIds);
  const choiceById = new Map<string, RestaurantMenuChoice>();
  for (const group of groups) for (const choice of group.choices) choiceById.set(choice.id, choice);
  if ([...selected].some((id) => !choiceById.has(id))) return { valid: false, selected: [] as RestaurantMenuChoice[], extraPrice: 0, error: "Uma opção selecionada não está mais disponível. Atualize o cardápio." };
  for (const group of groups) {
    const count = group.choices.filter((choice) => selected.has(choice.id)).length;
    if (count < group.min) return { valid: false, selected: [] as RestaurantMenuChoice[], extraPrice: 0, error: `Escolha pelo menos ${group.min} opção(ões) em ${group.name}.` };
    if (count > group.max) return { valid: false, selected: [] as RestaurantMenuChoice[], extraPrice: 0, error: `Escolha no máximo ${group.max} opção(ões) em ${group.name}.` };
  }
  const selectedChoices = [...selected].map((id) => choiceById.get(id)!).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return { valid: true, selected: selectedChoices, extraPrice: selectedChoices.reduce((sum, choice) => sum + choice.price, 0), error: "" };
}
