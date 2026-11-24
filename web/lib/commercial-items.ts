import { dbRequest, filterEq, JvgBackendError, type SiteAccount } from "./jvg-backend";

type CommercialItem = {
  productId: string | null;
  serviceId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new JvgBackendError("Identificador de item inválido.", 400);
  return value;
}

/** Valida os itens, confere o catálogo dentro da empresa e recalcula os totais no servidor. */
export async function prepareCommercialItems(
  value: unknown,
  account: Pick<SiteAccount, "tenant_id" | "company_id">,
  previousItems: unknown[] = [],
): Promise<{ items: CommercialItem[]; total: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new JvgBackendError("Informe entre 1 e 100 itens.", 400);
  }

  const source = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new JvgBackendError("Item inválido.", 400);
    const row = entry as Record<string, unknown>;
    const productId = row.productId == null || row.productId === "" ? null : uuid(row.productId);
    const serviceId = row.serviceId == null || row.serviceId === "" ? null : uuid(row.serviceId);
    if (!!productId === !!serviceId) throw new JvgBackendError("Informe produto ou serviço para cada item.", 400);
    const quantity = row.quantity;
    const unitPrice = row.unitPrice;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 999999 ||
        typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 999999999 ||
        Math.abs(Math.round(unitPrice * 100) - unitPrice * 100) > 1e-7) {
      throw new JvgBackendError("Quantidade ou preço inválido.", 400);
    }
    return { productId, serviceId, quantity, unitPrice };
  });

  const productIds = [...new Set(source.flatMap((row) => row.productId ? [row.productId] : []))];
  const serviceIds = [...new Set(source.flatMap((row) => row.serviceId ? [row.serviceId] : []))];
  const companyScope = `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
  const [products, services] = await Promise.all([
    productIds.length
      ? dbRequest<Array<{ id: string; name: string; unit: string; active: boolean }>>(
          `/rest/v1/jvg_products?${companyScope}&id=in.(${productIds.join(",")})&select=id,name,unit,active`,
        )
      : Promise.resolve([]),
    serviceIds.length
      ? dbRequest<Array<{ id: string; name: string; active: boolean }>>(
          `/rest/v1/jvg_services?${companyScope}&id=in.(${serviceIds.join(",")})&select=id,name,active`,
        )
      : Promise.resolve([]),
  ]);
  const productById = new Map(products.map((row) => [row.id, row]));
  const serviceById = new Map(services.map((row) => [row.id, row]));
  let totalCents = 0;

  const items = source.map((row) => {
    const product = row.productId ? productById.get(row.productId) : null;
    const service = row.serviceId ? serviceById.get(row.serviceId) : null;
    if (!product && !service) throw new JvgBackendError("Produto ou serviço não encontrado nesta empresa.", 400);

    const old = previousItems.find((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const previous = entry as Record<string, unknown>;
      return (row.productId && previous.productId === row.productId || row.serviceId && previous.serviceId === row.serviceId) &&
        Number(previous.quantity) === row.quantity && Number(previous.unitPrice) === row.unitPrice;
    }) as Record<string, unknown> | undefined;
    const active = product ? product.active !== false : service?.active !== false;
    if (!active && !old) throw new JvgBackendError("Um item está inativo no cadastro. Reative-o ou remova-o antes de salvar.", 409);

    const lineCents = Math.round(row.quantity * Math.round(row.unitPrice * 100));
    if (!Number.isSafeInteger(lineCents)) throw new JvgBackendError("Total do item inválido.", 400);
    totalCents += lineCents;
    if (!Number.isSafeInteger(totalCents) || totalCents > 99999999999) throw new JvgBackendError("Total excede o limite permitido.", 400);

    return {
      productId: row.productId,
      serviceId: row.serviceId,
      description: product?.name ?? service?.name ?? String(old?.description ?? "Item comercial"),
      unit: product?.unit ?? String(old?.unit ?? "UN"),
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      lineTotal: lineCents / 100,
    };
  });

  return { items, total: totalCents / 100 };
}

export async function validateCommercialCustomer(
  customerId: unknown,
  account: Pick<SiteAccount, "tenant_id" | "company_id">,
): Promise<string | null> {
  if (customerId == null || customerId === "") return null;
  if (typeof customerId !== "string" || !uuidPattern.test(customerId)) throw new JvgBackendError("Cliente inválido.", 400);
  const scope = `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
  const customer = await dbRequest<Array<{ id: string }>>(
    `/rest/v1/jvg_parties?${scope}&id=${filterEq(customerId)}&is_customer=eq.true&active=eq.true&select=id&limit=1`,
  );
  if (!customer.length) throw new JvgBackendError("Cliente indisponível nesta empresa.", 400);
  return customerId;
}
