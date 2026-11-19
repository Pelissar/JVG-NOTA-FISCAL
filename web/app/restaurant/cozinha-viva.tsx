"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./restaurant.module.css";

type Product = { id: string; name: string; sku: string; category: string | null; unit: string; cost_price: number; sale_price: number; minimum_stock: number; tracks_stock: boolean; balance: number };
type RecipeItem = { id: string; recipe_version_id: string; position: number; ingredient_product_id: string; quantity_per_yield: number; unit: string; conversion_to_stock_unit: number; ingredient_name: string; ingredient_stock_unit: string; ingredient_cost_price: number };
type Recipe = { id: string; menu_product_id: string; version_no: number; yield_quantity: number; yield_unit: string; minimum_margin_percent: number | null; notes: string; is_current: boolean; created_at: string; items: RecipeItem[] };
type Cost = { id: string; ingredient_product_id: string; inbound_nfe_id: string; inbound_nfe_item_number: number; supplier_name_snapshot: string; invoice_number_snapshot: string; source_quantity: number; source_unit: string; source_unit_cost: number; conversion_to_stock_unit: number; stock_unit: string; stock_unit_cost: number; lot_snapshot: Array<{ lotNumber?: string; expiresAt?: string | null }> ; created_at: string };
type InboundItem = { lineNumber: number; description: string; unit: string; quantity: number; unitPrice: number; productId: string | null; trackStock: boolean; conversionToStockUnit: number | null; batches: Array<{ lotNumber?: string; expiresAt?: string | null }> };
type InboundDoc = { id: string; invoiceNumber: string; series: string; issuedAt: string | null; supplierName: string; items: InboundItem[] };
type CountSession = { id: string; label: string; status: "open" | "closed"; opened_at: string; closed_at?: string | null };
type CountItem = { id: string; ingredient_product_id: string; expected_at_open: number; expected_at_count: number | null; counted_quantity: number | null; counted_at: string | null; expected_at_close: number | null; variance: number | null; classification: string | null; note: string; product: Product | null };
type OrderItem = { product_id: string; description: string; quantity: number; unit_price: number; total: number; recipeSnapshot?: RecipeSnapshot | null };
type RecipeSnapshot = { versionId: string; versionNo: number; yieldQuantity: number; yieldUnit: string; ingredients: Array<{ productId: string; name: string; stockUnit: string; quantityPerYield: number; unit: string; conversionToStockUnit: number; unitCostAtSale: number | null }> };
type Order = { id: string; order_number: number; source: string; items: OrderItem[]; created_at: string };
type PrepRun = { id: string; menu_product_id: string; recipe_version_id: string; shift_name: string; starts_at: string; ends_at: string; prepared_quantity: number; remaining_quantity: number; notes: string; sold_quantity: number; unaccounted_quantity: number; menuProduct: Product | null; recipeVersion: Recipe | null };
type KitchenData = { products: Product[]; recipes: Recipe[]; costHistory: Cost[]; inboundDocs: InboundDoc[]; countSession: CountSession | null; countItems: CountItem[]; recentSessions: CountSession[]; prepRuns: PrepRun[]; deliveredOrders: Order[]; salesWindowComplete: boolean; alerts: { lowStock: Array<{ productId: string; name: string; unit: string; balance: number; minimum: number }>; missingRecipes: Array<{ productId: string; name: string; salePrice: number }> } };
type RecipeLine = { ingredientProductId: string; quantityPerYield: string; unit: string; conversionToStockUnit: string };
const EMPTY_PRODUCTS: Product[] = [];

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(value) ? value : 0);
const quantity = (value: number, digits = 3) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const businessDate = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const isoDay = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

