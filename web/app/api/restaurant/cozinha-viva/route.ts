import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError, str, type SiteAccount } from "../../../../lib/jvg-backend";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const classifications = new Set(["loss", "overproduction", "count_error", "adjustment", "other"]);
type Context = { account: SiteAccount; userId: string };
type Row = Record<string, unknown>;

async function context(): Promise<Context> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user, { requiredModule: "restaurante" });
  if (!account) throw new JvgBackendError("Não encontramos uma empresa ativa para este usuário.", 409);
  return { account, userId: user.userId };
}

function requireWrite(account: SiteAccount) {
  if (account.role === "viewer" || account.role === "accounting")
    throw new JvgBackendError("Seu acesso permite consulta, mas não alterar os dados do restaurante.", 403);
}

function missingKitchenMigration(error: unknown) {
  return error instanceof JvgBackendError && ["42P01", "42703", "PGRST202", "PGRST204", "42883"].includes(error.databaseCode || "");
}

function uuid(value: unknown, label: string) {
  const result = str(value, 40);
  if (!UUID.test(result)) throw new JvgBackendError(`${label} inválido.`, 400);
  return result;
}

function numberValue(value: unknown, label: string, minimum: number, maximum = 999999999) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new JvgBackendError(`${label} inválido.`, 400);
  return number;
}

function tenantPath(account: SiteAccount, table: string, query: string) {
  return `/rest/v1/${table}?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&${query}`;
}

