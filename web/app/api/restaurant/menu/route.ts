import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, moduleAccessGranted, safeError, str } from "../../../../lib/jvg-backend";
import { currentMenuPrice, normalizeMenuComponents, normalizeMenuOptions, normalizeMenuPromotion } from "../../../../lib/restaurant-menu";
import { jvgRuntime } from "../../../../lib/jvg-runtime";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANY_LOGO_BUCKET = "jvg-company-logos";
const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Scope = { tenant_id: string; company_id: string; role?: string };
type ProductRow = { id: string; name: string; description: string | null; sku: string | null; category: string | null; unit: string; sale_price: number | string; active: boolean };
type MenuRow = { product_id: string; image_path: string | null; options: unknown; is_combo: boolean; combo_components: unknown; promotion: unknown; public_active: boolean; sort_order: number };
type CategoryRow = { id: string; name: string; active: boolean; sort_order: number };
type SettingsRow = {
  qr_orders_enabled: boolean; public_name: string | null; public_description: string | null;
  logo_path: string | null; cover_path: string | null; brand_color: string | null; opening_hours: unknown;
  public_slug: string | null; website_enabled: boolean; website_orders_enabled: boolean; website_pickup_enabled: boolean;
  public_contact_phone: string | null; public_whatsapp: string | null; public_email: string | null;
  public_address: string | null; public_map_url: string | null; public_instagram_url: string | null; public_website_url: string | null;
};

function missingMenuSchema(error: unknown) {
  return error instanceof JvgBackendError && ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.databaseCode || "");
}

function scopeQuery(scope: Scope) {
  return `tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}`;
}

