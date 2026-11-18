import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, moduleAccessGranted, safeError, str } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Product = { id: string; name: string; description: string | null; sku: string; category: string | null; unit: string; sale_price: number | string; active: boolean };
type RestaurantScope = { tenant_id: string; company_id: string; role?: string };

async function requireRestaurant(): Promise<RestaurantScope> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const scope = await getSiteAccount(user, { requiredModule: "restaurante" });
  if (!scope) throw new JvgBackendError("Não encontramos uma empresa ativa para este usuário.", 409);
  const companies = await dbRequest<Array<{ business_type: string | null }>>(
    `/rest/v1/jvg_companies?tenant_id=${filterEq(scope.tenant_id)}&id=${filterEq(scope.company_id)}&select=business_type&limit=1`,
  );
  if (companies[0]?.business_type !== "restaurante") {
    throw new JvgBackendError("O atendimento por mesas está disponível para empresas cadastradas como restaurante.", 403);
  }
  return scope;
}

function requireWrite(scope: RestaurantScope) {
  if (scope.role === "viewer") throw new JvgBackendError("Seu acesso permite consulta, mas não alterar pedidos.", 403);
}

async function readPublicTable(token: string) {
  if (!UUID.test(token)) throw new JvgBackendError("Este QR Code não é válido.", 404);
  const tables = await dbRequest<Array<{ id: string; tenant_id: string; company_id: string; label: string; active: boolean; service_status: string }>>(
    `/rest/v1/jvg_restaurant_tables?qr_token=${filterEq(token)}&active=eq.true&select=id,tenant_id,company_id,label,active,service_status&limit=1`,
  );
  const table = tables[0];
  if (!table) throw new JvgBackendError("Esta mesa não está disponível. Peça ajuda à equipe.", 404);
  const [settings, companies] = await Promise.all([
    dbRequest<Array<{ qr_orders_enabled: boolean }>>(`/rest/v1/jvg_restaurant_settings?tenant_id=${filterEq(table.tenant_id)}&company_id=${filterEq(table.company_id)}&select=qr_orders_enabled&limit=1`),
    dbRequest<Array<{ business_type: string; trade_name: string | null; legal_name: string }>>(`/rest/v1/jvg_companies?tenant_id=${filterEq(table.tenant_id)}&id=${filterEq(table.company_id)}&select=business_type,trade_name,legal_name&limit=1`),
  ]);
  if (!settings[0]?.qr_orders_enabled || companies[0]?.business_type !== "restaurante") {
    throw new JvgBackendError("Os pedidos por QR estão temporariamente desativados.", 404);
  }
  if (!await moduleAccessGranted({ tenant_id: table.tenant_id, company_id: table.company_id }, "restaurante")) {
    throw new JvgBackendError("Os pedidos por QR estão suspensos porque o módulo Restaurante não está liberado para esta empresa.", 402);
  }
  await ensurePublicTenantAccess(table.tenant_id);
  return { table, company: companies[0] };
}

async function ensurePublicTenantAccess(tenantId: string) {
  const subscriptions = await dbRequest<Array<{ plan_code: string; status: string; current_period_ends_at: string | null; trial_ends_at: string | null; temporary_access_until: string | null }>>(
    `/rest/v1/jvg_subscriptions?tenant_id=${filterEq(tenantId)}&select=plan_code,status,current_period_ends_at,trial_ends_at,temporary_access_until&limit=1`,
  );
  const subscription = subscriptions[0];
  if (!subscription || subscription.plan_code === "pilot") return;
  if (["paused", "canceled", "incomplete"].includes(subscription.status)) {
    throw new JvgBackendError("Os pedidos por QR estão suspensos enquanto a assinatura da empresa estiver bloqueada.", 402);
  }
  if (subscription.status === "trialing" && subscription.trial_ends_at && Date.parse(subscription.trial_ends_at) > Date.now()) return;
  if (subscription.status === "active" && (!subscription.current_period_ends_at || Date.parse(subscription.current_period_ends_at) > Date.now())) return;
  if (["active", "past_due"].includes(subscription.status) && subscription.temporary_access_until && Date.parse(subscription.temporary_access_until) > Date.now()) return;
  if (["active", "past_due"].includes(subscription.status) && subscription.current_period_ends_at) {
    const plans = await dbRequest<Array<{ grace_period_days: number }>>(`/rest/v1/jvg_subscription_plans?code=${filterEq(subscription.plan_code)}&select=grace_period_days&limit=1`);
    const graceEndsAt = Date.parse(subscription.current_period_ends_at) + Math.max(0, Math.min(60, Number(plans[0]?.grace_period_days ?? 15))) * 86400000;
    if (graceEndsAt > Date.now()) return;
  }
  throw new JvgBackendError("Os pedidos por QR estão suspensos. Regularize a assinatura ou fale com a equipe financeira.", 402);
}

