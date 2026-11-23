import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, moduleAccessGranted, safeError, str } from "../../../lib/jvg-backend";
import { currentMenuPrice, normalizeMenuComponents, normalizeMenuOptions, normalizeMenuPromotion, resolveMenuChoices } from "../../../lib/restaurant-menu";
import { jvgRuntime } from "../../../lib/jvg-runtime";
import { requireVerifiedRestaurantCustomer } from "../../../lib/restaurant-customer-auth";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Product = { id: string; name: string; description: string | null; sku: string; category: string | null; unit: string; cost_price: number | string; sale_price: number | string; tracks_stock: boolean; active: boolean };
type RestaurantMenuItem = { product_id: string; image_path: string | null; options: unknown; is_combo: boolean; combo_components: unknown; promotion: unknown; public_active: boolean; sort_order: number };
type Category = { id: string; name: string; active: boolean; sort_order: number };
type OrderRequestItem = { productId: string; quantity: number; optionChoiceIds: string[] };
type RestaurantScope = { tenant_id: string; company_id: string; role?: string };
type PublicContext = {
  tenant_id: string; company_id: string;
  company: { trade_name: string | null; legal_name: string };
  brand: Record<string, unknown>;
  table?: { id: string; label: string; service_status: string };
};

type StockNeed = { productId: string; name: string; quantity: number };

function validCpf(value: string) {
  const cpf = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

const logoBucket = "jvg-company-logos";

function menuSchemaUnavailable(error: unknown) {
  return error instanceof JvgBackendError && ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.databaseCode || "");
}