export function CozinhaViva() {
  const [data, setData] = useState<KitchenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [menuProductId, setMenuProductId] = useState("");
  const [countLabel, setCountLabel] = useState("");
  const [lossProductId, setLossProductId] = useState("");
  const [lossQuantity, setLossQuantity] = useState("");
  const [lossReason, setLossReason] = useState("");
  const [forecastDate, setForecastDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return businessDate(tomorrow.toISOString());
  });
  const [prepProductId, setPrepProductId] = useState("");
  const [prepShift, setPrepShift] = useState("");
  const [prepStart, setPrepStart] = useState("");
  const [prepEnd, setPrepEnd] = useState("");
  const [prepQuantity, setPrepQuantity] = useState("");
  const [prepLeftover, setPrepLeftover] = useState("0");
  const [prepNotes, setPrepNotes] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/restaurant/cozinha-viva", { cache: "no-store" });
      const payload = await response.json() as KitchenData & { error?: string; migrationRequired?: boolean };
      if (!response.ok) {
        if (payload.migrationRequired) setMigrationRequired(true);
        throw new Error(payload.error || "Não foi possível carregar os dados da Cozinha Viva.");
      }
      setMigrationRequired(false);
      setData(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os dados da Cozinha Viva.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // Initial asynchronous load populates this screen's remote data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function act(action: string, body: Record<string, unknown>, method: "POST" | "PATCH" = "POST") {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/restaurant/cozinha-viva", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
      const payload = await response.json() as { error?: string; migrationRequired?: boolean; result?: Record<string, unknown>; recipe?: Record<string, unknown> };
      if (!response.ok) {
        if (payload.migrationRequired) setMigrationRequired(true);
        throw new Error(payload.error || "Não foi possível salvar esta operação.");
      }
      const confirmations: Record<string, string> = {
        "save-recipe": `Ficha técnica v${String(payload.recipe?.version || "")} salva. As vendas anteriores mantêm sua versão.`,
        "apply-cost": "Custo da compra registrado e atualizado no cadastro do ingrediente.",
        "open-count": "Contagem aberta. Informe o estoque físico por ingrediente.",
        "record-loss": "Perda registrada no livro de movimentos do estoque.",
        "record-prep": "Preparo do turno registrado para comparação com vendas reais.",
        "save-count-item": "Contagem salva com horário de registro.",
        "close-count": "Contagem encerrada e diferenças registradas no estoque.",
      };
      setMessage(confirmations[action] || "Alteração salva.");
      await refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar esta operação.");
      return false;
    } finally { setBusy(false); }
  }

  const products = data?.products || EMPTY_PRODUCTS;
  const stockProducts = useMemo(() => products.filter((product) => product.tracks_stock), [products]);
  const menuProducts = useMemo(() => products.filter((product) => product.sale_price > 0), [products]);
  const effectiveMenuId = menuProductId || menuProducts[0]?.id || "";
  const currentRecipe = data?.recipes.find((recipe) => recipe.menu_product_id === effectiveMenuId && recipe.is_current) || null;
  const recipeCostRows = useMemo(() => {
    if (!data) return [];
    return data.recipes.filter((recipe) => recipe.is_current).map((recipe) => {
      const product = products.find((row) => row.id === recipe.menu_product_id);
      const costsKnown = recipe.items.length > 0 && recipe.items.every((item) => item.ingredient_cost_price > 0);
      const costPerYield = costsKnown ? recipe.items.reduce((sum, item) => sum + item.quantity_per_yield * item.conversion_to_stock_unit * item.ingredient_cost_price, 0) : null;
      const costPerPortion = costPerYield === null ? null : costPerYield / recipe.yield_quantity;
      return { recipe, product, costsKnown, costPerPortion, margin: costPerPortion === null || !product ? null : product.sale_price - costPerPortion };
    });
  }, [data, products]);
  const marginAlerts = useMemo(() => recipeCostRows.flatMap(({ recipe, product, costsKnown, costPerPortion, margin }) => {
    const target = recipe.minimum_margin_percent;
    if (!costsKnown || target === null || !product || product.sale_price <= 0 || margin === null) return [];
    const current = margin / product.sale_price * 100;
    if (current >= target) return [];
    return [{ key: `margin-${recipe.id}`, title: `${product.name}: contribuição abaixo do mínimo configurado`, detail: `Preço cadastrado ${money(product.sale_price)}; custo cadastrado atual por porção ${money(costPerPortion || 0)}; contribuição estimada ${quantity(current, 1)}%, abaixo do objetivo informado de ${quantity(target, 1)}%.`, action: "Revisar ficha e preço", href: "#recipe-section" }];
  }), [recipeCostRows]);
  const costAlerts = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.costHistory].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const byProduct = new Map<string, Cost[]>();
    for (const entry of sorted) byProduct.set(entry.ingredient_product_id, [...(byProduct.get(entry.ingredient_product_id) || []), entry]);
    return [...byProduct.entries()].flatMap(([productId, entries]) => {
      if (entries.length < 2 || entries[0].stock_unit_cost === entries[1].stock_unit_cost) return [];
      const product = products.find((row) => row.id === productId);
      return [{ productName: product?.name || "Ingrediente", current: entries[0], previous: entries[1], direction: entries[0].stock_unit_cost > entries[1].stock_unit_cost ? "aumentou" : "reduziu" }];
    });
  }, [data, products]);
  const expiringLots = useMemo(() => {
    if (!data) return [];
    const today = businessDate(new Date().toISOString());
    const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 30);
    const endDay = isoDay(end);
    return data.inboundDocs.flatMap((document) => document.items.filter((item) => item.trackStock && item.productId).flatMap((item) => (item.batches || []).flatMap((lot) => {
      if (!lot.expiresAt || lot.expiresAt > endDay) return [];
      return [{ productName: products.find((row) => row.id === item.productId)?.name || item.description, lot: lot.lotNumber || "Lote sem número", expiresAt: lot.expiresAt, expired: lot.expiresAt < today }];
    })));
  }, [data, products]);
  const forecasts = useMemo(() => {
    if (!data || !forecastDate) return [];
    const target = new Date(`${forecastDate}T00:00:00Z`);
    const dates = Array.from({ length: 8 }, (_, index) => { const day = new Date(target); day.setUTCDate(day.getUTCDate() - 7 * (index + 1)); return isoDay(day); });
    const daily = new Map<string, Map<string, number>>();
    for (const order of data.deliveredOrders) {
      const day = businessDate(order.created_at);
      if (!dates.includes(day)) continue;
      const byProduct = daily.get(day) || new Map<string, number>();
      for (const item of order.items || []) byProduct.set(item.product_id, (byProduct.get(item.product_id) || 0) + Number(item.quantity || 0));
      daily.set(day, byProduct);
    }
    const sourceDates = dates.filter((day) => daily.has(day)).sort();
    return menuProducts.map((product) => {
      const samples = sourceDates.map((day) => ({ date: day, sold: daily.get(day)?.get(product.id) || 0 }));
      const enough = data.salesWindowComplete && samples.length >= 4;
      const average = enough ? samples.reduce((sum, item) => sum + item.sold, 0) / samples.length : null;
      return { product, samples, suggested: average === null ? null : Math.ceil(average), confidence: samples.length >= 8 ? "Boa" : samples.length >= 4 ? "Limitada" : "Insuficiente" };
    }).filter((row) => row.suggested !== null || row.samples.length < 4);
  }, [data, forecastDate, menuProducts]);
  const channelSummary = useMemo(() => {
    if (!data) return [];
    const channels = new Map<string, { revenue: number; estimatedCost: number; known: number; total: number }>();
    for (const order of data.deliveredOrders) {
      const value = channels.get(order.source) || { revenue: 0, estimatedCost: 0, known: 0, total: 0 };
      for (const item of order.items || []) {
        value.revenue += Number(item.total || 0);
        value.total += 1;
        const snapshot = item.recipeSnapshot;
        if (!snapshot?.yieldQuantity || !snapshot.ingredients.length || snapshot.ingredients.some((ingredient) => ingredient.unitCostAtSale === null)) continue;
        value.estimatedCost += Number(item.quantity) * snapshot.ingredients.reduce((sum, ingredient) => sum + ingredient.quantityPerYield * ingredient.conversionToStockUnit * Number(ingredient.unitCostAtSale) / snapshot.yieldQuantity, 0);
        value.known += 1;
      }
      channels.set(order.source, value);
    }
    return [...channels.entries()].map(([source, value]) => ({ source: source === "qr" ? "QR" : source === "table" ? "Mesa" : "Balcão", ...value }));
  }, [data]);
  const projectedShortages = useMemo(() => {
    if (!data || !data.salesWindowComplete) return [];
    const demandByIngredient = new Map<string, { quantity: number; menuNames: string[]; samples: number }>();
    for (const forecast of forecasts) {
      if (forecast.suggested === null) continue;
      const recipe = data.recipes.find((row) => row.menu_product_id === forecast.product.id && row.is_current);
      if (!recipe) continue;
      for (const item of recipe.items) {
        const demand = demandByIngredient.get(item.ingredient_product_id) || { quantity: 0, menuNames: [], samples: forecast.samples.length };
        demand.quantity += forecast.suggested * item.quantity_per_yield * item.conversion_to_stock_unit / recipe.yield_quantity;
        if (!demand.menuNames.includes(forecast.product.name)) demand.menuNames.push(forecast.product.name);
        demandByIngredient.set(item.ingredient_product_id, demand);
      }
    }
    return [...demandByIngredient.entries()].flatMap(([productId, demand]) => {
      const ingredient = products.find((row) => row.id === productId);
      if (!ingredient || demand.quantity <= ingredient.balance) return [];
      return [{ key: `shortage-${productId}`, title: `${ingredient.name}: saldo pode não cobrir o próximo turno`, detail: `Saldo registrado ${quantity(ingredient.balance)} ${ingredient.unit}; demanda estimada ${quantity(demand.quantity)} ${ingredient.unit} para ${demand.menuNames.join(", ")}. A conta usa a ficha atual e as vendas observadas, não é garantia de venda.`, action: "Conferir estoque", href: "#count-section" }];
    });
  }, [data, forecasts, products]);

  async function applyCost(doc: InboundDoc, item: InboundItem) {
    if (!item.productId || !item.trackStock || !item.conversionToStockUnit) { setError("Este item precisa ter produto, estoque e conversão confirmados na conferência da NF-e."); return; }
    if (!window.confirm(`Registrar ${money(item.unitPrice / item.conversionToStockUnit)} por ${products.find((product) => product.id === item.productId)?.unit || "unidade de estoque"}, usando a linha ${item.lineNumber} da NF-e ${doc.invoiceNumber}? Frete e descontos não serão rateados.`)) return;
    await act("apply-cost", { documentId: doc.id, lineNumber: item.lineNumber, productId: item.productId, conversionToStockUnit: item.conversionToStockUnit });
  }

  if (loading && !data && !migrationRequired) return <section className={styles.panel}><p role="status">Carregando dados reais de estoque, compras e vendas...</p></section>;
  if (migrationRequired) return <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.step}>COZINHA VIVA</span><h2>Estrutura pendente no banco</h2><p>O restante do restaurante continua disponível.</p></div></div><div className={styles.infoBox}>Aplique a migration versionada <strong>20261119_jvg_kitchen_live.sql</strong> no Supabase antes de usar receitas, custo rastreável, contagens e baixa de ingredientes. Ela não foi aplicada automaticamente.</div>{error ? <p className={styles.alertError} role="alert">{error}</p> : null}<button className={styles.refresh} onClick={() => void refresh()}>Verificar novamente</button></section>;

  const alerts = [
    ...(data?.alerts.lowStock || []).map((item) => ({ key: `stock-${item.productId}`, title: `${item.name}: saldo abaixo do mínimo`, detail: `Saldo registrado ${quantity(item.balance)} ${item.unit}; mínimo configurado ${quantity(item.minimum)} ${item.unit}.`, action: "Conferir estoque", href: "#count-section" })),
    ...projectedShortages,
    ...(data?.alerts.missingRecipes || []).map((item) => ({ key: `recipe-${item.productId}`, title: `${item.name}: ficha técnica ausente`, detail: `O item de cardápio ainda não tem receita versionada para calcular custo e consumo.`, action: "Criar ficha", href: "#recipe-section" })),
    ...marginAlerts,
    ...costAlerts.map((item) => ({ key: `cost-${item.current.id}`, title: `${item.productName}: custo de compra ${item.direction}`, detail: `${money(item.previous.stock_unit_cost)} → ${money(item.current.stock_unit_cost)} por ${item.current.stock_unit}; NF-e ${item.current.invoice_number_snapshot} de ${item.current.supplier_name_snapshot}.`, action: "Revisar custo", href: "#cost-section" })),
    ...expiringLots.map((item, index) => ({ key: `lot-${item.lot}-${index}`, title: `${item.productName}: ${item.expired ? "lote vencido informado no XML" : "validade informada para os próximos 30 dias"}`, detail: `Lote ${item.lot}; validade ${item.expiresAt}. O ERP registrou o dado do XML; confirme o lote físico. Não use lote vencido.`, action: item.expired ? "Conferir lote vencido" : "Conferir validade", href: "#cost-section" })),
  ];

  return <section className={styles.kitchenLive}>
    <header className={styles.kitchenLiveHeader}><div><span className={styles.step}>COZINHA VIVA · ESTOQUE E CUSTOS</span><h2>Análise de consumo</h2><p>Da compra ao prato entregue: acompanhe ingredientes, fichas técnicas, custos, perdas e contagens.</p></div><button className={styles.refresh} disabled={loading || busy} onClick={() => void refresh()}>Atualizar dados</button></header>
    {error ? <div className={styles.alertError} role="alert">{error}</div> : null}
    {message ? <div className={styles.alertSuccess} role="status">{message}</div> : null}

    <nav className={styles.liveNav} aria-label="Seções de estoque e custos">
      <a href="#ingredients-section">Ingredientes</a><a href="#recipe-section">Fichas técnicas</a><a href="#cost-section">Compras e custos</a><a href="#count-section">Contagem</a><a href="#loss-section">Perdas</a><a href="#forecast-section">Estimativa</a><a href="#prep-section">Preparo</a><a href="#margin-section">Contribuição</a>
    </nav>

    <section className={styles.panel} id="summary-section">
      <div className={styles.panelHead}><div><span className={styles.step}>01 · ATENÇÃO DO GERENTE</span><h3>O que merece atenção hoje?</h3><p>Alertas factuais derivados do estoque, dos documentos e das fichas salvas. Nenhuma sugestão altera preço ou cardápio.</p></div></div>
      {alerts.length ? <div className={styles.liveAlerts}>{alerts.map((item) => <article key={item.key}><div><strong>{item.title}</strong><p>{item.detail}</p></div><a href={item.href}>{item.action}</a></article>)}</div> : <div className={styles.empty}>Não há alertas confirmados nos dados consultados.</div>}
    </section>

    <section className={styles.panel} id="ingredients-section">
      <div className={styles.panelHead}><div><span className={styles.step}>INGREDIENTES</span><h3>Estoque de ingredientes</h3><p>Saldo e mínimo cadastrados para produtos que controlam estoque.</p></div><a href="/erp/index.html#products">Gerenciar produtos no ERP →</a></div>
      {stockProducts.length ? <div className={styles.liveTable}>{stockProducts.map((product) => <article key={product.id}><div><strong>{product.name}</strong><small>{product.sku || "Sem SKU"} · custo cadastrado {money(product.cost_price)} por {product.unit} · mínimo {quantity(product.minimum_stock)} {product.unit}</small></div><strong>{quantity(product.balance)} {product.unit}</strong></article>)}</div> : <div className={styles.empty}>Nenhum produto está marcado para controle de estoque. Configure produtos no catálogo do ERP.</div>}
    </section>

    <div className={styles.twoCol}>
      <section className={styles.panel} id="recipe-section">
        <div className={styles.panelHead}><div><span className={styles.step}>02 · FICHA TÉCNICA</span><h3>Receita com versões</h3><p>A próxima alteração cria uma nova versão. Pedidos anteriores preservam sua versão e custo.</p></div></div>
        {menuProducts.length ? <>
          <label className={styles.liveSelect}>Prato ou produto do cardápio<select value={effectiveMenuId} onChange={(event) => setMenuProductId(event.target.value)}>{menuProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
          <RecipeEditor key={effectiveMenuId} productId={effectiveMenuId} productName={menuProducts.find((product) => product.id === effectiveMenuId)?.name || ""} recipe={currentRecipe} ingredients={stockProducts} busy={busy} onSave={(body) => void act("save-recipe", body)} />
          {currentRecipe ? <details className={styles.liveHistory}><summary>Versões anteriores</summary><ul>{data?.recipes.filter((recipe) => recipe.menu_product_id === effectiveMenuId).sort((a, b) => b.version_no - a.version_no).map((recipe) => <li key={recipe.id}>v{recipe.version_no} · {quantity(recipe.yield_quantity)} {recipe.yield_unit} · {dateTime(recipe.created_at)}{recipe.is_current ? " · atual" : ""}</li>)}</ul></details> : null}
        </> : <div className={styles.empty}>Cadastre produtos com preço de venda para configurar as fichas do cardápio.</div>}
      </section>

      <section className={styles.panel} id="cost-section">
        <div className={styles.panelHead}><div><span className={styles.step}>03 · COMPRA E CUSTO</span><h3>Custos vindos da NF-e</h3><p>Somente notas recebidas no estoque. Confirme o custo antes de atualizar o cadastro do produto.</p></div></div>
        <div className={styles.infoBox}>O custo usa o valor unitário do item no XML e a conversão confirmada no recebimento. Frete, descontos e despesas não são rateados. A conversão não regrava vendas antigas.</div>
        {data?.inboundDocs.flatMap((doc) => doc.items.filter((item) => item.trackStock && item.productId).map((item) => {
          const applied = data.costHistory.some((entry) => entry.inbound_nfe_id === doc.id && entry.inbound_nfe_item_number === item.lineNumber);
          const product = products.find((row) => row.id === item.productId);
          const unitCost = item.conversionToStockUnit ? item.unitPrice / item.conversionToStockUnit : null;
          return <article className={styles.costCandidate} key={`${doc.id}-${item.lineNumber}`}><div><strong>NF-e {doc.invoiceNumber} · item {item.lineNumber}</strong><p>{item.description} · {doc.supplierName} · {doc.issuedAt ? dateTime(doc.issuedAt) : "data não informada"}</p><small>{quantity(item.quantity)} {item.unit} a {money(item.unitPrice)} por unidade XML{item.conversionToStockUnit ? ` · conversão 1 ${item.unit} = ${quantity(item.conversionToStockUnit)} ${product?.unit || "estoque"}` : " · conversão pendente"}</small>{!item.conversionToStockUnit ? <a href="/erp/inbound-nfe.html">Conferir unidade na nota de entrada</a> : null}</div><div><strong>{unitCost === null ? "Custo pendente" : `${money(unitCost)} / ${product?.unit || "un."}`}</strong><button className={applied ? styles.buttonGhost : styles.primaryButton} disabled={busy || applied || unitCost === null} onClick={() => void applyCost(doc, item)}>{applied ? "Já registrado" : "Confirmar custo desta compra"}</button></div></article>;
        })) || <div className={styles.empty}>Nenhum item recebido e vinculado ao estoque está disponível para confirmar custo.</div>}
        {data?.costHistory.length ? <details className={styles.liveHistory}><summary>Histórico de custo ({data.costHistory.length})</summary><ul>{data.costHistory.slice(0, 50).map((entry) => <li key={entry.id}>{products.find((product) => product.id === entry.ingredient_product_id)?.name || "Ingrediente"} · {money(entry.stock_unit_cost)} / {entry.stock_unit} · fornecedor {entry.supplier_name_snapshot} · NF-e {entry.invoice_number_snapshot} · {dateTime(entry.created_at)}{entry.lot_snapshot.length ? ` · ${entry.lot_snapshot.length} lote(s) no XML` : ""}</li>)}</ul></details> : null}
      </section>
    </div>

    <div className={styles.twoCol}>
      <section className={styles.panel} id="count-section">
        <div className={styles.panelHead}><div><span className={styles.step}>04 · ESTOQUE</span><h3>Contagem física e fechamento</h3><p>O esperado usa movimentos registrados até o horário de cada contagem. Diferenças pedem classificação manual.</p></div></div>
        {data?.countSession?.status === "open" ? <CountEditor session={data.countSession} items={data.countItems} busy={busy} onSave={(body) => void act("save-count-item", body, "PATCH")} onClose={() => { if (window.confirm("Encerrar contagem? Diferenças classificadas serão registradas como movimentos de estoque.")) void act("close-count", { sessionId: data.countSession?.id }, "PATCH"); }} /> : <form className={styles.liveFormRow} onSubmit={(event) => { event.preventDefault(); void act("open-count", { label: countLabel }); }}><label>Turno ou identificação da contagem<input value={countLabel} onChange={(event) => setCountLabel(event.target.value)} minLength={2} maxLength={80} placeholder="Ex.: Fechamento noite 19/11" required/></label><button className={styles.primaryButton} disabled={busy || !stockProducts.length}>Iniciar contagem</button></form>}
        {data?.recentSessions.filter((session) => session.status === "closed").length ? <details className={styles.liveHistory}><summary>Fechamentos recentes</summary><ul>{data.recentSessions.filter((session) => session.status === "closed").map((session) => <li key={session.id}>{session.label} · {dateTime(session.closed_at || session.opened_at)}</li>)}</ul></details> : null}
      </section>

      <section className={styles.panel} id="loss-section">
        <div className={styles.panelHead}><div><span className={styles.step}>05 · PERDAS</span><h3>Registrar perda de ingrediente</h3><p>O movimento reduz o saldo e aparece na próxima contagem. O motivo é informado pela equipe.</p></div></div>
        <form className={styles.liveStack} onSubmit={(event) => { event.preventDefault(); void act("record-loss", { productId: lossProductId, quantity: Number(lossQuantity), reason: lossReason }).then((ok) => { if (ok) { setLossQuantity(""); setLossReason(""); } }); }}>
          <label>Ingrediente<select value={lossProductId} onChange={(event) => setLossProductId(event.target.value)} required><option value="">Selecione...</option>{stockProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · saldo {quantity(product.balance)} {product.unit}</option>)}</select></label>
          <div className={styles.liveFormRow}><label>Quantidade<input type="number" min="0.0001" step="0.0001" value={lossQuantity} onChange={(event) => setLossQuantity(event.target.value)} required/></label><label>Motivo informado<input value={lossReason} onChange={(event) => setLossReason(event.target.value)} minLength={3} maxLength={120} placeholder="Ex.: embalagem danificada" required/></label></div>
          <button className={styles.buttonDanger} disabled={busy || !stockProducts.length}>Registrar perda</button>
        </form>
      </section>
    </div>

    <section className={styles.panel} id="forecast-section">
      <div className={styles.panelHead}><div><span className={styles.step}>06 · PRÓXIMO PERÍODO</span><h3>Estimativa baseada em vendas do restaurante</h3><p>Calculada pela média de pedidos entregues no mesmo dia da semana, nas últimas oito ocorrências observadas. Não é uma ordem de preparo.</p></div></div>
      <label className={styles.liveDate}>Data planejada<input type="date" value={forecastDate} onChange={(event) => setForecastDate(event.target.value)}/></label>
      {!data?.salesWindowComplete ? <div className={styles.infoBox}>O limite de consulta foi atingido. A amostra está incompleta; não exibimos previsão para não induzir uma decisão com dados parciais.</div> : null}
      <div className={styles.forecastList}>{forecasts.map((row) => <article key={row.product.id}><div><strong>{row.product.name}</strong><p>{row.suggested === null ? "Ainda não há dados suficientes de dias comparáveis." : `Sugestão: preparar até ${quantity(row.suggested, 0)} porção(ões), média de ${quantity(row.samples.reduce((sum, sample) => sum + sample.sold, 0) / row.samples.length)} porção(ões).`}</p><small>Confiança: {row.confidence} · {row.samples.length} dia(s) com vendas observadas{row.samples.length ? ` · fontes ${row.samples.map((sample) => `${sample.date}: ${quantity(sample.sold, 0)}`).join(", ")}` : ""}</small></div></article>)}{!forecasts.length ? <div className={styles.empty}>Nenhum item de cardápio cadastrado.</div> : null}</div>
    </section>

    <div className={styles.twoCol}>
      <section className={styles.panel} id="prep-section">
        <div className={styles.panelHead}><div><span className={styles.step}>07 · REGISTRO DE PREPARO</span><h3>Preparado, vendido e sobra</h3><p>Registre o que foi produzido; vendas vêm dos pedidos entregues dentro do intervalo informado.</p></div></div>
        <form className={styles.liveStack} onSubmit={(event) => { event.preventDefault(); void act("record-prep", { menuProductId: prepProductId, shiftName: prepShift, startsAt: new Date(prepStart).toISOString(), endsAt: new Date(prepEnd).toISOString(), preparedQuantity: Number(prepQuantity), remainingQuantity: Number(prepLeftover), notes: prepNotes }).then((ok) => { if (ok) { setPrepQuantity(""); setPrepLeftover("0"); setPrepNotes(""); } }); }}>
          <label>Prato<select value={prepProductId || effectiveMenuId} onChange={(event) => setPrepProductId(event.target.value)} required><option value="">Selecione...</option>{recipeCostRows.map(({ product, recipe }) => product && <option key={recipe.id} value={product.id}>{product.name} · ficha v{recipe.version_no}</option>)}</select></label>
          <div className={styles.liveFormRow}><label>Nome do turno<input value={prepShift} onChange={(event) => setPrepShift(event.target.value)} minLength={2} maxLength={60} placeholder="Ex.: Almoço" required/></label><label>Quantidade preparada<input type="number" min="0.0001" step="0.0001" value={prepQuantity} onChange={(event) => setPrepQuantity(event.target.value)} required/></label></div>
          <div className={styles.liveFormRow}><label>Início do período<input type="datetime-local" value={prepStart} onChange={(event) => setPrepStart(event.target.value)} required/></label><label>Fim do período<input type="datetime-local" value={prepEnd} onChange={(event) => setPrepEnd(event.target.value)} required/></label></div>
          <div className={styles.liveFormRow}><label>Sobra registrada<input type="number" min="0" step="0.0001" value={prepLeftover} onChange={(event) => setPrepLeftover(event.target.value)} required/></label><label>Observação opcional<input value={prepNotes} onChange={(event) => setPrepNotes(event.target.value)} maxLength={300}/></label></div>
          <p className={styles.note}>Esse registro é operacional e não cria outra baixa de ingredientes; o consumo de receita ocorre uma vez na entrega do pedido.</p>
          <button className={styles.primaryButton} disabled={busy || !recipeCostRows.length}>Salvar preparação</button>
        </form>
        <div className={styles.prepHistory}>{data?.prepRuns.slice(0, 20).map((run) => <article key={run.id}><strong>{run.menuProduct?.name || "Prato"} · {run.shift_name}</strong><p>{dateTime(run.starts_at)}–{dateTime(run.ends_at)} · preparado {quantity(run.prepared_quantity)} · vendas entregues {quantity(run.sold_quantity)} · sobra registrada {quantity(run.remaining_quantity)}</p><small>{run.unaccounted_quantity === 0 ? "Preparo, vendas e sobra conferem." : `Diferença a revisar: ${quantity(run.unaccounted_quantity)} ${run.menuProduct?.unit || "un."}; o sistema não atribui causa.`}</small></article>)}</div>
      </section>

      <section className={styles.panel} id="margin-section">
        <div className={styles.panelHead}><div><span className={styles.step}>08 · CUSTO E CONTRIBUIÇÃO</span><h3>Margem estimada por prato e canal</h3><p>Por prato usa o custo cadastrado atual; por canal, o custo congelado em cada pedido. Não inclui tributos, embalagem, taxas, descontos ou outros custos que não estejam configurados.</p></div></div>
        <div className={styles.liveTable}>{recipeCostRows.map(({ recipe, product, costsKnown, costPerPortion, margin }) => <article key={recipe.id}><div><strong>{product?.name || "Prato"} · v{recipe.version_no}</strong><small>Preço cadastrado: {money(product?.sale_price || 0)} · custo cadastrado atual por porção: {costsKnown ? money(costPerPortion || 0) : "indisponível: custo de ingrediente não confirmado"}</small></div><strong>{margin === null ? "Contribuição pendente" : `Contribuição estimada ${money(margin)}`}</strong></article>)}{!recipeCostRows.length ? <div className={styles.empty}>Salve uma ficha técnica e confirme o custo dos ingredientes para calcular a contribuição.</div> : null}</div>
        <h4 className={styles.liveSubhead}>Vendas entregues por canal · últimos 90 dias</h4>
        <div className={styles.liveTable}>{channelSummary.map((channel) => <article key={channel.source}><div><strong>{channel.source}</strong><small>Receita registrada: {money(channel.revenue)} · itens com custo cadastrado congelado no pedido {channel.known}/{channel.total}</small></div><strong>{channel.known === channel.total && channel.total ? `Contribuição estimada ${money(channel.revenue - channel.estimatedCost)}` : "Custo histórico incompleto"}</strong></article>)}{!channelSummary.length ? <div className={styles.empty}>Ainda não há pedidos entregues no período consultado.</div> : null}</div>
      </section>
    </div>
  </section>;
}