function parseItems(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new JvgBackendError("Adicione pelo menos um item ao pedido.", 400);
  const merged = new Map<string, number>();
  for (const row of value) {
    if (!row || typeof row !== "object") throw new JvgBackendError("Um item do pedido está inválido.", 400);
    const item = row as Record<string, unknown>;
    const id = str(item.productId, 40);
    const quantity = Number(item.quantity);
    if (!UUID.test(id) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 999 || Math.round(quantity * 1000) !== quantity * 1000) {
      throw new JvgBackendError("Confira os produtos e as quantidades do pedido.", 400);
    }
    merged.set(id, (merged.get(id) || 0) + quantity);
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

async function calculateItems(scope: Pick<RestaurantScope, "tenant_id" | "company_id">, items: Array<{ productId: string; quantity: number }>) {
  const ids = items.map((item) => item.productId);
  const products = await dbRequest<Product[]>(
    `/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=in.(${ids.join(",")})&active=eq.true&select=id,name,description,sku,category,unit,sale_price,active&limit=100`,
  );
  const byId = new Map(products.map((product) => [product.id, product]));
  if (byId.size !== ids.length) throw new JvgBackendError("Um produto foi removido ou está inativo. Atualize o cardápio e tente novamente.", 409);
  let total = 0;
  const snapshot = items.map((item) => {
    const product = byId.get(item.productId)!;
    const unitPrice = Number(product.sale_price);
    const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;
    total += lineTotal;
    return { product_id: product.id, sku: product.sku, description: product.name, unit: product.unit, quantity: item.quantity, unit_price: unitPrice, total: lineTotal };
  });
  return { snapshot, total: Math.round(total * 100) / 100 };
}

async function saveCustomer(scope: RestaurantScope, fullName: string, phoneInput: string, cpfInput: string, requireCpfMatch = false) {
  const phone = phoneInput.replace(/\D/g, "");
  const cpf = cpfInput.replace(/\D/g, "") || null;
  if (fullName.trim().length < 2 || fullName.trim().length > 120) throw new JvgBackendError("Informe o nome do cliente.", 400);
  if (!/^\d{10,13}$/.test(phone)) throw new JvgBackendError("Informe um telefone com DDD.", 400);
  if (cpf && !/^\d{11}$/.test(cpf)) throw new JvgBackendError("CPF opcional: informe os 11 dígitos ou deixe em branco.", 400);
  const existing = await dbRequest<Array<{ id: string; full_name: string; cpf: string | null }>>(
    `/rest/v1/jvg_restaurant_customers?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&phone=${filterEq(phone)}&select=id,full_name,cpf&limit=1`,
  );
  if (existing[0]) {
    if (requireCpfMatch && (!existing[0].cpf || existing[0].cpf !== cpf)) {
      throw new JvgBackendError("Esse telefone já está cadastrado com outro CPF. Peça à equipe para atualizar seus dados.", 409);
    }
    return { id: existing[0].id, name: existing[0].full_name, phone };
  }
  const inserted = await dbRequest<Array<{ id: string; full_name: string }>>("/rest/v1/jvg_restaurant_customers", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ tenant_id: scope.tenant_id, company_id: scope.company_id, full_name: fullName.trim(), phone, cpf }),
  });
  if (inserted[0]) return { id: inserted[0].id, name: inserted[0].full_name, phone };
  const raced = await dbRequest<Array<{ id: string; full_name: string }>>(
    `/rest/v1/jvg_restaurant_customers?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&phone=${filterEq(phone)}&select=id,full_name&limit=1`,
  );
  if (!raced[0]) throw new JvgBackendError("Não foi possível registrar o cliente.");
  return { id: raced[0].id, name: raced[0].full_name, phone };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (token) {
      const { table, company } = await readPublicTable(token);
      const menu = await dbRequest<Product[]>(
        `/rest/v1/jvg_products?tenant_id=${filterEq(table.tenant_id)}&company_id=${filterEq(table.company_id)}&active=eq.true&sale_price=gt.0&select=id,name,description,category,unit,sale_price&order=category.asc,name.asc&limit=500`,
      );
      return apiJson({ company: company.trade_name || company.legal_name, table: table.label, tableOpen: table.service_status === "open", menu: menu.map((product) => ({ ...product, sale_price: Number(product.sale_price) })) });
    }

    const scope = await requireRestaurant();
    const phoneSearch = (url.searchParams.get("phone") || "").replace(/\D/g, "");
    if (phoneSearch) {
      const customers = await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_restaurant_customers?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&phone=${filterEq(phoneSearch)}&select=id,full_name,phone,cpf,loyalty_points&limit=1`);
      const customer = customers[0];
      if (!customer) return apiJson({ customer: null, history: [] });
      const history = await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&customer_id=${filterEq(String(customer.id))}&select=id,order_number,table_id,source,status,items,total,notes,created_at&order=created_at.desc&limit=100`);
      return apiJson({ customer, history: history.map((order) => ({ ...order, total: Number(order.total) })) });
    }
    const [settings, tables, products, orders] = await Promise.all([
      dbRequest<Array<{ qr_orders_enabled: boolean; loyalty_enabled: boolean; loyalty_points_per_real: number | string }>>(`/rest/v1/jvg_restaurant_settings?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&select=qr_orders_enabled,loyalty_enabled,loyalty_points_per_real&limit=1`),
      dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_restaurant_tables?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&select=id,table_number,label,qr_token,active,service_status,opened_at,closed_at&order=table_number.asc&limit=500`),
      dbRequest<Product[]>(`/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&active=eq.true&select=id,name,description,sku,category,unit,sale_price&order=category.asc,name.asc&limit=500`),
      dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 3 * 86400000).toISOString())}&select=id,order_number,table_id,customer_id,source,status,items,customer_name_snapshot,phone_snapshot,total,notes,created_at,updated_at&order=created_at.desc&limit=200`),
    ]);
    return apiJson({ settings: settings[0] || { qr_orders_enabled: false, loyalty_enabled: false, loyalty_points_per_real: 1 }, tables, products: products.map((product) => ({ ...product, sale_price: Number(product.sale_price) })), orders: orders.map((order) => ({ ...order, total: Number(order.total) })) });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const input = await request.json() as Record<string, unknown>;
    const publicToken = str(input.token, 40);
    let scope: RestaurantScope;
    let tableId: string | null = null;
    let source: "table" | "counter" | "qr" = "counter";
    if (publicToken) {
      const { table } = await readPublicTable(publicToken);
      if (table.service_status !== "open") throw new JvgBackendError("Esta mesa ainda não foi aberta pela equipe. Peça ajuda para continuar.", 409);
      scope = { tenant_id: table.tenant_id, company_id: table.company_id };
      tableId = table.id;
      source = "qr";
    } else {
      scope = await requireRestaurant();
      requireWrite(scope);
      const kind = str(input.kind, 20);
      if (kind === "settings") {
        const pointsRate = Number(input.loyaltyPointsPerReal ?? 1);
        if (!Number.isFinite(pointsRate) || pointsRate <= 0 || pointsRate > 100) throw new JvgBackendError("A pontuação precisa ser maior que zero e no máximo 100 pontos por real.", 400);
        await dbRequest("/rest/v1/jvg_restaurant_settings?on_conflict=tenant_id,company_id", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ tenant_id: scope.tenant_id, company_id: scope.company_id, qr_orders_enabled: input.qrOrdersEnabled === true, loyalty_enabled: input.loyaltyEnabled === true, loyalty_points_per_real: pointsRate, updated_at: new Date().toISOString() }),
        });
        return apiJson({ ok: true });
      }
      if (kind === "table") {
        const number = Number(input.tableNumber);
        const label = str(input.label, 60) || `Mesa ${number}`;
        if (!Number.isInteger(number) || number < 1 || number > 9999) throw new JvgBackendError("Informe um número de mesa válido.", 400);
        const table = await dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_restaurant_tables", {
          method: "POST", body: JSON.stringify({ tenant_id: scope.tenant_id, company_id: scope.company_id, table_number: number, label }),
        });
        return apiJson({ ok: true, table: table[0] }, 201);
      }
      if (kind === "tables") {
        const firstNumber = Number(input.firstNumber);
        const count = Number(input.count);
        if (!Number.isInteger(firstNumber) || firstNumber < 1 || !Number.isInteger(count) || count < 1 || count > 50 || firstNumber + count - 1 > 9999) {
          throw new JvgBackendError("Informe a primeira mesa e uma quantidade entre 1 e 50.", 400);
        }
        const rows = Array.from({ length: count }, (_, index) => ({
          tenant_id: scope.tenant_id, company_id: scope.company_id,
          table_number: firstNumber + index, label: `Mesa ${firstNumber + index}`,
        }));
        const tables = await dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_restaurant_tables", { method: "POST", body: JSON.stringify(rows) });
        return apiJson({ ok: true, tables }, 201);
      }
      if (kind !== "order") throw new JvgBackendError("Ação de restaurante inválida.", 400);
      source = input.tableId ? "table" : "counter";
      tableId = input.tableId ? str(input.tableId, 40) : null;
    }

    if (tableId && !UUID.test(tableId)) throw new JvgBackendError("Mesa inválida.", 400);
    if (tableId && !publicToken) {
      const tables = await dbRequest<Array<{ id: string; service_status: string }>>(`/rest/v1/jvg_restaurant_tables?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(tableId)}&active=eq.true&select=id,service_status&limit=1`);
      if (!tables[0]) throw new JvgBackendError("Selecione uma mesa ativa desta empresa.", 400);
      if (tables[0].service_status !== "open") throw new JvgBackendError("Abra a mesa antes de lançar um pedido nela.", 409);
    }
    const items = parseItems(input.items);
    const calculated = await calculateItems(scope, items);
    const customerName = str(input.customerName, 120);
    const phoneInput = str(input.phone, 30);
    const cpfInput = str(input.cpf, 20);
    if (publicToken && !cpfInput.replace(/\D/g, "")) throw new JvgBackendError("Informe o CPF para identificar o pedido.", 400);
    let customer: { id: string; name: string; phone: string } | null = null;
    if (publicToken || phoneInput) customer = await saveCustomer(scope, customerName, phoneInput, cpfInput, Boolean(publicToken));
    if (publicToken && !customer) throw new JvgBackendError("Informe seu nome e telefone com DDD para enviar o pedido.", 400);
    const requestKey = str(input.requestKey, 40);
    if (requestKey && !UUID.test(requestKey)) throw new JvgBackendError("Chave do pedido inválida.", 400);
    const existing = requestKey ? await dbRequest<Array<{ id: string; order_number: number | string; status: string }>>(
      `/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&request_key=${filterEq(requestKey)}&select=id,order_number,status&limit=1`,
    ) : [];
    if (existing[0]) return apiJson({ ok: true, order: existing[0], duplicate: true });
    const order = await dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_restaurant_orders", {
      method: "POST", body: JSON.stringify({
        tenant_id: scope.tenant_id, company_id: scope.company_id, table_id: tableId,
        customer_id: customer?.id || null, customer_name_snapshot: customer?.name || customerName,
        phone_snapshot: customer?.phone || phoneInput.replace(/\D/g, ""), source,
        status: "open", items: calculated.snapshot, total: calculated.total,
        notes: str(input.notes, 1000), request_key: requestKey || null,
      }),
    });
    return apiJson({ ok: true, order: order[0] }, 201);
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const scope = await requireRestaurant();
    requireWrite(scope);
    const input = await request.json() as Record<string, unknown>;
    const kind = str(input.kind, 20);
    if (kind === "table") {
      const id = str(input.id, 40);
      if (!UUID.test(id)) throw new JvgBackendError("Mesa inválida.", 400);
      const updated = await dbRequest<Array<{ id: string }>>(`/rest/v1/jvg_restaurant_tables?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(id)}`, {
        method: "PATCH", body: JSON.stringify({ active: input.active === true, updated_at: new Date().toISOString() }),
      });
      if (!updated[0]) throw new JvgBackendError("Mesa não encontrada nesta empresa.", 404);
      return apiJson({ ok: true });
    }
    if (kind === "table-session") {
      const id = str(input.id, 40);
      const status = str(input.status, 10);
      if (!UUID.test(id) || !["open", "closed"].includes(status)) throw new JvgBackendError("Mesa ou situação inválida.", 400);
      const ok = await dbRequest<boolean>("/rest/v1/rpc/jvg_restaurant_set_table_status", {
        method: "POST", body: JSON.stringify({ p_tenant_id: scope.tenant_id, p_company_id: scope.company_id, p_table_id: id, p_status: status }),
      });
      if (ok !== true) throw new JvgBackendError("Mesa não encontrada nesta empresa.", 404);
      return apiJson({ ok: true });
    }
    if (kind === "order") {
      const id = str(input.id, 40);
      const status = str(input.status, 30);
      if (!UUID.test(id)) throw new JvgBackendError("Pedido inválido.", 400);
      const ok = await dbRequest<boolean>("/rest/v1/rpc/jvg_restaurant_set_order_status", {
        method: "POST", body: JSON.stringify({ p_tenant_id: scope.tenant_id, p_company_id: scope.company_id, p_order_id: id, p_status: status }),
      });
      if (ok !== true) throw new JvgBackendError("Pedido não encontrado nesta empresa.", 404);
      return apiJson({ ok: true });
    }
    throw new JvgBackendError("Ação de restaurante inválida.", 400);
  } catch (error) { return safeError(error); }
}