function publicAssetUrl(path: string | null | undefined) {
  if (!path) return null;
  const runtime = jvgRuntime();
  if (!runtime.supabaseUrl) return null;
  return `${runtime.supabaseUrl}/storage/v1/object/public/${logoBucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function safeFiscalFileUrl(value: string | null | undefined) {
  if (!value?.startsWith("https://")) return false;
  try {
    const candidate = new URL(value);
    const configuredSupabaseHost = jvgRuntime().supabaseUrl ? new URL(jvgRuntime().supabaseUrl!).hostname : "";
    const isFocusHost = candidate.hostname === "focusnfe.com.br" || candidate.hostname.endsWith(".focusnfe.com.br");
    const isConfiguredStorageObject = Boolean(configuredSupabaseHost && candidate.hostname === configuredSupabaseHost && candidate.pathname.startsWith("/storage/v1/object/"));
    return candidate.protocol === "https:" && (!candidate.port || candidate.port === "443") && !candidate.username && !candidate.password && (isFocusHost || isConfiguredStorageObject);
  } catch { return false; }
}

async function readMenuItems(scope: Pick<RestaurantScope, "tenant_id" | "company_id">, productIds?: string[]) {
  if (productIds && !productIds.length) return [];
  const ids = productIds?.length ? `&product_id=in.(${productIds.join(",")})` : "";
  try {
    return await dbRequest<RestaurantMenuItem[]>(`/rest/v1/jvg_restaurant_menu_items?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}${ids}&select=product_id,image_path,options,is_combo,combo_components,promotion,public_active,sort_order&limit=1000`);
  } catch (error) {
    if (menuSchemaUnavailable(error)) return [];
    throw error;
  }
}

async function requireRestaurant(): Promise<RestaurantScope> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const scope = await getSiteAccount(user, { requiredModule: "restaurante" });
  if (!scope) throw new JvgBackendError("Não encontramos uma empresa ativa para este usuário.", 409);
  // A liberação por empresa no painel administrativo é a fonte de acesso.
  // business_type classifica o cadastro, mas não pode bloquear um módulo liberado.
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
    dbRequest<Array<{ trade_name: string | null; legal_name: string }>>(`/rest/v1/jvg_companies?tenant_id=${filterEq(table.tenant_id)}&id=${filterEq(table.company_id)}&select=trade_name,legal_name&limit=1`),
  ]);
  let brand: Record<string, unknown> = {};
  try {
    const rows = await dbRequest<Array<{ public_name: string | null; public_description: string | null; logo_path: string | null; cover_path: string | null; brand_color: string | null; opening_hours: unknown }>>(
      `/rest/v1/jvg_restaurant_settings?tenant_id=${filterEq(table.tenant_id)}&company_id=${filterEq(table.company_id)}&select=public_name,public_description,logo_path,cover_path,brand_color,opening_hours&limit=1`,
    );
    brand = rows[0] || {};
  } catch (error) {
    if (!menuSchemaUnavailable(error)) throw error;
  }
  try {
    const publicRows = await dbRequest<Array<Record<string, unknown>>>(
      "/rest/v1/jvg_restaurant_settings?tenant_id=" + filterEq(table.tenant_id) +
      "&company_id=" + filterEq(table.company_id) +
      "&select=qr_orders_enabled,website_orders_enabled,website_pickup_enabled,public_contact_phone,public_whatsapp,public_email,public_address,public_map_url,public_instagram_url,public_website_url&limit=1",
    );
    brand = { ...brand, ...(publicRows[0] || {}) };
  } catch (error) {
    if (!menuSchemaUnavailable(error)) throw error;
  }
  if (!settings[0]?.qr_orders_enabled) {
    throw new JvgBackendError("Os pedidos por QR estão temporariamente desativados.", 404);
  }
  if (!await moduleAccessGranted({ tenant_id: table.tenant_id, company_id: table.company_id }, "restaurante")) {
    throw new JvgBackendError("Os pedidos por QR estão suspensos porque o módulo Restaurante não está liberado para esta empresa.", 402);
  }
  if (!await moduleAccessGranted({ tenant_id: table.tenant_id, company_id: table.company_id }, "restaurante_online")) {
    throw new JvgBackendError("O cardápio público e os pedidos por QR não estão liberados para esta empresa.", 402);
  }
  await ensurePublicTenantAccess(table.tenant_id);
  return { table, company: companies[0], brand, tenant_id: table.tenant_id, company_id: table.company_id };
}

async function readPublicRestaurantBySlug(slugValue: string): Promise<PublicContext> {
  const slug = slugValue.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 60) {
    throw new JvgBackendError("Endereço do restaurante inválido.", 404);
  }
  const rows = await dbRequest<Array<Record<string, unknown>>>(
    "/rest/v1/jvg_restaurant_settings?public_slug=" + filterEq(slug) +
    "&website_enabled=eq.true&select=tenant_id,company_id,website_orders_enabled,website_pickup_enabled,public_name,public_description,logo_path,cover_path,brand_color,opening_hours,public_contact_phone,public_whatsapp,public_email,public_address,public_map_url,public_instagram_url,public_website_url&limit=1",
  );
  const brand = rows[0];
  if (!brand || typeof brand.tenant_id !== "string" || typeof brand.company_id !== "string") {
    throw new JvgBackendError("Este site de restaurante não está publicado.", 404);
  }
  const tenantId = String(brand.tenant_id);
  const companyId = String(brand.company_id);
  const [companies, restaurantEnabled, onlineEnabled] = await Promise.all([
    dbRequest<Array<{ trade_name: string | null; legal_name: string }>>(
      "/rest/v1/jvg_companies?tenant_id=" + filterEq(tenantId) + "&id=" + filterEq(companyId) + "&status=eq.active&select=trade_name,legal_name&limit=1",
    ),
    moduleAccessGranted({ tenant_id: tenantId, company_id: companyId }, "restaurante"),
    moduleAccessGranted({ tenant_id: tenantId, company_id: companyId }, "restaurante_online"),
  ]);
  if (!companies[0]) throw new JvgBackendError("Este restaurante não está disponível.", 404);
  if (!restaurantEnabled || !onlineEnabled) throw new JvgBackendError("O site público está temporariamente indisponível para esta empresa.", 402);
  await ensurePublicTenantAccess(tenantId);
  return { tenant_id: tenantId, company_id: companyId, company: companies[0], brand };
}

async function readPublicMenu(scope: Pick<RestaurantScope, "tenant_id" | "company_id">) {
  const products = await dbRequest<Product[]>(
    `/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&active=eq.true&sale_price=gt.0&select=id,name,description,sku,category,unit,cost_price,sale_price,tracks_stock,active&order=category.asc,name.asc&limit=500`,
  );
  const items = await readMenuItems(scope, products.map((product) => product.id));
  let categories: Category[] = [];
  try {
    categories = await dbRequest<Category[]>(`/rest/v1/jvg_restaurant_categories?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&active=eq.true&select=id,name,active,sort_order&order=sort_order.asc,name.asc&limit=500`);
  } catch (error) {
    if (!menuSchemaUnavailable(error)) throw error;
  }
  const itemByProduct = new Map(items.map((item) => [item.product_id, item]));
  const visible = products.filter((product) => itemByProduct.get(product.id)?.public_active !== false);
  const componentIds = [...new Set(visible.flatMap((product) => {
    const components = normalizeMenuComponents(itemByProduct.get(product.id)?.combo_components ?? []);
    return components?.map((component) => component.productId) || [];
  }))];
  const componentRows = componentIds.length ? await dbRequest<Array<{ id: string; name: string; unit: string }>>(
    `/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=in.(${componentIds.join(",")})&select=id,name,unit&limit=100`,
  ) : [];
  const componentById = new Map(componentRows.map((product) => [product.id, product]));
  const recipes = await currentRecipeSnapshots(scope, visible.map((product) => product.id));
  const menu = visible.map((product) => {
    const item = itemByProduct.get(product.id);
    const options = normalizeMenuOptions(item?.options ?? []);
    const components = normalizeMenuComponents(item?.combo_components ?? []);
    const promotion = normalizeMenuPromotion(item?.promotion ?? null, Number(product.sale_price));
    if (!options || !components || promotion === undefined) throw new JvgBackendError("Um item do cardápio precisa ser revisado antes de aceitar novos pedidos.", 409);
    if (item?.is_combo && !components.length) throw new JvgBackendError("Um combo está sem seus produtos. Peça à equipe para revisar o cardápio.", 409);
    return {
      id: product.id, name: product.name, description: product.description || "", category: product.category || "",
      unit: product.unit, sale_price: currentMenuPrice(Number(product.sale_price), promotion), base_price: Number(product.sale_price),
      image_url: publicAssetUrl(item?.image_path), options, is_combo: item?.is_combo === true,
      combo_components: components.map((component) => {
        const detail = componentById.get(component.productId);
        if (!detail) throw new JvgBackendError("Um produto de um combo não está mais disponível. Peça à equipe para revisar o cardápio.", 409);
        return { product_id: detail.id, name: detail.name, quantity: component.quantity, unit: detail.unit };
      }), promotion, tracks_stock: product.tracks_stock, recipeSnapshot: recipes.get(product.id) || null,
    };
  });
  const needsByProduct = new Map(menu.map((product) => [product.id, stockNeedsForLine({
    product_id: product.id, description: product.name, quantity: 1, tracks_stock: product.tracks_stock, recipeSnapshot: product.recipeSnapshot,
  })]));
  const stockIds = [...new Set([...needsByProduct.values()].flat().map((need) => need.productId))];
  let balances: Map<string, number> | null = new Map();
  if (stockIds.length) {
    try { balances = await readInventoryBalances(scope, stockIds); }
    catch (error) {
      if (kitchenMigrationUnavailable(error)) balances = null;
      else throw error;
    }
  }
  const menuWithAvailability = menu.map((product) => {
    const needs = needsByProduct.get(product.id) || [];
    if (!needs.length) return { ...product, recipeSnapshot: undefined, available: true, availableQuantity: null, availabilityMessage: null };
    if (!balances) return { ...product, recipeSnapshot: undefined, available: false, availableQuantity: 0, availabilityMessage: "A conferência de estoque ainda não está disponível. Peça ajuda à equipe do restaurante." };
    const availableQuantity = Math.max(0, Math.floor(Math.min(...needs.map((need) => (balances!.get(need.productId) || 0) / need.quantity)) * 1000) / 1000);
    return { ...product, recipeSnapshot: undefined, available: availableQuantity > 0, availableQuantity,
      availabilityMessage: availableQuantity > 0 ? null : "Sem saldo disponível no estoque." };
  });
  const activeNames = new Set(categories.map((category) => category.name.toLocaleLowerCase("pt-BR")));
  for (const name of [...new Set(menu.map((product) => product.category).filter(Boolean))]) {
    if (!activeNames.has(name.toLocaleLowerCase("pt-BR"))) categories.push({ id: `legacy:${name}`, name, active: true, sort_order: 10000 });
  }
  return { categories: categories.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "pt-BR")), menu: menuWithAvailability };
}

async function readPublicHighlights(scope: Pick<RestaurantScope, "tenant_id" | "company_id">, menu: Array<Record<string, unknown>>) {
  let mode: "popular" | "promotions" | "manual" = "popular";
  let title = "Mais pedidos";
  let selectedIds: string[] = [];
  try {
    const rows = await dbRequest<Array<{ public_highlight_mode: string; public_highlight_title: string; public_highlight_product_ids: string[] }>>(
      `/rest/v1/jvg_restaurant_settings?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&select=public_highlight_mode,public_highlight_title,public_highlight_product_ids&limit=1`,
    );
    const settings = rows[0];
    if (settings?.public_highlight_mode === "promotions" || settings?.public_highlight_mode === "manual") mode = settings.public_highlight_mode;
    if (typeof settings?.public_highlight_title === "string" && settings.public_highlight_title.trim()) title = settings.public_highlight_title.trim().slice(0, 60);
    if (Array.isArray(settings?.public_highlight_product_ids)) selectedIds = settings.public_highlight_product_ids.filter((id) => typeof id === "string" && UUID.test(id));
  } catch (error) {
    if (!menuSchemaUnavailable(error)) throw error;
  }

  const menuRows = menu as Array<{ id: string; promotion?: unknown; available?: boolean }>;
  const visibleById = new Map(menuRows.map((product) => [String(product.id), product]));
  if (mode === "manual") return { mode, title, products: selectedIds.flatMap((id) => {
    const product = visibleById.get(id);
    return product ? [{ id, orderCount: null }] : [];
  }) };
  if (mode === "promotions") return {
    mode, title,
    products: menuRows.filter((product) => product.promotion && product.available !== false).slice(0, 8).map((product) => ({ id: String(product.id), orderCount: null })),
  };

  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const popular = await dbRequest<Array<{ product_id: string; quantity: number | string }>>("/rest/v1/rpc/jvg_restaurant_public_menu_popularity", {
      method: "POST", body: JSON.stringify({ p_tenant_id: scope.tenant_id, p_company_id: scope.company_id, p_since: since }),
    });
    return {
      mode, title,
      products: popular.flatMap((row) => visibleById.has(row.product_id) ? [{ id: row.product_id, orderCount: Number(row.quantity) }] : []),
    };
  } catch {
    // O cardápio continua disponível mesmo se a consulta operacional de popularidade falhar.
    return { mode, title, products: [] as Array<{ id: string; orderCount: number | null }> };
  }
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
  const merged = new Map<string, OrderRequestItem>();
  for (const row of value) {
    if (!row || typeof row !== "object") throw new JvgBackendError("Um item do pedido está inválido.", 400);
    const item = row as Record<string, unknown>;
    const id = str(item.productId, 40);
    const quantity = Number(item.quantity);
    const optionChoiceIds = Array.isArray(item.optionChoiceIds) ? [...new Set(item.optionChoiceIds.map((choice) => str(choice, 40)))] : [];
    if (!UUID.test(id) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 999 || Math.round(quantity * 1000) !== quantity * 1000) {
      throw new JvgBackendError("Confira os produtos e as quantidades do pedido.", 400);
    }
    if (optionChoiceIds.some((choice) => !UUID.test(choice)) || optionChoiceIds.length > 40) throw new JvgBackendError("Uma opção do pedido está inválida. Atualize o cardápio e tente novamente.", 400);
    const key = `${id}:${optionChoiceIds.sort().join(",")}`;
    const prior = merged.get(key);
    merged.set(key, { productId: id, quantity: (prior?.quantity || 0) + quantity, optionChoiceIds });
  }
  return [...merged.values()];
}

function kitchenMigrationUnavailable(error: unknown) {
  return error instanceof JvgBackendError && ["42P01", "42703", "PGRST202", "PGRST204", "42883"].includes(error.databaseCode || "");
}

async function currentRecipeSnapshots(scope: Pick<RestaurantScope, "tenant_id" | "company_id">, menuIds: string[]) {
  if (!menuIds.length) return new Map<string, Record<string, unknown>>();
  try {
    const versions = await dbRequest<Array<{ id: string; menu_product_id: string; version_no: number; yield_quantity: number | string; yield_unit: string }>>(
      `/rest/v1/jvg_restaurant_recipe_versions?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&menu_product_id=in.(${menuIds.join(",")})&is_current=eq.true&select=id,menu_product_id,version_no,yield_quantity,yield_unit&limit=500`,
    );
    if (!versions.length) return new Map();
    const versionIds = versions.map((version) => version.id);
    const recipeItems = await dbRequest<Array<{ recipe_version_id: string; ingredient_product_id: string; quantity_per_yield: number | string; unit: string; conversion_to_stock_unit: number | string }>>(
      `/rest/v1/jvg_restaurant_recipe_items?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&recipe_version_id=in.(${versionIds.join(",")})&select=recipe_version_id,ingredient_product_id,quantity_per_yield,unit,conversion_to_stock_unit&order=position.asc&limit=5000`,
    );
    const ingredientIds = [...new Set(recipeItems.map((item) => item.ingredient_product_id))];
    const ingredients = ingredientIds.length ? await dbRequest<Array<{ id: string; name: string; unit: string; cost_price: number | string; active: boolean; tracks_stock: boolean }>>(
      `/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=in.(${ingredientIds.join(",")})&select=id,name,unit,cost_price,active,tracks_stock&limit=5000`,
    ) : [];
    const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
    return new Map(versions.map((version) => [version.menu_product_id, {
      versionId: version.id,
      versionNo: version.version_no,
      yieldQuantity: Number(version.yield_quantity),
      yieldUnit: version.yield_unit,
      ingredients: recipeItems.filter((item) => item.recipe_version_id === version.id).map((item) => {
        const ingredient = ingredientById.get(item.ingredient_product_id);
        if (!ingredient) throw new JvgBackendError("Um ingrediente da ficha técnica não pertence mais a esta empresa. Revise a receita antes de criar pedidos.", 409);
        const cost = Number(ingredient.cost_price);
        return { productId: ingredient.id, name: ingredient.name, stockUnit: ingredient.unit, tracksStock: ingredient.tracks_stock,
          quantityPerYield: Number(item.quantity_per_yield), unit: item.unit,
          conversionToStockUnit: Number(item.conversion_to_stock_unit),
          unitCostAtSale: Number.isFinite(cost) && cost > 0 ? cost : null };
      }),
    }]));
  } catch (error) {
    // Existing order entry remains available until the separately versioned migration is applied.
    if (kitchenMigrationUnavailable(error)) return new Map();
    throw error;
  }
}

async function calculateItems(scope: Pick<RestaurantScope, "tenant_id" | "company_id">, items: OrderRequestItem[]) {
  const ids = [...new Set(items.map((item) => item.productId))];
  const products = await dbRequest<Product[]>(
    `/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=in.(${ids.join(",")})&active=eq.true&select=id,name,description,sku,category,unit,cost_price,sale_price,tracks_stock,active&limit=100`,
  );
  const byId = new Map(products.map((product) => [product.id, product]));
  if (byId.size !== ids.length) throw new JvgBackendError("Um produto foi removido ou está inativo. Atualize o cardápio e tente novamente.", 409);
  const menuItems = await readMenuItems(scope, ids);
  const menuByProduct = new Map(menuItems.map((item) => [item.product_id, item]));
  const recipes = await currentRecipeSnapshots(scope, ids);
  const componentIds = [...new Set(items.flatMap((item) => normalizeMenuComponents(menuByProduct.get(item.productId)?.combo_components ?? [])?.map((component) => component.productId) || []))];
  const components = componentIds.length ? await dbRequest<Array<{ id: string; name: string; unit: string }>>(
    `/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=in.(${componentIds.join(",")})&active=eq.true&select=id,name,unit&limit=100`,
  ) : [];
  const componentById = new Map(components.map((component) => [component.id, component]));
  let total = 0;
  const snapshot = items.map((item, index) => {
    const product = byId.get(item.productId)!;
    const menuItem = menuByProduct.get(product.id);
    const optionGroups = normalizeMenuOptions(menuItem?.options ?? []);
    const comboComponents = normalizeMenuComponents(menuItem?.combo_components ?? []);
    const promotion = normalizeMenuPromotion(menuItem?.promotion ?? null, Number(product.sale_price));
    if (!optionGroups || !comboComponents || promotion === undefined) throw new JvgBackendError("Um item do cardÃ¡pio estÃ¡ com configuraÃ§Ã£o invÃ¡lida. PeÃ§a Ã  equipe para revisÃ¡-lo.", 409);
    if (menuItem?.is_combo && !comboComponents.length) throw new JvgBackendError("Um combo estÃ¡ sem produtos associados. PeÃ§a Ã  equipe para revisar o cardÃ¡pio.", 409);
    const resolved = resolveMenuChoices(optionGroups, item.optionChoiceIds);
    if (!resolved.valid) throw new JvgBackendError(resolved.error, 400);
    const basePrice = currentMenuPrice(Number(product.sale_price), promotion);
    const unitPrice = Math.round((basePrice + resolved.extraPrice) * 100) / 100;
    const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;
    total += lineTotal;
    const catalogCost = Number(product.cost_price);
    return {
      orderItemIndex: index + 1, product_id: product.id, sku: product.sku, description: product.name,
      unit: product.unit, quantity: item.quantity, unit_price: unitPrice, total: lineTotal,
      tracks_stock: product.tracks_stock,
      unitCostAtSale: Number.isFinite(catalogCost) && catalogCost > 0 ? catalogCost : null,
      selectedOptionIds: [...item.optionChoiceIds],
      selectedOptions: resolved.selected.map((choice) => ({ name: choice.name, price: choice.price })),
      isCombo: menuItem?.is_combo === true,
      comboSnapshot: comboComponents.map((component) => {
        const detail = componentById.get(component.productId);
        if (!detail) throw new JvgBackendError("Um produto de um combo nÃ£o estÃ¡ mais disponÃ­vel. Revise o cardÃ¡pio.", 409);
        return { productId: detail.id, name: detail.name, quantity: component.quantity, unit: detail.unit };
      }),
      promotionSnapshot: promotion && currentMenuPrice(Number(product.sale_price), promotion) !== Number(product.sale_price) ? promotion : null,
      recipeSnapshot: recipes.get(product.id) || null,
    };
  });
  return { snapshot, total: Math.round(total * 100) / 100 };
}

function stockNeedsForLine(item: Record<string, unknown>): StockNeed[] {
  const quantity = Number(item.quantity);
  const recipe = item.recipeSnapshot && typeof item.recipeSnapshot === "object" ? item.recipeSnapshot as Record<string, unknown> : null;
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients as Array<Record<string, unknown>> : null;
  if (recipe && ingredients) {
    const yieldQuantity = Number(recipe.yieldQuantity);
    if (!Number.isFinite(yieldQuantity) || yieldQuantity <= 0) throw new JvgBackendError("A ficha técnica do produto tem rendimento inválido. Revise-a antes de aceitar pedidos.", 409);
    if (ingredients.some((ingredient) => ingredient.tracksStock !== true)) {
      const ingredient = ingredients.find((row) => row.tracksStock !== true);
      throw new JvgBackendError(`Ative o controle de estoque do ingrediente ${String(ingredient?.name || "da ficha técnica")} antes de aceitar pedidos deste produto.`, 409);
    }
    return ingredients.map((ingredient) => ({
      productId: String(ingredient.productId || ""), name: String(ingredient.name || "ingrediente"),
      quantity: quantity * Number(ingredient.quantityPerYield) * Number(ingredient.conversionToStockUnit || 1) / yieldQuantity,
    })).filter((need) => UUID.test(need.productId) && Number.isFinite(need.quantity) && need.quantity > 0);
  }
  return item.tracks_stock === true && UUID.test(String(item.product_id || ""))
    ? [{ productId: String(item.product_id), name: String(item.description || "produto"), quantity }]
    : [];
}

async function readInventoryBalances(scope: Pick<RestaurantScope, "tenant_id" | "company_id">, productIds: string[]) {
  if (!productIds.length) return new Map<string, number>();
  const rows = await dbRequest<Array<{ product_id: string; quantity_on_hand: number | string }>>(
    "/rest/v1/rpc/jvg_restaurant_inventory_balances",
    { method: "POST", body: JSON.stringify({ p_tenant_id: scope.tenant_id, p_company_id: scope.company_id, p_product_ids: productIds }) },
  );
  return new Map(rows.map((row) => [row.product_id, Number(row.quantity_on_hand) || 0]));
}

async function assertStockAvailable(scope: Pick<RestaurantScope, "tenant_id" | "company_id">, snapshot: Array<Record<string, unknown>>) {
  const needs = new Map<string, StockNeed>();
  for (const line of snapshot) for (const need of stockNeedsForLine(line)) {
    const prior = needs.get(need.productId);
    needs.set(need.productId, { ...need, quantity: (prior?.quantity || 0) + need.quantity });
  }
  if (!needs.size) return;
  let balances: Map<string, number>;
  try { balances = await readInventoryBalances(scope, [...needs.keys()]); }
  catch (error) {
    if (kitchenMigrationUnavailable(error)) throw new JvgBackendError("Não foi possível validar o estoque atual. A atualização de estoque do restaurante precisa ser aplicada antes de aceitar pedidos online.", 503);
    throw error;
  }
  for (const need of needs.values()) {
    const available = balances.get(need.productId) || 0;
    if (available + 0.00001 < need.quantity) {
      throw new JvgBackendError(`Estoque insuficiente para ${need.name}: necessário ${need.quantity.toLocaleString("pt-BR")} e disponível ${available.toLocaleString("pt-BR")}. Atualize o pedido ou fale com a equipe.`, 409);
    }
  }
}

function publicOrderItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const selectedOptions = Array.isArray(item.selectedOptions) ? item.selectedOptions.map((rawOption) => {
      const option = rawOption as Record<string, unknown>;
      return { name: str(option.name, 120), price: Number(option.price) || 0 };
    }) : [];
    const comboSnapshot = Array.isArray(item.comboSnapshot) ? item.comboSnapshot.map((rawComponent) => {
      const component = rawComponent as Record<string, unknown>;
      return { name: str(component.name, 160), quantity: Number(component.quantity) || 0, unit: str(component.unit, 40) };
    }) : [];
    const promotion = item.promotionSnapshot && typeof item.promotionSnapshot === "object" ? item.promotionSnapshot as Record<string, unknown> : null;
    return {
      product_id: str(item.product_id, 40), description: str(item.description, 200),
      quantity: Number(item.quantity) || 0, unit_price: Number(item.unit_price) || 0, total: Number(item.total) || 0,
      selectedOptionIds: Array.isArray(item.selectedOptionIds) ? item.selectedOptionIds.filter((id): id is string => typeof id === "string" && UUID.test(id)) : [],
      selectedOptions,
      comboSnapshot,
      promotionSnapshot: promotion ? { label: str(promotion.label, 120), price: Number(promotion.price) || 0 } : null,
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
}

async function readCustomerHistory(scope: Pick<RestaurantScope, "tenant_id" | "company_id">, customerId: string, limit: number) {
  const base = `/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&customer_id=${filterEq(customerId)}`;
  let orders: Array<Record<string, unknown>>;
  try {
    orders = await dbRequest<Array<Record<string, unknown>>>(`${base}&select=id,order_number,table_id,customer_id,source,status,items,total,notes,created_at,customer_name_snapshot,phone_snapshot,fulfillment_type,payment_status&order=created_at.desc&limit=${limit}`);
  } catch (error) {
    if (!menuSchemaUnavailable(error)) throw error;
    orders = await dbRequest<Array<Record<string, unknown>>>(`${base}&select=id,order_number,table_id,customer_id,source,status,items,total,notes,created_at,customer_name_snapshot,phone_snapshot&order=created_at.desc&limit=${limit}`);
  }
  const documentLinks = new Map<string, Array<Record<string, unknown>>>();
  const orderIds = orders.map((order) => String(order.id)).filter((id) => UUID.test(id));
  if (orderIds.length) {
    try {
      const links = await dbRequest<Array<{ id: string; restaurant_order_id: string; fiscal_document_id: string; authorized_at: string; customer_available_until: string }>>(
        `/rest/v1/jvg_restaurant_order_documents?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&restaurant_order_id=in.(${orderIds.join(",")})&customer_available_until=gt.${encodeURIComponent(new Date().toISOString())}&select=id,restaurant_order_id,fiscal_document_id,authorized_at,customer_available_until&order=created_at.desc&limit=100`,
      );
      const documentIds = [...new Set(links.map((link) => link.fiscal_document_id))];
      const documents = documentIds.length ? await dbRequest<Array<Record<string, unknown>>>(
        `/rest/v1/jvg_fiscal_documents?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=in.(${documentIds.join(",")})&environment=eq.producao&status=eq.authorized&select=id,document_type,document_number,series,access_key,authorized_at,pdf_storage_path,xml_storage_path&limit=100`,
      ) : [];
      const documentById = new Map(documents.map((document) => [String(document.id), document]));
      for (const link of links) {
        const document = documentById.get(link.fiscal_document_id);
        if (!document) continue;
        const formats = [
          typeof document.pdf_storage_path === "string" && safeFiscalFileUrl(document.pdf_storage_path) ? "pdf" : null,
          typeof document.xml_storage_path === "string" && safeFiscalFileUrl(document.xml_storage_path) ? "xml" : null,
        ].filter((format): format is string => Boolean(format));
        if (!formats.length) continue;
        const rows = documentLinks.get(link.restaurant_order_id) || [];
        rows.push({
          id: link.id, documentType: document.document_type, number: document.document_number,
          series: document.series, accessKey: document.access_key, authorizedAt: document.authorized_at || link.authorized_at,
          availableUntil: link.customer_available_until, formats,
        });
        documentLinks.set(link.restaurant_order_id, rows);
      }
    } catch (error) {
      if (!menuSchemaUnavailable(error)) throw error;
    }
  }
  return orders.map((order) => ({
    id: order.id, order_number: order.order_number, table_id: order.table_id, customer_id: order.customer_id, source: order.source, status: order.status,
    customer_name_snapshot: order.customer_name_snapshot || "", phone_snapshot: order.phone_snapshot || "",
    items: publicOrderItems(order.items), total: Number(order.total) || 0, notes: str(order.notes, 1000),
    created_at: order.created_at, fulfillment_type: order.fulfillment_type || null,
    payment_status: order.payment_status === "paid" ? "paid" : order.payment_status === "pending" ? "pending" : "unknown",
    fiscalDocuments: documentLinks.get(String(order.id)) || [],
  }));
}

async function readRestaurantOrders(scope: Pick<RestaurantScope, "tenant_id" | "company_id">) {
  const recent = encodeURIComponent(new Date(Date.now() - 3 * 86400000).toISOString());
  const base = `/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&created_at=gte.${recent}`;
  try {
    return await dbRequest<Array<Record<string, unknown>>>(`${base}&select=id,order_number,table_id,customer_id,source,status,items,customer_name_snapshot,phone_snapshot,total,notes,created_at,updated_at,payment_method,payment_status,payment_confirmed_at,payment_confirmed_by,fulfillment_type&order=created_at.desc&limit=200`);
  } catch (error) {
    if (!menuSchemaUnavailable(error)) throw error;
    return await dbRequest<Array<Record<string, unknown>>>(`${base}&select=id,order_number,table_id,customer_id,source,status,items,customer_name_snapshot,phone_snapshot,total,notes,created_at,updated_at&order=created_at.desc&limit=200`);
  }
}

async function readKitchenOrders(scope: Pick<RestaurantScope, "tenant_id" | "company_id">) {
  const recent = encodeURIComponent(new Date(Date.now() - 3 * 86400000).toISOString());
  const base = `/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&status=in.(sent_to_kitchen,preparing,ready,delivered)&created_at=gte.${recent}`;
  try {
    return await dbRequest<Array<Record<string, unknown>>>(
      `${base}&select=id,order_number,table_id,customer_id,source,status,items,customer_name_snapshot,phone_snapshot,total,notes,created_at,payment_method,payment_status,payment_confirmed_at,payment_confirmed_by,fulfillment_type&order=created_at.desc&limit=200`,
    );
  } catch (error) {
    if (!menuSchemaUnavailable(error)) throw error;
    return dbRequest<Array<Record<string, unknown>>>(
      `${base}&select=id,order_number,table_id,customer_id,source,status,items,customer_name_snapshot,phone_snapshot,total,notes,created_at&order=created_at.desc&limit=200`,
    );
  }
}

async function readTableRequestQueue(scope: Pick<RestaurantScope, "tenant_id" | "company_id">) {
  try {
    const rows = await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_restaurant_table_requests?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&status=eq.pending&select=id,table_id,request_type,status,created_at&order=created_at.asc&limit=100`);
    return { available: true, rows };
  } catch (error) {
    if (menuSchemaUnavailable(error)) return { available: false, rows: [] };
    throw error;
  }
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
    if (requireCpfMatch && cpf && existing[0].cpf && existing[0].cpf !== cpf) {
      throw new JvgBackendError("O CPF informado não corresponde ao cadastro deste telefone. Confira os dados ou peça ajuda à equipe.", 409);
    }
    if (requireCpfMatch && cpf && !existing[0].cpf) {
      await dbRequest(`/rest/v1/jvg_restaurant_customers?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(existing[0].id)}`, {
        method: "PATCH", body: JSON.stringify({ cpf, updated_at: new Date().toISOString() }),
      });
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

async function saveVerifiedCustomer(
  scope: RestaurantScope,
  identity: { userId: string; phone: string },
  fullNameValue: string,
  cpfValue: string,
) {
  const fullName = fullNameValue.trim();
  const cpf = cpfValue.replace(/\D/g, "") || null;
  if (fullName.length < 2 || fullName.length > 120) throw new JvgBackendError("Informe seu nome completo.", 400);
  if (cpf && !validCpf(cpf)) throw new JvgBackendError("Informe um CPF válido com 11 dígitos.", 400);
  const base = "/rest/v1/jvg_restaurant_customers?tenant_id=" + filterEq(scope.tenant_id) + "&company_id=" + filterEq(scope.company_id);
  const byUser = await dbRequest<Array<{ id: string; full_name: string; cpf: string | null }>>(
    base + "&auth_user_id=" + filterEq(identity.userId) + "&select=id,full_name,cpf&limit=1",
  );
  if (byUser[0]) {
    const savedCpf = cpf || byUser[0].cpf;
    if (!savedCpf) throw new JvgBackendError("Informe seu CPF para concluir o cadastro do cliente.", 400);
    await dbRequest(base + "&id=" + filterEq(byUser[0].id), {
      method: "PATCH",
      body: JSON.stringify({ full_name: fullName, phone: identity.phone, cpf: savedCpf, updated_at: new Date().toISOString() }),
    });
    return { id: byUser[0].id, name: fullName, phone: identity.phone, cpf: savedCpf };
  }

  const byPhone = await dbRequest<Array<{ id: string; auth_user_id: string | null; cpf: string | null }>>(
    base + "&phone=" + filterEq(identity.phone) + "&select=id,auth_user_id,cpf&limit=1",
  );
  if (byPhone[0]?.auth_user_id && byPhone[0].auth_user_id !== identity.userId) {
    throw new JvgBackendError("Este telefone já está associado a outra conta. Fale com a equipe do restaurante para corrigir o cadastro.", 409);
  }
  if (byPhone[0]) {
    if (cpf && byPhone[0].cpf && cpf !== byPhone[0].cpf) throw new JvgBackendError("O CPF informado não corresponde ao cadastro deste telefone. Confira os dados com a equipe.", 409);
    const savedCpf = cpf || byPhone[0].cpf;
    if (!savedCpf) throw new JvgBackendError("Informe seu CPF para concluir o cadastro do cliente.", 400);
    await dbRequest(base + "&id=" + filterEq(byPhone[0].id), {
      method: "PATCH",
      body: JSON.stringify({ auth_user_id: identity.userId, full_name: fullName, cpf: savedCpf, updated_at: new Date().toISOString() }),
    });
    return { id: byPhone[0].id, name: fullName, phone: identity.phone, cpf: savedCpf };
  }
  if (!cpf) throw new JvgBackendError("Informe seu CPF para concluir o cadastro do cliente.", 400);
  const inserted = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_restaurant_customers", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      tenant_id: scope.tenant_id, company_id: scope.company_id, auth_user_id: identity.userId,
      full_name: fullName, phone: identity.phone, cpf,
    }),
  });
  if (inserted[0]) return { id: inserted[0].id, name: fullName, phone: identity.phone, cpf };
  const raced = await dbRequest<Array<{ id: string }>>(
    base + "&auth_user_id=" + filterEq(identity.userId) + "&select=id&limit=1",
  );
  if (!raced[0]) throw new JvgBackendError("Não foi possível salvar o cadastro do cliente.", 409);
  return { id: raced[0].id, name: fullName, phone: identity.phone, cpf };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const slug = url.searchParams.get("slug");
    if (url.searchParams.get("kitchenQueue") === "1") {
      const scope = await requireRestaurant();
      const orders = await readKitchenOrders(scope);
      return apiJson({ orders: orders.map((order) => ({ ...order, total: Number(order.total) || 0, items: Array.isArray(order.items) ? order.items : [] })) });
    }
    if (url.searchParams.get("tableRequests") === "1") {
      const scope = await requireRestaurant();
      const queue = await readTableRequestQueue(scope);
      if (!queue.available) return apiJson({ tableRequests: [], tableRequestsAvailable: false });
      const tables = await dbRequest<Array<{ id: string; label: string }>>(
        `/rest/v1/jvg_restaurant_tables?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&select=id,label&limit=500`,
      );
      const labels = new Map(tables.map((table) => [table.id, table.label]));
      return apiJson({
        tableRequests: queue.rows.map((row) => ({ ...row, table_label: labels.get(String(row.table_id || "")) || "Mesa" })),
        tableRequestsAvailable: true,
      });
    }
    if (url.searchParams.get("document") === "1") {
      const identity = await requireVerifiedRestaurantCustomer(request);
      const documentLinkId = url.searchParams.get("id") || "";
      const format = url.searchParams.get("format");
      if (!UUID.test(documentLinkId) || !["pdf", "xml"].includes(format || "")) throw new JvgBackendError("Documento solicitado inválido.", 400);
      let context: PublicContext;
      if (token) {
        const result = await readPublicTable(token);
        context = { tenant_id: result.tenant_id, company_id: result.company_id, company: result.company, brand: result.brand, table: result.table };
      } else if (slug) context = await readPublicRestaurantBySlug(slug);
      else throw new JvgBackendError("Informe o restaurante para acessar o documento.", 400);
      const scope = { tenant_id: context.tenant_id, company_id: context.company_id };
      const customers = await dbRequest<Array<{ id: string; phone: string }>>(
        `/rest/v1/jvg_restaurant_customers?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&auth_user_id=${filterEq(identity.userId)}&select=id,phone&limit=1`,
      );
      const customer = customers[0];
      if (!customer || customer.phone !== identity.phone) throw new JvgBackendError("Confirme sua conta para acessar este documento.", 403);
      const links = await dbRequest<Array<{ restaurant_order_id: string; fiscal_document_id: string; customer_available_until: string }>>(
        `/rest/v1/jvg_restaurant_order_documents?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(documentLinkId)}&customer_available_until=gt.${encodeURIComponent(new Date().toISOString())}&select=restaurant_order_id,fiscal_document_id,customer_available_until&limit=1`,
      );
      const link = links[0];
      if (!link) throw new JvgBackendError("O acesso à cópia deste documento expirou ou não está disponível.", 410);
      const orders = await dbRequest<Array<{ id: string }>>(
        `/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(link.restaurant_order_id)}&customer_id=${filterEq(customer.id)}&select=id&limit=1`,
      );
      if (!orders[0]) throw new JvgBackendError("Este documento não pertence à sua conta neste restaurante.", 403);
      const documents = await dbRequest<Array<{ document_type: string; status: string; environment: string; document_number: number | null; pdf_storage_path: string | null; xml_storage_path: string | null }>>(
        `/rest/v1/jvg_fiscal_documents?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(link.fiscal_document_id)}&status=eq.authorized&environment=eq.producao&document_type=in.(nfe,nfce)&select=document_type,status,environment,document_number,pdf_storage_path,xml_storage_path&limit=1`,
      );
      const document = documents[0];
      const source = format === "pdf" ? document?.pdf_storage_path : document?.xml_storage_path;
      if (!document || !source || !source.startsWith("https://")) throw new JvgBackendError("O arquivo deste documento ainda não está disponível para consulta.", 404);
      const fileUrl = new URL(source);
      if (!safeFiscalFileUrl(source)) {
        throw new JvgBackendError("O provedor não disponibilizou o arquivo em um endereço permitido.", 502);
      }
      let file: Response;
      try { file = await fetch(fileUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) }); }
      catch { throw new JvgBackendError("Não foi possível obter o arquivo fiscal do provedor. Tente novamente mais tarde.", 502); }
      if (!file.ok) throw new JvgBackendError("O provedor ainda não disponibilizou este arquivo fiscal.", 502);
      const maxBytes = format === "pdf" ? 15 * 1024 * 1024 : 20 * 1024 * 1024;
      const contentLength = Number(file.headers.get("content-length") || 0);
      if (contentLength > maxBytes) throw new JvgBackendError("O arquivo fiscal excede o limite de consulta.", 413);
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > maxBytes) throw new JvgBackendError("O arquivo fiscal excede o limite de consulta.", 413);
      const prefix = new Uint8Array(bytes.slice(0, 256));
      if (format === "pdf") {
        if (new TextDecoder().decode(prefix.slice(0, 5)) !== "%PDF-") throw new JvgBackendError("O provedor retornou um arquivo que não é PDF.", 502);
      } else if (!new TextDecoder().decode(prefix).trimStart().startsWith("<")) {
        throw new JvgBackendError("O provedor retornou um arquivo que não é XML.", 502);
      }
      const expectedType = format === "pdf" ? "application/pdf" : "application/xml";
      const filename = `${document.document_type}-${document.document_number || "documento"}.${format}`;
      return new Response(bytes, { headers: {
        "Content-Type": expectedType,
        "Content-Disposition": `${format === "pdf" ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      } });
    }
    if (url.searchParams.get("account") === "1") {
      const identity = await requireVerifiedRestaurantCustomer(request);
      const requestedCpf = (url.searchParams.get("cpf") || "").replace(/\D/g, "");
      if (requestedCpf && !validCpf(requestedCpf)) throw new JvgBackendError("Confira o CPF informado.", 400);
      let context: PublicContext;
      if (token) {
        const result = await readPublicTable(token);
        context = { tenant_id: result.tenant_id, company_id: result.company_id, company: result.company, brand: result.brand, table: result.table };
      } else if (slug) context = await readPublicRestaurantBySlug(slug);
      else throw new JvgBackendError("Informe o restaurante para consultar sua conta.", 400);

      const scope = { tenant_id: context.tenant_id, company_id: context.company_id };
      const customers = await dbRequest<Array<{ id: string; full_name: string; phone: string; cpf: string | null; loyalty_points: number }>>(
        "/rest/v1/jvg_restaurant_customers?tenant_id=" + filterEq(scope.tenant_id) +
        "&company_id=" + filterEq(scope.company_id) + "&auth_user_id=" + filterEq(identity.userId) +
        "&select=id,full_name,phone,cpf,loyalty_points&limit=1",
      );
      let customer = customers[0];
      if (customer && customer.phone !== identity.phone) throw new JvgBackendError("Confirme novamente o telefone associado a esta conta.", 409);

      if (!customer) {
        const byPhone = await dbRequest<Array<{ id: string; full_name: string; phone: string; cpf: string | null; loyalty_points: number; auth_user_id: string | null }>>(
          "/rest/v1/jvg_restaurant_customers?tenant_id=" + filterEq(scope.tenant_id) +
          "&company_id=" + filterEq(scope.company_id) + "&phone=" + filterEq(identity.phone) +
          "&select=id,full_name,phone,cpf,loyalty_points,auth_user_id&limit=1",
        );
        const phoneRecord = byPhone[0];
        if (phoneRecord?.auth_user_id && phoneRecord.auth_user_id !== identity.userId) {
          throw new JvgBackendError("Este telefone já está associado a outra conta. Fale com o restaurante para revisar o cadastro.", 409);
        }
        if (phoneRecord && (!requestedCpf || !phoneRecord.cpf || phoneRecord.cpf !== requestedCpf)) {
          throw new JvgBackendError("Para recuperar o cadastro, informe o CPF vinculado ao telefone confirmado.", 409);
        }
        if (phoneRecord) {
          const claimed = await dbRequest<Array<{ id: string }>>(
            "/rest/v1/jvg_restaurant_customers?tenant_id=" + filterEq(scope.tenant_id) +
            "&company_id=" + filterEq(scope.company_id) + "&id=" + filterEq(phoneRecord.id) + "&auth_user_id=is.null&phone=" + filterEq(identity.phone),
            { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ auth_user_id: identity.userId, updated_at: new Date().toISOString() }) },
          );
          if (!claimed[0]) throw new JvgBackendError("Não foi possível associar a conta. Atualize e tente novamente.", 409);
          customer = phoneRecord;
        }
      }
      if (!customer) return apiJson({ profile: null, history: [] });
      if (requestedCpf && customer.cpf && customer.cpf !== requestedCpf) {
        throw new JvgBackendError("O CPF não corresponde ao cadastro deste telefone.", 409);
      }
      return apiJson({
        profile: { id: customer.id, name: customer.full_name, phone: identity.phone, cpf: customer.cpf, loyaltyPoints: customer.loyalty_points },
        history: await readCustomerHistory(scope, customer.id, 50),
      });
    }
    if (slug) {
      const context = await readPublicRestaurantBySlug(slug);
      const scope = { tenant_id: context.tenant_id, company_id: context.company_id };
      const { categories, menu } = await readPublicMenu(scope);
      const highlights = await readPublicHighlights(scope, menu);
      const brand = context.brand;
      return apiJson({
        mode: "website",
        company: typeof brand.public_name === "string" && brand.public_name ? brand.public_name : context.company.trade_name || context.company.legal_name,
        description: typeof brand.public_description === "string" ? brand.public_description : "",
        logoUrl: publicAssetUrl(typeof brand.logo_path === "string" ? brand.logo_path : null),
        coverUrl: publicAssetUrl(typeof brand.cover_path === "string" ? brand.cover_path : null),
        brandColor: typeof brand.brand_color === "string" && /^#[0-9a-f]{6}$/i.test(brand.brand_color) ? brand.brand_color : "#1768d2",
        openingHours: brand.opening_hours && typeof brand.opening_hours === "object" ? brand.opening_hours : {},
        table: null, tableOpen: true, onlineOrdersEnabled: brand.website_orders_enabled === true && brand.website_pickup_enabled === true,
        pickupEnabled: brand.website_pickup_enabled === true, categories, menu,
        highlightMode: highlights.mode, highlightTitle: highlights.title, highlightProducts: highlights.products,
        contactPhone: typeof brand.public_contact_phone === "string" ? brand.public_contact_phone : "",
        whatsapp: typeof brand.public_whatsapp === "string" ? brand.public_whatsapp : "",
        email: typeof brand.public_email === "string" ? brand.public_email : "",
        address: typeof brand.public_address === "string" ? brand.public_address : "",
        mapUrl: typeof brand.public_map_url === "string" ? brand.public_map_url : "",
        instagramUrl: typeof brand.public_instagram_url === "string" ? brand.public_instagram_url : "",
        websiteUrl: typeof brand.public_website_url === "string" ? brand.public_website_url : "",
      });
    }
    if (token) {
      const { table, company, brand } = await readPublicTable(token);
      const scope = { tenant_id: table.tenant_id, company_id: table.company_id };
      const { categories, menu } = await readPublicMenu(scope);
      const highlights = await readPublicHighlights(scope, menu);
      return apiJson({
        mode: "table",
        company: typeof brand.public_name === "string" && brand.public_name ? brand.public_name : company.trade_name || company.legal_name,
        description: typeof brand.public_description === "string" ? brand.public_description : "",
        logoUrl: publicAssetUrl(typeof brand.logo_path === "string" ? brand.logo_path : null),
        coverUrl: publicAssetUrl(typeof brand.cover_path === "string" ? brand.cover_path : null),
        brandColor: typeof brand.brand_color === "string" && /^#[0-9a-f]{6}$/i.test(brand.brand_color) ? brand.brand_color : "#1768d2",
        openingHours: brand.opening_hours && typeof brand.opening_hours === "object" ? brand.opening_hours : {},
        table: table.label, tableOpen: table.service_status === "open", onlineOrdersEnabled: brand.qr_orders_enabled === true,
        pickupEnabled: false, categories, menu,
        highlightMode: highlights.mode, highlightTitle: highlights.title, highlightProducts: highlights.products,
        contactPhone: typeof brand.public_contact_phone === "string" ? brand.public_contact_phone : "",
        whatsapp: typeof brand.public_whatsapp === "string" ? brand.public_whatsapp : "",
        email: typeof brand.public_email === "string" ? brand.public_email : "",
        address: typeof brand.public_address === "string" ? brand.public_address : "",
        mapUrl: typeof brand.public_map_url === "string" ? brand.public_map_url : "",
        instagramUrl: typeof brand.public_instagram_url === "string" ? brand.public_instagram_url : "",
        websiteUrl: typeof brand.public_website_url === "string" ? brand.public_website_url : "",
      });
    }

    if (url.searchParams.get("fiscalDocuments") === "1") {
      const scope = await requireRestaurant();
      if (!await moduleAccessGranted(scope, "fiscal_nfe")) throw new JvgBackendError("O módulo Fiscal/NF-e precisa estar liberado para vincular documentos aos pedidos.", 403);
      const documents = await dbRequest<Array<Record<string, unknown>>>(
        `/rest/v1/jvg_fiscal_documents?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&environment=eq.producao&status=eq.authorized&document_type=in.(nfe,nfce)&authorized_at=not.is.null&select=id,document_type,document_number,series,recipient_document,authorized_at,pdf_storage_path,xml_storage_path&order=authorized_at.desc&limit=300`,
      );
      const minimumDate = Date.now() - 30 * 86400000;
      return apiJson({ documents: documents.filter((document) => {
        const authorizedTime = Date.parse(String(document.authorized_at || ""));
        return Number.isFinite(authorizedTime) && authorizedTime >= minimumDate && authorizedTime <= Date.now() &&
          (typeof document.pdf_storage_path === "string" && safeFiscalFileUrl(document.pdf_storage_path) ||
            typeof document.xml_storage_path === "string" && safeFiscalFileUrl(document.xml_storage_path));
      }).map((document) => ({
        id: document.id, type: document.document_type, number: document.document_number, series: document.series,
        recipient: document.recipient_document, authorizedAt: document.authorized_at,
        hasPdf: typeof document.pdf_storage_path === "string" && safeFiscalFileUrl(document.pdf_storage_path),
        hasXml: typeof document.xml_storage_path === "string" && safeFiscalFileUrl(document.xml_storage_path),
      })) });
    }

    const scope = await requireRestaurant();
    const phoneSearch = (url.searchParams.get("phone") || "").replace(/\D/g, "");
    if (phoneSearch) {
      const customers = await dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_restaurant_customers?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&phone=${filterEq(phoneSearch)}&select=id,full_name,phone,cpf,loyalty_points&limit=1`);
      const customer = customers[0];
      if (!customer) return apiJson({ customer: null, history: [] });
      const history = await readCustomerHistory(scope, String(customer.id), 100);
      return apiJson({ customer, history });
    }
    const [settings, tables, products, orders, menuItems, tableRequests] = await Promise.all([
      dbRequest<Array<{ qr_orders_enabled: boolean; loyalty_enabled: boolean; loyalty_points_per_real: number | string }>>(`/rest/v1/jvg_restaurant_settings?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&select=qr_orders_enabled,loyalty_enabled,loyalty_points_per_real&limit=1`),
      dbRequest<Array<Record<string, unknown>>>(`/rest/v1/jvg_restaurant_tables?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&select=id,table_number,label,qr_token,active,service_status,opened_at,closed_at&order=table_number.asc&limit=500`),
      dbRequest<Product[]>(`/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&active=eq.true&select=id,name,description,sku,category,unit,sale_price&order=category.asc,name.asc&limit=500`),
      readRestaurantOrders(scope),
      readMenuItems(scope),
      readTableRequestQueue(scope),
    ]);
    const menuByProduct = new Map(menuItems.map((item) => [item.product_id, item]));
    const componentIds = [...new Set(menuItems.flatMap((item) => normalizeMenuComponents(item.combo_components)?.map((component) => component.productId) || []))];
    const componentRows = componentIds.length ? await dbRequest<Array<{ id: string; name: string; unit: string }>>(
      `/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=in.(${componentIds.join(",")})&select=id,name,unit&limit=100`,
    ) : [];
    const componentById = new Map(componentRows.map((product) => [product.id, product]));
    return apiJson({ settings: settings[0] || { qr_orders_enabled: false, loyalty_enabled: false, loyalty_points_per_real: 1 }, tables, products: products.map((product) => {
      const item = menuByProduct.get(product.id);
      const options = normalizeMenuOptions(item?.options ?? []);
      const components = normalizeMenuComponents(item?.combo_components ?? []);
      const promotion = normalizeMenuPromotion(item?.promotion ?? null, Number(product.sale_price));
      return { ...product, sale_price: Number(product.sale_price), current_price: currentMenuPrice(Number(product.sale_price), promotion === undefined ? null : promotion), image_url: publicAssetUrl(item?.image_path), options: options || [], is_combo: item?.is_combo === true, combo_components: (components || []).map((component) => ({ ...component, name: componentById.get(component.productId)?.name || "Produto indisponível", unit: componentById.get(component.productId)?.unit || "" })), public_active: item?.public_active !== false };
    }), orders: orders.map((order) => ({ ...order, total: Number(order.total) })),
      tableRequests: tableRequests.rows, tableRequestsAvailable: tableRequests.available });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const input = await request.json() as Record<string, unknown>;
    const publicToken = str(input.token, 40);
    const publicSlug = str(input.slug, 60);
    const kind = str(input.kind, 32);
    let scope: RestaurantScope;
    let tableId: string | null = null;
    let source: "table" | "counter" | "qr" | "website" = "counter";
    let fulfillmentType: "table" | "pickup" | null = null;
    let customerIdentity: { userId: string; phone: string } | null = null;
    if (kind === "table-request") {
      const { table } = await readPublicTable(publicToken);
      const requestType = str(input.requestType, 24);
      if (!["call_waiter", "request_bill"].includes(requestType)) throw new JvgBackendError("Solicitação de mesa inválida.", 400);
      if (table.service_status !== "open") throw new JvgBackendError("A mesa está fechada. Peça ajuda à equipe.", 409);
      const created = await dbRequest<Record<string, unknown>>("/rest/v1/rpc/jvg_restaurant_create_table_request", {
        method: "POST",
        body: JSON.stringify({ p_tenant_id: table.tenant_id, p_company_id: table.company_id, p_table_id: table.id, p_request_type: requestType }),
      });
      return apiJson({ ok: true, request: { request_type: requestType, status: created.status, created_at: created.created_at } });
    }
    if (publicToken || publicSlug) {
      if (publicToken) {
        const { table, company, brand, tenant_id, company_id } = await readPublicTable(publicToken);
        if (table.service_status !== "open" && kind !== "customer-profile") throw new JvgBackendError("Esta mesa ainda não foi aberta pela equipe. Peça ajuda para continuar.", 409);
        scope = { tenant_id, company_id };
        tableId = table.id;
        source = "qr";
        fulfillmentType = "table";
        void company; void brand;
      } else {
        const context = await readPublicRestaurantBySlug(publicSlug);
        scope = { tenant_id: context.tenant_id, company_id: context.company_id };
        source = "website";
        fulfillmentType = "pickup";
        if (kind !== "customer-profile" && (context.brand.website_orders_enabled !== true || context.brand.website_pickup_enabled !== true)) {
          throw new JvgBackendError("O restaurante ainda não habilitou pedidos para retirada pelo site.", 409);
        }
      }
      customerIdentity = await requireVerifiedRestaurantCustomer(request);
    } else {
      scope = await requireRestaurant();
      requireWrite(scope);
      if (kind === "link-fiscal-document") {
        if (!await moduleAccessGranted(scope, "fiscal_nfe")) throw new JvgBackendError("O módulo Fiscal/NF-e precisa estar liberado para vincular documentos aos pedidos.", 403);
        const orderId = str(input.orderId, 40);
        const documentId = str(input.fiscalDocumentId, 40);
        if (!UUID.test(orderId) || !UUID.test(documentId)) throw new JvgBackendError("Selecione um pedido e um documento fiscal válidos.", 400);
        const orders = await dbRequest<Array<{ id: string; source: string; customer_id: string | null }>>(
          `/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(orderId)}&select=id,source,customer_id&limit=1`,
        );
        const order = orders[0];
        if (!order || !order.customer_id || !["qr", "website"].includes(order.source)) {
          throw new JvgBackendError("Vincule documentos apenas a pedidos digitais com conta de cliente.", 409);
        }
        const customers = await dbRequest<Array<{ id: string; cpf: string | null }>>(
          `/rest/v1/jvg_restaurant_customers?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(order.customer_id)}&select=id,cpf&limit=1`,
        );
        const customer = customers[0];
        if (!customer?.cpf || !validCpf(customer.cpf)) throw new JvgBackendError("O cliente precisa ter CPF válido cadastrado para associar um documento fiscal à conta.", 409);
        const documents = await dbRequest<Array<{ id: string; document_type: string; recipient_document: string | null; authorized_at: string | null; pdf_storage_path: string | null; xml_storage_path: string | null }>>(
          `/rest/v1/jvg_fiscal_documents?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(documentId)}&environment=eq.producao&status=eq.authorized&document_type=in.(nfe,nfce)&select=id,document_type,recipient_document,authorized_at,pdf_storage_path,xml_storage_path&limit=1`,
        );
        const document = documents[0];
        if (!document) throw new JvgBackendError("Só é possível compartilhar uma NF-e ou NFC-e autorizada em produção.", 409);
        if (document.recipient_document?.replace(/\D/g, "") !== customer.cpf) {
          throw new JvgBackendError("O CPF do destinatário da nota não corresponde ao cadastro deste cliente. O documento não foi vinculado.", 409);
        }
        if (!(safeFiscalFileUrl(document.pdf_storage_path) || safeFiscalFileUrl(document.xml_storage_path))) {
          throw new JvgBackendError("O provedor ainda não disponibilizou o XML nem o PDF desta nota.", 409);
        }
        const authorizedAt = document.authorized_at;
        const authorizedTime = authorizedAt ? Date.parse(authorizedAt) : Number.NaN;
        if (!Number.isFinite(authorizedTime) || authorizedTime > Date.now() + 5 * 60 * 1000) {
          throw new JvgBackendError("A data de autorização não está disponível para validar o prazo de acesso do cliente.", 409);
        }
        const availableUntil = new Date(authorizedTime + 30 * 86400000);
        if (availableUntil.getTime() <= Date.now()) throw new JvgBackendError("Já passaram 30 dias da autorização; o documento permanece no histórico fiscal do ERP, mas não pode ser adicionado à conta do cliente.", 410);
        let existing: Array<{ id: string; restaurant_order_id: string }>;
        try {
          existing = await dbRequest<Array<{ id: string; restaurant_order_id: string }>>(
            `/rest/v1/jvg_restaurant_order_documents?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&fiscal_document_id=${filterEq(documentId)}&select=id,restaurant_order_id&limit=1`,
          );
        } catch (error) {
          if (menuSchemaUnavailable(error)) throw new JvgBackendError("A associação de notas aos pedidos depende da migration local 20261119_jvg_restaurant_order_documents.sql. Ela ainda não foi aplicada.", 503);
          throw error;
        }
        if (existing[0]) {
          if (existing[0].restaurant_order_id !== order.id) throw new JvgBackendError("Este documento já está associado a outro pedido.", 409);
          return apiJson({ ok: true, alreadyLinked: true, id: existing[0].id });
        }
        const user = await getJvgUser();
        let linked: Array<{ id: string }>;
        try {
          linked = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_restaurant_order_documents", {
            method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
            body: JSON.stringify({
              tenant_id: scope.tenant_id, company_id: scope.company_id, restaurant_order_id: order.id,
              fiscal_document_id: document.id, authorized_at: new Date(authorizedTime).toISOString(),
              customer_available_until: availableUntil.toISOString(), linked_by: user?.userId || null,
            }),
          });
        } catch (error) {
          if (menuSchemaUnavailable(error)) throw new JvgBackendError("A associação de notas aos pedidos depende da migration local 20261119_jvg_restaurant_order_documents.sql. Ela ainda não foi aplicada.", 503);
          throw error;
        }
        if (linked[0]) return apiJson({ ok: true, id: linked[0].id, availableUntil: availableUntil.toISOString() }, 201);
        const raced = await dbRequest<Array<{ id: string; restaurant_order_id: string }>>(
          `/rest/v1/jvg_restaurant_order_documents?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&fiscal_document_id=${filterEq(documentId)}&select=id,restaurant_order_id&limit=1`,
        );
        if (raced[0]?.restaurant_order_id === order.id) return apiJson({ ok: true, alreadyLinked: true, id: raced[0].id });
        throw new JvgBackendError("Este documento já está associado a outro pedido.", 409);
      }
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
        const tables = await dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_restaurant_tables?on_conflict=tenant_id,company_id,table_number", {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify(rows),
        });
        return apiJson({ ok: true, tables, createdCount: tables.length, skippedCount: count - tables.length }, 201);
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
    if (customerIdentity && kind === "customer-profile") {
      const profile = await saveVerifiedCustomer(scope, customerIdentity, str(input.customerName, 120), str(input.cpf, 20));
      return apiJson({ ok: true, profile });
    }
    if (customerIdentity && !["quote-order", "order"].includes(kind)) {
      throw new JvgBackendError("Ação de cliente inválida.", 400);
    }
    const items = parseItems(input.items);
    const calculated = await calculateItems(scope, items);
    if (customerIdentity && kind === "quote-order") {
      await assertStockAvailable(scope, calculated.snapshot);
      return apiJson({ ok: true, total: calculated.total, items: publicOrderItems(calculated.snapshot) });
    }
    const customerName = str(input.customerName, 120);
    const phoneInput = customerIdentity?.phone || str(input.phone, 30);
    const cpfInput = str(input.cpf, 20);
    let customer: { id: string; name: string; phone: string } | null = null;
    if (customerIdentity) {
      const profile = await saveVerifiedCustomer(scope, customerIdentity, customerName, cpfInput);
      customer = { id: profile.id, name: profile.name, phone: profile.phone };
    } else if (phoneInput) customer = await saveCustomer(scope, customerName, phoneInput, cpfInput);
    const requestKey = str(input.requestKey, 40);
    if (requestKey && !UUID.test(requestKey)) throw new JvgBackendError("Chave do pedido inválida.", 400);
    if (customerIdentity && !requestKey) throw new JvgBackendError("Atualize o pedido antes de tentar enviá-lo novamente.", 400);
    if (customerIdentity) {
      const expectedTotal = Number(input.expectedTotal);
      if (!Number.isFinite(expectedTotal) || Math.abs(expectedTotal - calculated.total) > 0.009) {
        return apiJson({
          error: "O preço foi atualizado. Confira o novo total e confirme novamente.",
          requiresPriceConfirmation: true, total: calculated.total, items: publicOrderItems(calculated.snapshot),
        }, 409);
      }
    }
    const existing = requestKey ? await dbRequest<Array<{ id: string; order_number: number | string; status: string }>>(
      `/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&request_key=${filterEq(requestKey)}&select=id,order_number,status&limit=1`,
    ) : [];
    if (existing[0]) return apiJson({ ok: true, order: existing[0], duplicate: true });
    if (customerIdentity) await assertStockAvailable(scope, calculated.snapshot);
    const order = await dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_restaurant_orders", {
      method: "POST", body: JSON.stringify({
        tenant_id: scope.tenant_id, company_id: scope.company_id, table_id: tableId,
        customer_id: customer?.id || null, customer_name_snapshot: customer?.name || customerName,
        phone_snapshot: customer?.phone || phoneInput.replace(/\D/g, ""), source,
        fulfillment_type: fulfillmentType, payment_method: "cashier", payment_status: "pending",
        status: "open", items: calculated.snapshot, total: calculated.total,
        notes: str(input.notes, 1000), request_key: requestKey || null,
      }),
    });
    const created = order[0] || {};
    return apiJson({ ok: true, order: {
      id: created.id, order_number: created.order_number, status: created.status || "open",
      payment_status: created.payment_status || "pending", fulfillment_type: created.fulfillment_type || fulfillmentType,
      total: Number(created.total ?? calculated.total), created_at: created.created_at || new Date().toISOString(),
    } }, 201);
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const scope = await requireRestaurant();
    requireWrite(scope);
    const input = await request.json() as Record<string, unknown>;
    const kind = str(input.kind, 20);
    if (kind === "order-payment") {
      const id = str(input.id, 40);
      if (!UUID.test(id)) throw new JvgBackendError("Pedido inválido.", 400);
      const existing = await dbRequest<Array<{ id: string; status: string; payment_method: string; payment_status: string }>>(
        `/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(id)}&select=id,status,payment_method,payment_status&limit=1`,
      );
      if (!existing[0]) throw new JvgBackendError("Pedido não encontrado nesta empresa.", 404);
      if (existing[0].payment_status === "paid") return apiJson({ ok: true, alreadyPaid: true });
      if (existing[0].status === "cancelled") throw new JvgBackendError("Não é possível registrar pagamento de um pedido cancelado.", 409);
      if (existing[0].payment_method !== "cashier") throw new JvgBackendError("Este pedido não está configurado para pagamento no caixa.", 409);
      const user = await getJvgUser();
      if (!user) throw new JvgBackendError("Faça login novamente para registrar o recebimento.", 401);
      const updated = await dbRequest<Array<{ id: string }>>(
        `/rest/v1/jvg_restaurant_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(id)}&payment_status=eq.pending`,
        { method: "PATCH", body: JSON.stringify({ payment_status: "paid", payment_confirmed_at: new Date().toISOString(), payment_confirmed_by: user.userId, updated_at: new Date().toISOString() }), headers: { Prefer: "return=representation" } },
      );
      if (!updated[0]) throw new JvgBackendError("O pedido mudou enquanto você registrava o pagamento. Atualize os pedidos e confira a situação.", 409);
      return apiJson({ ok: true, payment_status: "paid", confirmation: "manual_cashier" });
    }
    if (kind === "table-request") {
      const id = str(input.id, 40);
      const status = str(input.status, 20);
      if (!UUID.test(id) || !["attended", "cancelled"].includes(status)) throw new JvgBackendError("Solicitação de mesa inválida.", 400);
      const updated = await dbRequest<Array<{ id: string }>>(
        `/rest/v1/jvg_restaurant_table_requests?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(id)}&status=eq.pending`,
        { method: "PATCH", body: JSON.stringify({ status, updated_at: new Date().toISOString() }), headers: { Prefer: "return=representation" } },
      );
      if (!updated[0]) throw new JvgBackendError("Solicitação não encontrada ou já atendida.", 409);
      return apiJson({ ok: true, status });
    }
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