function publicAssetUrl(path: string | null | undefined) {
  if (!path) return null;
  const runtime = jvgRuntime();
  if (!runtime.supabaseUrl) return null;
  return `${runtime.supabaseUrl}/storage/v1/object/public/${COMPANY_LOGO_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function requireScope(write = false): Promise<Scope> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user, { requiredModule: "restaurante" });
  if (!account) throw new JvgBackendError("Não encontramos uma empresa ativa para este usuário.", 409);
  if (write && account.role === "viewer") throw new JvgBackendError("Seu acesso permite consulta, mas não alterar o cardápio.", 403);
  return account;
}

function normalizeOpeningHours(value: unknown): Record<string, { open: boolean; from: string; to: string }> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const result: Record<string, { open: boolean; from: string; to: string }> = {};
  for (const day of days) {
    const raw = input[day];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const open = row.open === true;
    const from = typeof row.from === "string" ? row.from : "";
    const to = typeof row.to === "string" ? row.to : "";
    const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    if (open && (!validTime(from) || !validTime(to) || from === to)) return null;
    result[day] = { open, from: open ? from : "", to: open ? to : "" };
  }
  return result;
}

function productPayload(product: ProductRow, menu: MenuRow | undefined) {
  const options = normalizeMenuOptions(menu?.options ?? []);
  const components = normalizeMenuComponents(menu?.combo_components ?? []);
  const promotion = normalizeMenuPromotion(menu?.promotion ?? null, Number(product.sale_price));
  const basePrice = Number(product.sale_price);
  const safePromotion = promotion === undefined ? null : promotion;
  return {
    id: product.id,
    name: product.name,
    description: product.description || "",
    sku: product.sku || "",
    category: product.category || "",
    unit: product.unit,
    salePrice: basePrice,
    active: product.active,
    imagePath: menu?.image_path || null,
    imageUrl: publicAssetUrl(menu?.image_path),
    options: options || [],
    isCombo: menu?.is_combo === true,
    comboComponents: components || [],
    promotion: safePromotion,
    publicActive: menu?.public_active !== false && product.active,
    sortOrder: Number(menu?.sort_order || 0),
    currentPrice: currentMenuPrice(basePrice, safePromotion),
  };
}

export async function GET() {
  try {
    const scope = await requireScope();
    const scoped = scopeQuery(scope);
    const [products, previewTables] = await Promise.all([
      dbRequest<ProductRow[]>(`/rest/v1/jvg_products?${scoped}&select=id,name,description,sku,category,unit,sale_price,active&order=category.asc,name.asc&limit=1000`),
      dbRequest<Array<{ label: string; qr_token: string }>>(`/rest/v1/jvg_restaurant_tables?${scoped}&active=eq.true&select=label,qr_token&order=table_number.asc&limit=1`),
    ]);
    let categories: CategoryRow[] = [];
    let menuItems: MenuRow[] = [];
    let settings: SettingsRow = {
      qr_orders_enabled: false, public_name: null, public_description: null, logo_path: null, cover_path: null, brand_color: null, opening_hours: {},
      public_slug: null, website_enabled: false, website_orders_enabled: false, website_pickup_enabled: false,
      public_contact_phone: null, public_whatsapp: null, public_email: null, public_address: null, public_map_url: null, public_instagram_url: null, public_website_url: null,
    };
    let schemaReady = true;

    const [categoryResult, menuResult, settingsResult] = await Promise.allSettled([
      dbRequest<CategoryRow[]>(`/rest/v1/jvg_restaurant_categories?${scoped}&select=id,name,active,sort_order&order=sort_order.asc,name.asc&limit=500`),
      dbRequest<MenuRow[]>(`/rest/v1/jvg_restaurant_menu_items?${scoped}&select=product_id,image_path,options,is_combo,combo_components,promotion,public_active,sort_order&limit=1000`),
      dbRequest<SettingsRow[]>("/rest/v1/jvg_restaurant_settings?" + scoped + "&select=qr_orders_enabled,public_name,public_description,logo_path,cover_path,brand_color,opening_hours,public_slug,website_enabled,website_orders_enabled,website_pickup_enabled,public_contact_phone,public_whatsapp,public_email,public_address,public_map_url,public_instagram_url,public_website_url&limit=1"),
    ]);
    for (const result of [categoryResult, menuResult, settingsResult]) {
      if (result.status === "rejected" && !missingMenuSchema(result.reason)) throw result.reason;
      if (result.status === "rejected") schemaReady = false;
    }
    if (categoryResult.status === "fulfilled") categories = categoryResult.value;
    if (menuResult.status === "fulfilled") menuItems = menuResult.value;
    if (settingsResult.status === "fulfilled" && settingsResult.value[0]) settings = settingsResult.value[0];

    const menuByProduct = new Map(menuItems.map((item) => [item.product_id, item]));
    const existingNames = new Set(categories.map((category) => category.name.toLocaleLowerCase("pt-BR")));
    for (const name of [...new Set(products.map((product) => product.category?.trim()).filter((value): value is string => Boolean(value)))]) {
      if (!existingNames.has(name.toLocaleLowerCase("pt-BR"))) categories.push({ id: `legacy:${name}`, name, active: true, sort_order: 10000 });
    }
    return apiJson({
      schemaReady,
      previewTable: previewTables[0] || null,
      products: products.map((product) => productPayload(product, menuByProduct.get(product.id))),
      categories: categories.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "pt-BR")),
      settings: {
        qrOrdersEnabled: settings.qr_orders_enabled,
        publicName: settings.public_name || "",
        publicDescription: settings.public_description || "",
        logoPath: settings.logo_path,
        logoUrl: publicAssetUrl(settings.logo_path),
        coverPath: settings.cover_path,
        coverUrl: publicAssetUrl(settings.cover_path),
        brandColor: settings.brand_color || "#1768d2",
        openingHours: settings.opening_hours && typeof settings.opening_hours === "object" ? settings.opening_hours : {},
        publicSlug: settings.public_slug || "",
        websiteEnabled: settings.website_enabled,
        websiteOrdersEnabled: settings.website_orders_enabled,
        websitePickupEnabled: settings.website_pickup_enabled,
        contactPhone: settings.public_contact_phone || "",
        whatsapp: settings.public_whatsapp || "",
        publicEmail: settings.public_email || "",
        publicAddress: settings.public_address || "",
        mapUrl: settings.public_map_url || "",
        instagramUrl: settings.public_instagram_url || "",
        publicWebsiteUrl: settings.public_website_url || "",
      },
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const scope = await requireScope(true);
    const input = await request.json() as Record<string, unknown>;
    const action = str(input.action, 32);

    if (action === "save-product-basic") {
      const id = str(input.id, 40);
      const name = str(input.name, 160);
      const description = str(input.description, 1000);
      const category = str(input.category, 80);
      const price = Number(input.salePrice);
      if (!UUID.test(id) || name.length < 2 || !Number.isFinite(price) || price < 0 || price > 1000000) throw new JvgBackendError("Confira nome, categoria e preço do produto.", 400);
      const updated = await dbRequest<Array<{ id: string }>>(`/rest/v1/jvg_products?${scopeQuery(scope)}&id=${filterEq(id)}&select=id`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ name, description: description || null, category: category || null, sale_price: price, updated_at: new Date().toISOString() }),
      });
      if (!updated[0]) throw new JvgBackendError("Produto não encontrado nesta empresa.", 404);
      return apiJson({ ok: true, id });
    }

    if (action === "save-product") {
      const id = str(input.id, 40);
      const name = str(input.name, 160);
      const description = str(input.description, 1000);
      const category = str(input.category, 60);
      const price = Number(input.salePrice);
      const publicActive = input.publicActive === true;
      const options = normalizeMenuOptions(input.options);
      const isCombo = input.isCombo === true;
      const components = normalizeMenuComponents(input.comboComponents);
      const promotion = normalizeMenuPromotion(input.promotion, price);
      if (!UUID.test(id) || name.length < 2 || !Number.isFinite(price) || price < 0 || price > 1000000 || options === null || components === null || promotion === undefined) {
        throw new JvgBackendError("Confira os dados do produto, opções, combo e promoção.", 400);
      }
      if (!isCombo && components.length) throw new JvgBackendError("Remova os componentes ou marque este produto como combo.", 400);
      if (isCombo && !components.length) throw new JvgBackendError("Adicione pelo menos um produto ao combo.", 400);
      if (publicActive && price <= 0) throw new JvgBackendError("Um item publicado precisa ter preço de venda maior que zero.", 400);
      if (promotion && promotion.price >= price) throw new JvgBackendError("O preço promocional precisa ser menor que o preço normal.", 400);
      const productRows = await dbRequest<Array<{ id: string; active: boolean }>>("/rest/v1/jvg_products?" + scopeQuery(scope) + "&id=" + filterEq(id) + "&select=id,active&limit=1");
      if (!productRows[0]) throw new JvgBackendError("Produto nao encontrado nesta empresa.", 404);
      if (publicActive && !productRows[0].active) throw new JvgBackendError("Ative o produto no cadastro do ERP antes de publica-lo no cardapio.", 409);
      if (components.length) {
        if (components.some((component) => component.productId === id)) throw new JvgBackendError("Um combo não pode conter a si mesmo.", 400);
        const componentIds = [...new Set(components.map((component) => component.productId))];
        const found = await dbRequest<Array<{ id: string }>>(`/rest/v1/jvg_products?${scopeQuery(scope)}&id=in.(${componentIds.join(",")})&active=eq.true&select=id&limit=20`);
        if (found.length !== componentIds.length) throw new JvgBackendError("Todos os itens do combo devem estar ativos e pertencer a esta empresa.", 400);
      }
      const saved = await dbRequest<boolean>("/rest/v1/rpc/jvg_restaurant_save_menu_item", {
        method: "POST",
        body: JSON.stringify({
          p_tenant_id: scope.tenant_id, p_company_id: scope.company_id, p_product_id: id,
          p_name: name, p_description: description, p_category: category,
          p_sale_price: price, p_options: options, p_is_combo: isCombo,
          p_combo_components: isCombo ? components : [], p_promotion: promotion,
          p_public_active: publicActive, p_sort_order: Number(input.sortOrder || 0),
        }),
      });
      if (saved !== true) throw new JvgBackendError("Produto não encontrado nesta empresa.", 404);
      return apiJson({ ok: true, id });
    }

    if (action === "create-category") {
      const name = str(input.name, 60);
      if (name.length < 2) throw new JvgBackendError("O nome da categoria deve ter de 2 a 60 caracteres.", 400);
      const created = await dbRequest<Array<{ id: string; name: string }>>("/rest/v1/jvg_restaurant_categories", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ tenant_id: scope.tenant_id, company_id: scope.company_id, name }),
      });
      if (!created[0]) throw new JvgBackendError("A categoria não foi criada.", 502);
      return apiJson({ ok: true, category: created[0] }, 201);
    }

    if (action === "rename-category" || action === "delete-category") {
      const id = str(input.id, 40);
      const name = action === "rename-category" ? str(input.name, 60) : "";
      if (!UUID.test(id) || (action === "rename-category" && name.length < 2)) throw new JvgBackendError("Informe uma categoria válida.", 400);
      const updated = await dbRequest<boolean>("/rest/v1/rpc/jvg_restaurant_rename_category", {
        method: "POST", body: JSON.stringify({ p_tenant_id: scope.tenant_id, p_company_id: scope.company_id, p_category_id: id, p_new_name: name, p_delete: action === "delete-category" }),
      });
      if (updated !== true) throw new JvgBackendError("Categoria não encontrada nesta empresa.", 404);
      return apiJson({ ok: true });
    }

    if (action === "save-brand") {
      const publicName = str(input.publicName, 120);
      const description = str(input.publicDescription, 280);
      const brandColor = str(input.brandColor, 7);
      const publicSlug = str(input.publicSlug, 60).toLowerCase();
      const websiteEnabled = input.websiteEnabled === true;
      const websiteOrdersEnabled = input.websiteOrdersEnabled === true;
      const websitePickupEnabled = input.websitePickupEnabled === true;
      const contactPhone = str(input.contactPhone, 24).replace(/\D/g, "");
      const whatsapp = str(input.whatsapp, 24).replace(/\D/g, "");
      const publicEmail = str(input.publicEmail, 160);
      const publicAddress = str(input.publicAddress, 300);
      const safeUrl = (value: unknown, label: string) => {
        const raw = str(value, 500);
        if (!raw) return null;
        try {
          const parsed = new URL(raw);
          if (parsed.protocol !== "https:" || !parsed.hostname.includes(".")) throw new Error();
          return parsed.toString();
        } catch { throw new JvgBackendError("Informe um endereço HTTPS válido para " + label + ".", 400); }
      };
      const mapUrl = safeUrl(input.mapUrl, "o mapa");
      const instagramUrl = safeUrl(input.instagramUrl, "o Instagram");
      const publicWebsiteUrl = safeUrl(input.publicWebsiteUrl, "o site");
      const openingHours = normalizeOpeningHours(input.openingHours);
      if ((publicName && publicName.length < 2) || (brandColor && !/^#[0-9a-f]{6}$/i.test(brandColor)) || openingHours === null ||
          (publicSlug && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(publicSlug) || publicSlug.length < 3)) ||
          (websiteEnabled && !publicSlug) || (websiteOrdersEnabled && (!websiteEnabled || !websitePickupEnabled)) ||
          (contactPhone && !/^\d{10,13}$/.test(contactPhone)) || (whatsapp && !/^\d{10,13}$/.test(whatsapp)) ||
          (publicEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicEmail))) {
        throw new JvgBackendError("Confira o nome, o endereço público, contato, cor, horários e as opções de pedido.", 400);
      }
      if (websiteEnabled && !await moduleAccessGranted(scope, "restaurante_online")) {
        throw new JvgBackendError("O módulo Site e pedidos online do restaurante ainda não está liberado para esta empresa. Solicite a ativação no painel administrativo.", 402);
      }
      try { await dbRequest("/rest/v1/jvg_restaurant_settings?on_conflict=tenant_id,company_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          tenant_id: scope.tenant_id, company_id: scope.company_id, public_name: publicName || null,
          public_description: description || null, brand_color: brandColor || null, opening_hours: openingHours,
          public_slug: publicSlug || null, website_enabled: websiteEnabled,
          website_orders_enabled: websiteOrdersEnabled, website_pickup_enabled: websitePickupEnabled,
          public_contact_phone: contactPhone || null, public_whatsapp: whatsapp || null, public_email: publicEmail || null,
          public_address: publicAddress || null, public_map_url: mapUrl, public_instagram_url: instagramUrl,
          public_website_url: publicWebsiteUrl, updated_at: new Date().toISOString(),
        }),
      }); } catch (error) {
        if (error instanceof JvgBackendError && error.databaseCode === "23505" && publicSlug) {
          throw new JvgBackendError("Este endereço público já está sendo usado por outro restaurante. Escolha outro.", 409);
        }
        throw error;
      }
      return apiJson({ ok: true, publicUrl: websiteEnabled ? "/r/" + publicSlug : null });
    }

    throw new JvgBackendError("Ação de cardápio inválida.", 400);
  } catch (error) { return safeError(error); }
}
