import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new JvgBackendError("Identificador inválido.", 400);
  return value;
}

function itemsFrom(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new JvgBackendError("Informe entre 1 e 100 itens.", 400);
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new JvgBackendError("Item inválido.", 400);
    }
    const item = entry as Record<string, unknown>;
    const productId = item.productId == null ? null : uuid(item.productId);
    const serviceId = item.serviceId == null ? null : uuid(item.serviceId);
    if (!!productId === !!serviceId) throw new JvgBackendError("Informe somente produto ou serviço.", 400);
    const quantity = item.quantity;
    const price = item.unitPrice;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 999999 ||
        typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 999999999 ||
        Math.abs(Math.round(price * 100) - price * 100) > 1e-7) {
      throw new JvgBackendError("Quantidade ou preço inválido.", 400);
    }
    return { product_id: productId, service_id: serviceId, quantity, unit_price: price };
  });
}

async function accountForRequest() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return account;
}

export async function GET(request: Request) {
  try {
    const account = await accountForRequest();
    const url = new URL(request.url);
    const pageRaw = url.searchParams.get("page") ?? "1";
    if (!/^[1-9]\\d{0,5}$/.test(pageRaw)) throw new JvgBackendError("Página inválida.", 400);
    const page = Number(pageRaw);
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    const scope = `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
    const rows = await dbRequest<Array<Record<string, unknown>>>(
      `/rest/v1/jvg_sales?${scope}&select=id,customer_id,status,subtotal,discount_total,total,notes,created_at&order=created_at.desc,id.desc&limit=${pageSize + 1}&offset=${offset}`,
    );
    return apiJson({ sales: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await accountForRequest();
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para registrar vendas.", 403);
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new JvgBackendError("Venda inválida.", 400);
    const data = input as Record<string, unknown>;
    const customerId = data.customerId == null ? null : uuid(data.customerId);
    const requestId = uuid(data.requestId);
    const items = itemsFrom(data.items);
    const notes = data.notes == null ? null : data.notes;
    if (notes !== null && (typeof notes !== "string" || notes.length > 2000)) {
      throw new JvgBackendError("Observações inválidas.", 400);
    }
    const saleId = await dbRequest<string>("/rest/v1/rpc/jvg_confirm_sale", {
      method: "POST",
      body: JSON.stringify({
        p_tenant_id: account.tenant_id,
        p_company_id: account.company_id,
        p_customer_id: customerId,
        p_items: items,
        p_notes: notes,
        p_request_id: requestId,
      }),
    });
    return apiJson({ ok: true, saleId }, 201);
  } catch (error) { return safeError(error); }
}