function RecipeEditor({ productId, productName, recipe, ingredients, busy, onSave }: { productId: string; productName: string; recipe: Recipe | null; ingredients: Product[]; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [yieldQuantity, setYieldQuantity] = useState(String(recipe?.yield_quantity || 1));
  const [yieldUnit, setYieldUnit] = useState(recipe?.yield_unit || "porção");
  const [minimumMarginPercent, setMinimumMarginPercent] = useState(recipe?.minimum_margin_percent == null ? "" : String(recipe.minimum_margin_percent));
  const [notes, setNotes] = useState(recipe?.notes || "");
  const [lines, setLines] = useState<RecipeLine[]>(recipe?.items.map((item) => ({ ingredientProductId: item.ingredient_product_id, quantityPerYield: String(item.quantity_per_yield), unit: item.unit, conversionToStockUnit: String(item.conversion_to_stock_unit) })) || [{ ingredientProductId: "", quantityPerYield: "", unit: "", conversionToStockUnit: "" }]);
  const currentUnits = (id: string) => ingredients.find((ingredient) => ingredient.id === id)?.unit || "";
  function updateLine(index: number, patch: Partial<RecipeLine>) { setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)); }
  return <form className={styles.liveStack} onSubmit={(event) => { event.preventDefault(); onSave({ menuProductId: productId, yieldQuantity: Number(yieldQuantity), yieldUnit, minimumMarginPercent: minimumMarginPercent === "" ? null : Number(minimumMarginPercent), notes, items: lines.map((line) => ({ ingredientProductId: line.ingredientProductId, quantityPerYield: Number(line.quantityPerYield), unit: line.unit, conversionToStockUnit: Number(line.conversionToStockUnit) })) }); }}>
    <div className={styles.liveFormRow}><label>Rendimento da receita<input type="number" min="0.000001" step="0.0001" value={yieldQuantity} onChange={(event) => setYieldQuantity(event.target.value)} required/></label><label>Unidade do rendimento<input value={yieldUnit} onChange={(event) => setYieldUnit(event.target.value)} maxLength={12} placeholder="porção" required/></label></div>
    <label>Contribuição mínima estimada (%) · opcional<input type="number" min="0" max="100" step="0.01" value={minimumMarginPercent} onChange={(event) => setMinimumMarginPercent(event.target.value)} placeholder="Deixe vazio para não alertar"/><small>Se preenchido, o sistema compara com o preço de venda atual e sinaliza quando o custo cadastrado da receita ficar abaixo do objetivo. Nenhum preço é alterado.</small></label>
    <div className={styles.recipeRows}><div className={styles.liveSectionTitle}><strong>Ingredientes de {productName}</strong><button className={styles.buttonGhost} type="button" onClick={() => setLines((current) => [...current, { ingredientProductId: "", quantityPerYield: "", unit: "", conversionToStockUnit: "" }])}>Adicionar ingrediente</button></div>
      {lines.map((line, index) => <div className={styles.recipeLine} key={`${index}-${line.ingredientProductId}`}><label>Ingrediente<select value={line.ingredientProductId} onChange={(event) => { const id = event.target.value; const unit = currentUnits(id); updateLine(index, { ingredientProductId: id, unit, conversionToStockUnit: unit ? "1" : "" }); }} required><option value="">Selecione ingrediente</option>{ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name} · saldo {quantity(ingredient.balance)} {ingredient.unit}</option>)}</select></label><label>Quantidade para o rendimento<input type="number" min="0.000001" step="0.000001" value={line.quantityPerYield} onChange={(event) => updateLine(index, { quantityPerYield: event.target.value })} required/></label><label>Unidade da receita<input value={line.unit} onChange={(event) => { const unit = event.target.value; updateLine(index, { unit, conversionToStockUnit: unit.trim().toUpperCase() === currentUnits(line.ingredientProductId).trim().toUpperCase() ? "1" : "" }); }} maxLength={12} placeholder="kg, g, L, ml, un." required/></label><label>1 unidade equivale a<input type="number" min="0.00000001" step="0.00000001" value={line.conversionToStockUnit} onChange={(event) => updateLine(index, { conversionToStockUnit: event.target.value })} required/><small>Unidades de estoque ({currentUnits(line.ingredientProductId) || "selecione ingrediente"})</small></label><button className={styles.buttonDanger} type="button" aria-label="Remover ingrediente" disabled={lines.length <= 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remover</button></div>)}
    </div>
    <label>Observação da receita (opcional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500}/></label>
    <p className={styles.note}>O fator converte a quantidade da receita para a unidade de estoque. Ex.: 1 kg = 1.000 g; informe a equivalência confirmada pela equipe.</p>
    <button className={styles.primaryButton} disabled={busy || !ingredients.length}>Salvar como nova versão</button>
    {recipe ? <small className={styles.note}>Versão atual: v{recipe.version_no} · {quantity(recipe.yield_quantity)} {recipe.yield_unit}. Salvar cria uma versão nova sem mudar os pedidos anteriores.</small> : null}
  </form>;
}

