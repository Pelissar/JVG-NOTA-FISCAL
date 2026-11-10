import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new JvgBackendError("Identificador inválido.", 400);
  return value;
}
async function account() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const result = await getSiteAccount(user);
  if (!result) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return result;
}
export async function GET(request: Request) {
  try {
    const scope = await account();
    const raw = new URL(request.url).searchParams.get("page") ?? "1";
    if (!/^[1-9]\d{0,4}$/.test(raw)) throw new JvgBackendError("Página inválida.", 400);
    const page = Number(raw), size = 30;
    const rows = await dbRequest<Array<Record<string, unknown>>>(
      `/rest/v1/jvg_quotes?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&select=id,customer_id,status,notes,valid_until,total,items,created_at,updated_at&order=created_at.desc,id.desc&limit=${size+1}&offset=${(page-1)*size}`
    );
    return apiJson({ quotes: rows.slice(0,size), page, hasMore: rows.length > size });
  } catch (error) { return safeError(error); }
}
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const scope = await account();
    if (scope.role === "viewer") throw new JvgBackendError("Sem permissão para criar orçamentos.", 403);
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new JvgBackendError("Orçamento inválido.", 400);
    const data = input as Record<string, unknown>;
    const customerId = data.customerId == null ? null : uuid(data.customerId);
    const notes = data.notes == null ? "" : data.notes;
    if (typeof notes !== "string" || notes.length > 2000) throw new JvgBackendError("Observações inválidas.", 400);
    const validUntil = data.validUntil == null || data.validUntil === "" ? null : data.validUntil;
    if (validUntil !== null && (typeof validUntil !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || !Number.isFinite(Date.parse(validUntil)) || new Date(validUntil).toISOString().slice(0,10) !== validUntil))
      throw new JvgBackendError("Validade inválida.", 400);
    if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 100) throw new JvgBackendError("Informe entre 1 e 100 itens.", 400);
    const companyScope = `tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}`;
    if (customerId) {
      const customer = await dbRequest<Array<{id:string}>>(`/rest/v1/jvg_parties?${companyScope}&id=${filterEq(customerId)}&is_customer=eq.true&active=eq.true&select=id&limit=1`);
      if (!customer.length) throw new JvgBackendError("Cliente indisponível nesta empresa.", 400);
    }
    // Consulta apenas os IDs presentes na proposta: evita rejeitar itens além dos 1000 primeiros.
    const productIds = [...new Set(data.items.filter((entry: unknown) => entry && typeof entry === "object" && !Array.isArray(entry)).map((entry: Record<string,unknown>) => entry.productId).filter((id: unknown) => id != null).map(uuid))];
    const serviceIds = [...new Set(data.items.filter((entry: unknown) => entry && typeof entry === "object" && !Array.isArray(entry)).map((entry: Record<string,unknown>) => entry.serviceId).filter((id: unknown) => id != null).map(uuid))];
    const products = productIds.length ? await dbRequest<Array<{id:string;name:string;unit:string}>>(`/rest/v1/jvg_products?${companyScope}&active=eq.true&id=in.(${productIds.join(",")})&select=id,name,unit`) : [];
    const services = serviceIds.length ? await dbRequest<Array<{id:string;name:string}>>(`/rest/v1/jvg_services?${companyScope}&active=eq.true&id=in.(${serviceIds.join(",")})&select=id,name`) : [];
    const productById = new Map(products.map(p=>[p.id,p]));
    const serviceById = new Map(services.map(s=>[s.id,s]));
    let totalCents = 0;
    const items = data.items.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new JvgBackendError("Item inválido.", 400);
      const row = entry as Record<string,unknown>;
      const productId = row.productId == null ? null : uuid(row.productId);
      const serviceId = row.serviceId == null ? null : uuid(row.serviceId);
      if (!!productId === !!serviceId) throw new JvgBackendError("Informe produto ou serviço.", 400);
      const product = productId ? productById.get(productId) : null;
      const service = serviceId ? serviceById.get(serviceId) : null;
      if (!product && !service) throw new JvgBackendError("Item indisponível nesta empresa.", 400);
      const quantity = row.quantity, unitPrice = row.unitPrice;
      if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 999999 ||
          typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 999999999 ||
          Math.abs(Math.round(unitPrice * 100) - unitPrice * 100) > 1e-7)
        throw new JvgBackendError("Quantidade ou preço inválido.", 400);
      const lineCents = Math.round(quantity * Math.round(unitPrice * 100));
      if (!Number.isSafeInteger(lineCents)) throw new JvgBackendError("Total inválido.", 400);
      totalCents += lineCents;
      if (!Number.isSafeInteger(totalCents) || totalCents > 99999999999) throw new JvgBackendError("Total excede o limite.", 400);
      const optionalText = (value: unknown, label: string, max: number) => {
        if (value == null || value === "") return "";
        if (typeof value !== "string" || value.length > max) throw new JvgBackendError(label + " inválido.", 400);
        return value.trim();
      };
      return {
        productId, serviceId, description: product?.name ?? service?.name, unit: product?.unit ?? "UN",
        quantity, unitPrice, lineTotal: lineCents/100,
        brand: optionalText(row.brand, "Marca", 80),
        model: optionalText(row.model, "Modelo", 120),
        serialNumber: optionalText(row.serialNumber, "Número de série", 120),
        serviceDescription: optionalText(row.serviceDescription, "Descrição do serviço", 2000),
      };
    });
    const created = await dbRequest<Array<{id:string}>>("/rest/v1/jvg_quotes", {
      method: "POST",
      body: JSON.stringify({ tenant_id:scope.tenant_id, company_id:scope.company_id, customer_id:customerId,
        notes, valid_until:validUntil, status:"draft", items, total:totalCents/100 }),
    });
    return apiJson({ ok:true, id:created[0]?.id }, 201);
  } catch (error) { return safeError(error); }
}

/** Mudança de situação com transição condicional para evitar sobrescrever atualizações concorrentes. */
export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const scope = await account();
    if (scope.role === "viewer") throw new JvgBackendError("Sem permissão para alterar orçamentos.", 403);
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new JvgBackendError("Alteração inválida.", 400);
    const data = input as Record<string, unknown>;
    const id = uuid(data.id);
    const from = data.fromStatus;
    const to = data.status;
    const transitions: Record<string, readonly string[]> = {
      draft: ["sent", "rejected"],
      sent: ["accepted", "rejected", "expired"],
    };
    if (typeof from !== "string" || typeof to !== "string" || !transitions[from]?.includes(to))
      throw new JvgBackendError("Transição de situação não permitida.", 400);
    const companyScope = `tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}`;
    const todayParts = new Intl.DateTimeFormat("en-US", { timeZone:"America/Sao_Paulo", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
    const part = (type:string) => todayParts.find(item=>item.type===type)?.value ?? "";
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    const validityFilter = to === "accepted" ? `&or=(valid_until.is.null,valid_until.gte.${today})` : "";
    const updated = await dbRequest<Array<{ id:string; status:string }>>(
      `/rest/v1/jvg_quotes?${companyScope}&id=${filterEq(id)}&status=${filterEq(from)}${validityFilter}&select=id,status`,
      { method: "PATCH", body: JSON.stringify({ status:to, updated_at:new Date().toISOString() }) }
    );
    if (!updated.length) throw new JvgBackendError("Orçamento indisponível, vencido ou alterado por outro usuário. Atualize a lista.", 409);
    return apiJson({ ok:true, quote:updated[0] });
  } catch (error) { return safeError(error); }
}