export async function GET() {
  try {
    const { account } = await context();
    const since = encodeURIComponent(new Date(Date.now() - 90 * 86400000).toISOString());
    const [products, balances, versions, recipeItems, costHistory, inboundDocs, openSessions, recentSessions, prepRuns, orders] = await Promise.all([
      dbRequest<Array<Row>>(tenantPath(account, "jvg_products", "active=eq.true&select=id,name,sku,category,unit,cost_price,sale_price,minimum_stock,tracks_stock&order=name.asc&limit=5000")),
      dbRequest<Array<{ product_id: string; balance: number | string }>>("/rest/v1/rpc/jvg_restaurant_inventory_balances", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id }),
      }),
      dbRequest<Array<Row>>(tenantPath(account, "jvg_restaurant_recipe_versions", "select=id,menu_product_id,version_no,yield_quantity,yield_unit,minimum_margin_percent,notes,is_current,created_by,created_at&order=created_at.desc&limit=5000")),
      dbRequest<Array<Row>>(tenantPath(account, "jvg_restaurant_recipe_items", "select=id,recipe_version_id,position,ingredient_product_id,quantity_per_yield,unit,conversion_to_stock_unit&order=position.asc&limit=10000")),
      dbRequest<Array<Row>>(tenantPath(account, "jvg_restaurant_ingredient_cost_history", "select=id,ingredient_product_id,inbound_nfe_id,inbound_nfe_item_number,supplier_name_snapshot,invoice_number_snapshot,source_quantity,source_unit,source_unit_cost,conversion_to_stock_unit,stock_unit,stock_unit_cost,lot_snapshot,created_at&order=created_at.desc&limit=1000")),
      dbRequest<Array<Row>>(tenantPath(account, "jvg_inbound_nfe_documents", "status=eq.received&select=id,invoice_number,series,issued_at,issuer_name,supplier_party_id,items&order=received_at.desc&limit=100")),
      dbRequest<Array<Row>>(tenantPath(account, "jvg_restaurant_inventory_count_sessions", "status=eq.open&select=id,label,status,opened_at,opened_by&order=opened_at.desc&limit=1")),
      dbRequest<Array<Row>>(tenantPath(account, "jvg_restaurant_inventory_count_sessions", "select=id,label,status,opened_at,closed_at,opened_by,closed_by&order=opened_at.desc&limit=20")),
      dbRequest<Array<Row>>(tenantPath(account, "jvg_restaurant_prep_runs", "select=id,menu_product_id,recipe_version_id,shift_name,starts_at,ends_at,prepared_quantity,remaining_quantity,notes,created_at&order=starts_at.desc&limit=100")),
      dbRequest<Array<Row>>(tenantPath(account, "jvg_restaurant_orders", `status=eq.delivered&created_at=gte.${since}&select=id,order_number,source,status,items,total,created_at&order=created_at.desc&limit=1000`)),
    ]);

    const productById = new Map(products.map((product) => [String(product.id), product]));
    const balanceById = new Map(balances.map((row) => [row.product_id, Number(row.balance)]));
    const versionById = new Map(versions.map((version) => [String(version.id), version]));
    const recipes = recipeItems.flatMap((item) => {
      const version = versionById.get(String(item.recipe_version_id));
      const menu = version && productById.get(String(version.menu_product_id));
      const ingredient = productById.get(String(item.ingredient_product_id));
      if (!version || !menu || !ingredient) return [];
      return [{
        ...item,
        recipe_version_id: String(item.recipe_version_id),
        menu_product_name: menu.name,
        ingredient_name: ingredient.name,
        ingredient_stock_unit: ingredient.unit,
        ingredient_cost_price: Number(ingredient.cost_price),
      }];
    });
    const countSession = openSessions[0] || recentSessions[0] || null;
    const countItems = countSession ? await dbRequest<Array<Row>>(tenantPath(account, "jvg_restaurant_inventory_count_items", `session_id=${filterEq(String(countSession.id))}&select=id,ingredient_product_id,expected_at_open,expected_at_count,counted_quantity,counted_at,expected_at_close,variance,classification,note,updated_at&order=ingredient_product_id.asc&limit=5000`)) : [];

    const lowStock = products.filter((product) => product.tracks_stock === true && ((balanceById.get(String(product.id)) || 0) <= 0 || (Number(product.minimum_stock || 0) > 0 && (balanceById.get(String(product.id)) || 0) < Number(product.minimum_stock))));
    const currentRecipes = new Set(versions.filter((version) => version.is_current === true).map((version) => String(version.menu_product_id)));
    const menuProducts = products.filter((product) => Number(product.sale_price || 0) > 0);
    const missingRecipes = menuProducts.filter((product) => !currentRecipes.has(String(product.id)));
    const prepSales = prepRuns.map((run) => {
      const sold = orders.reduce((sum, order) => {
        const createdAt = Date.parse(String(order.created_at));
        if (createdAt < Date.parse(String(run.starts_at)) || createdAt > Date.parse(String(run.ends_at))) return sum;
        const items = Array.isArray(order.items) ? order.items as Row[] : [];
        return sum + items.reduce((lineSum, line) => lineSum + (String(line.product_id) === String(run.menu_product_id) ? Number(line.quantity || 0) : 0), 0);
      }, 0);
      return { ...run, menu_product_id: String(run.menu_product_id), recipe_version_id: String(run.recipe_version_id), prepared_quantity: Number(run.prepared_quantity), remaining_quantity: Number(run.remaining_quantity), sold_quantity: sold, unaccounted_quantity: Number(run.prepared_quantity) - sold - Number(run.remaining_quantity) };
    });
    const inboundCandidates = inboundDocs.map((doc) => ({
      id: doc.id, invoiceNumber: doc.invoice_number, series: doc.series, issuedAt: doc.issued_at,
      supplierName: doc.issuer_name,
      items: (Array.isArray(doc.items) ? doc.items as Row[] : []).map((item) => ({
        lineNumber: Number(item.lineNumber), description: item.description, unit: item.unit,
        quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), productId: item.productId || null,
        trackStock: item.trackStock === true, conversionToStockUnit: item.conversionToStockUnit ?? null,
        batches: Array.isArray(item.batches) ? item.batches : [],
      })),
    }));
    return apiJson({
      migrationRequired: false,
      products: products.map((product) => ({ ...product, cost_price: Number(product.cost_price), sale_price: Number(product.sale_price), minimum_stock: Number(product.minimum_stock), balance: balanceById.get(String(product.id)) || 0 })),
      recipes: versions.map((version) => ({ ...version, version_no: Number(version.version_no), yield_quantity: Number(version.yield_quantity), minimum_margin_percent: version.minimum_margin_percent == null ? null : Number(version.minimum_margin_percent), items: recipes.filter((item) => item.recipe_version_id === version.id) })),
      costHistory: costHistory.map((entry) => ({ ...entry,
        source_quantity: Number(entry.source_quantity), source_unit_cost: Number(entry.source_unit_cost),
        conversion_to_stock_unit: Number(entry.conversion_to_stock_unit), stock_unit_cost: Number(entry.stock_unit_cost),
        lot_snapshot: Array.isArray(entry.lot_snapshot) ? entry.lot_snapshot : [],
      })),
      inboundDocs: inboundCandidates,
      countSession,
      countItems: countItems.map((item) => ({ ...item,
        expected_at_open: Number(item.expected_at_open),
        expected_at_count: item.expected_at_count == null ? null : Number(item.expected_at_count),
        counted_quantity: item.counted_quantity == null ? null : Number(item.counted_quantity),
        expected_at_close: item.expected_at_close == null ? null : Number(item.expected_at_close),
        variance: item.variance == null ? null : Number(item.variance),
        product: productById.get(String(item.ingredient_product_id)) || null,
      })),
      recentSessions: recentSessions.map((session) => ({ ...session, isOpen: session.status === "open" })),
      prepRuns: prepSales.map((run) => ({ ...run, prepared_quantity: Number(run.prepared_quantity), remaining_quantity: Number(run.remaining_quantity), sold_quantity: Number(run.sold_quantity), unaccounted_quantity: Number(run.unaccounted_quantity), menuProduct: productById.get(String(run.menu_product_id)) || null, recipeVersion: versionById.get(String(run.recipe_version_id)) || null })),
      deliveredOrders: orders,
      salesWindowComplete: orders.length < 1000,
      alerts: { lowStock: lowStock.map((product) => ({ productId: product.id, name: product.name, unit: product.unit, balance: balanceById.get(String(product.id)) || 0, minimum: Number(product.minimum_stock) })), missingRecipes: missingRecipes.map((product) => ({ productId: product.id, name: product.name, salePrice: Number(product.sale_price) })) },
    });
  } catch (error) {
    if (missingKitchenMigration(error)) return apiJson({ migrationRequired: true, error: "A migration Cozinha Viva ainda não foi aplicada neste banco. A operação normal do restaurante continua disponível." }, 503);
    return safeError(error);
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account, userId } = await context();
    requireWrite(account);
    const input = await request.json() as Row;
    const action = str(input.action, 32);

    if (action === "save-recipe") {
      const menuProductId = uuid(input.menuProductId, "Prato");
      const yieldQuantity = numberValue(input.yieldQuantity, "Rendimento", 0.000001, 1000000);
      const yieldUnit = str(input.yieldUnit, 12);
      const minimumMarginPercent = input.minimumMarginPercent === null || input.minimumMarginPercent === undefined || input.minimumMarginPercent === "" ? null : numberValue(input.minimumMarginPercent, "Margem mínima", 0, 100);
      const items = Array.isArray(input.items) ? input.items as Row[] : [];
      if (!yieldUnit || items.length < 1 || items.length > 100) throw new JvgBackendError("Informe o rendimento e ao menos um ingrediente.", 400);
      const ids = [menuProductId, ...items.map((item) => uuid(item.ingredientProductId, "Ingrediente"))];
      if (new Set(ids.slice(1)).size !== items.length) throw new JvgBackendError("Cada ingrediente deve aparecer uma vez na ficha. Some quantidades repetidas.", 400);
      const products = await dbRequest<Array<{ id: string; unit: string; active: boolean; tracks_stock: boolean }>>(
        tenantPath(account, "jvg_products", `id=in.(${[...new Set(ids)].join(",")})&select=id,unit,active,tracks_stock&limit=5000`),
      );
      const byId = new Map(products.map((product) => [product.id, product]));
      if (byId.size !== new Set(ids).size) throw new JvgBackendError("Prato ou ingrediente não pertence a esta empresa.", 400);
      if (byId.get(menuProductId)?.active !== true) throw new JvgBackendError("O prato está inativo.", 400);
      const normalizedItems = items.map((item) => {
        const ingredientId = String(item.ingredientProductId);
        const ingredient = byId.get(ingredientId)!;
        if (!ingredient.active || !ingredient.tracks_stock) throw new JvgBackendError("Todos os ingredientes precisam estar ativos e controlar estoque.", 400);
        const unit = str(item.unit, 12);
        const quantityPerYield = numberValue(item.quantityPerYield, "Quantidade por rendimento", 0.000001, 100000000);
        const conversionToStockUnit = numberValue(item.conversionToStockUnit, "Conversão para unidade de estoque", 0.00000001, 1000000);
        if (!unit) throw new JvgBackendError("Informe a unidade usada na ficha técnica.", 400);
        if (unit.trim().toUpperCase() === String(ingredient.unit).trim().toUpperCase() && conversionToStockUnit !== 1)
          throw new JvgBackendError(`Ingrediente ${ingredientId}: unidades iguais precisam de conversão 1.`, 400);
        return { ingredientProductId: ingredientId, quantityPerYield, unit, conversionToStockUnit };
      });
      const result = await dbRequest<Row>("/rest/v1/rpc/jvg_restaurant_save_recipe", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id, p_menu_product_id: menuProductId, p_yield_quantity: yieldQuantity, p_yield_unit: yieldUnit, p_minimum_margin_percent: minimumMarginPercent, p_notes: str(input.notes, 500), p_items: normalizedItems, p_actor_user_id: userId }),
      });
      return apiJson({ ok: true, recipe: result });
    }

    if (action === "apply-cost") {
      const result = await dbRequest<Row>("/rest/v1/rpc/jvg_restaurant_apply_inbound_cost", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id,
          p_document_id: uuid(input.documentId, "NF-e"), p_line_number: numberValue(input.lineNumber, "Item", 1, 500),
          p_product_id: uuid(input.productId, "Ingrediente"), p_conversion_to_stock_unit: numberValue(input.conversionToStockUnit, "Conversão", 0.00000001, 1000000), p_actor_user_id: userId }),
      });
      return apiJson({ ok: true, result });
    }

    if (action === "open-count") {
      const result = await dbRequest<Row>("/rest/v1/rpc/jvg_restaurant_open_inventory_count", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id, p_label: str(input.label, 80), p_actor_user_id: userId }),
      });
      return apiJson({ ok: true, result }, 201);
    }

    if (action === "record-loss") {
      const result = await dbRequest<Row>("/rest/v1/rpc/jvg_restaurant_record_loss", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id,
          p_product_id: uuid(input.productId, "Ingrediente"), p_quantity: numberValue(input.quantity, "Quantidade", 0.0001),
          p_reason: str(input.reason, 120), p_actor_user_id: userId }),
      });
      return apiJson({ ok: true, result });
    }

    if (action === "record-prep") {
      const result = await dbRequest<Row>("/rest/v1/rpc/jvg_restaurant_record_prep_run", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id,
          p_menu_product_id: uuid(input.menuProductId, "Prato"), p_shift_name: str(input.shiftName, 60),
          p_starts_at: input.startsAt, p_ends_at: input.endsAt,
          p_prepared_quantity: numberValue(input.preparedQuantity, "Quantidade preparada", 0.0001),
          p_remaining_quantity: numberValue(input.remainingQuantity, "Sobra", 0), p_notes: str(input.notes, 300), p_actor_user_id: userId }),
      });
      return apiJson({ ok: true, result }, 201);
    }

    throw new JvgBackendError("Ação da Cozinha Viva inválida.", 400);
  } catch (error) {
    if (missingKitchenMigration(error)) return apiJson({ migrationRequired: true, error: "A migration Cozinha Viva ainda não foi aplicada neste banco." }, 503);
    return safeError(error);
  }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account, userId } = await context();
    requireWrite(account);
    const input = await request.json() as Row;
    const action = str(input.action, 32);
    if (action === "save-count-item") {
      if (input.classification && !classifications.has(str(input.classification, 20))) throw new JvgBackendError("Classificação inválida.", 400);
      const result = await dbRequest<Row>("/rest/v1/rpc/jvg_restaurant_update_count_item", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id,
          p_session_id: uuid(input.sessionId, "Contagem"), p_item_id: uuid(input.itemId, "Ingrediente"),
          p_counted_quantity: numberValue(input.countedQuantity, "Quantidade contada", 0),
          p_classification: str(input.classification, 20) || null, p_note: str(input.note, 500) }),
      });
      return apiJson({ ok: true, result });
    }
    if (action === "close-count") {
      const result = await dbRequest<Row>("/rest/v1/rpc/jvg_restaurant_close_inventory_count", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id,
          p_session_id: uuid(input.sessionId, "Contagem"), p_actor_user_id: userId }),
      });
      if (typeof result.error === "string") {
        const item = typeof result.item === "string" ? ` Ingrediente: ${result.item}.` : "";
        return apiJson({ error: `${result.error}${item}`, item: result.item || null }, 409);
      }
      return apiJson({ ok: true, result });
    }
    throw new JvgBackendError("Ação da Cozinha Viva inválida.", 400);
  } catch (error) {
    if (missingKitchenMigration(error)) return apiJson({ migrationRequired: true, error: "A migration Cozinha Viva ainda não foi aplicada neste banco." }, 503);
    return safeError(error);
  }
}