function CountEditor({ session, items, busy, onSave, onClose }: { session: CountSession; items: CountItem[]; busy: boolean; onSave: (body: Record<string, unknown>) => void; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, { quantity: string; classification: string; note: string }>>(() => Object.fromEntries(items.map((item) => [item.id, { quantity: item.counted_quantity == null ? "" : String(item.counted_quantity), classification: item.classification || "", note: item.note || "" }])));
  return <div className={styles.liveStack}><div className={styles.infoBox}><strong>{session.label}</strong> · aberta {dateTime(session.opened_at)}. Informe o contado e salve cada ingrediente; a diferença será conferida no horário dessa medição.</div>
    {items.map((item) => { const state = values[item.id] || { quantity: "", classification: "", note: "" }; const expectedAtCount = item.expected_at_count; const differs = item.counted_quantity !== null && expectedAtCount !== null && Number(state.quantity) !== Number(expectedAtCount); return <article className={styles.countRow} key={item.id}><div><strong>{item.product?.name || "Ingrediente"}</strong><small>Esperado ao abrir: {quantity(item.expected_at_open)} {item.product?.unit || "un."}{expectedAtCount !== null ? ` · esperado no horário contado: ${quantity(expectedAtCount)} ${item.product?.unit || "un."}` : ""}{item.counted_at ? ` · contado ${dateTime(item.counted_at)}` : ""}</small></div><label>Contagem física<input type="number" min="0" step="0.0001" value={state.quantity} onChange={(event) => setValues((current) => ({ ...current, [item.id]: { ...state, quantity: event.target.value } }))}/></label><label>Classifique se houver diferença<select value={state.classification} onChange={(event) => setValues((current) => ({ ...current, [item.id]: { ...state, classification: event.target.value } }))}><option value="">Sem classificação</option><option value="loss">Perda</option><option value="overproduction">Preparo acima do padrão</option><option value="count_error">Erro de contagem</option><option value="adjustment">Ajuste</option><option value="other">Outra causa</option></select></label><label>Observação<input value={state.note} onChange={(event) => setValues((current) => ({ ...current, [item.id]: { ...state, note: event.target.value } }))} maxLength={500} placeholder={state.classification === "other" ? "Explique a causa" : "Opcional"}/></label><button className={styles.buttonGhost} disabled={busy || state.quantity === ""} onClick={() => onSave({ sessionId: session.id, itemId: item.id, countedQuantity: Number(state.quantity), classification: state.classification, note: state.note })}>Salvar contagem</button>{differs ? <small className={styles.countHint}>Diferença: {quantity(Number(state.quantity) - Number(expectedAtCount))} {item.product?.unit || "un."}. Cálculo esperado até {dateTime(item.counted_at || session.opened_at)}.</small> : null}</article>; })}
    {!items.length ? <div className={styles.empty}>Nenhum produto ativo com controle de estoque entrou nesta contagem.</div> : null}
    <p className={styles.note}>O sistema não conclui a causa por você. Se uma diferença real exigir classificação, o fechamento informa qual ingrediente revisar.</p>
    <button className={styles.primaryButton} disabled={busy || !items.length || items.some((item) => item.counted_quantity === null && !values[item.id]?.quantity)} onClick={onClose}>Fechar contagem e registrar ajustes</button>
  </div>;
}

