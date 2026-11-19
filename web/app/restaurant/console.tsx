"use client";

import QRCode from "qrcode";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./restaurant.module.css";
import { CozinhaViva } from "./cozinha-viva";
import { RestaurantMenuManager } from "./menu-manager";
import { resolveMenuChoices, type RestaurantMenuOption } from "../../lib/restaurant-menu";

type Product = { id: string; name: string; description?: string | null; sku?: string; category?: string | null; unit: string; sale_price: number; current_price?: number; image_url?: string | null; options?: RestaurantMenuOption[]; is_combo?: boolean; combo_components?: Array<{ productId: string; name: string; quantity: number; unit: string }> };
type Table = { id: string; table_number: number; label: string; qr_token: string; active: boolean; service_status: "open" | "closed" };
type OrderItem = { product_id: string; description: string; quantity: number; unit_price: number; total: number; selectedOptions?: Array<{ name: string; price: number }>; comboSnapshot?: Array<{ name: string; quantity: number; unit: string }>; recipeSnapshot?: { versionNo: number; yieldQuantity: number; yieldUnit: string; ingredients: Array<{ name: string; quantityPerYield: number; unit: string; stockUnit: string }> } | null };
type Order = { id: string; order_number: number; table_id: string | null; customer_id: string | null; source: string; status: string; items: OrderItem[]; customer_name_snapshot: string; phone_snapshot: string; total: number; notes: string; created_at: string; payment_method?: string; payment_status?: "pending" | "paid" | "unknown"; payment_confirmed_at?: string | null; fulfillment_type?: "table" | "pickup" | null };
type Settings = { qr_orders_enabled: boolean; loyalty_enabled: boolean; loyalty_points_per_real: number };
type TableRequest = { id: string; table_id: string; request_type: "call_waiter" | "request_bill"; status: string; created_at: string };
type Data = { settings: Settings; tables: Table[]; products: Product[]; orders: Order[]; tableRequests: TableRequest[]; tableRequestsAvailable: boolean };
type Customer = { id: string; full_name: string; phone: string; cpf: string | null; loyalty_points: number };
type HistoryOrder = Order & { created_at: string };
export type RestaurantArea = "overview" | "orders" | "tables" | "kitchen" | "menu" | "stock" | "customers" | "reports" | "settings";

const initial: Data = { settings: { qr_orders_enabled: false, loyalty_enabled: false, loyalty_points_per_real: 1 }, tables: [], products: [], orders: [], tableRequests: [], tableRequestsAvailable: false };
const areas: Array<{ id: RestaurantArea; label: string; title: string; description: string; href: string; icon: string }> = [
  { id: "overview", label: "Visão geral", title: "Visão geral", description: "Acompanhe o movimento e acesse rapidamente as tarefas do restaurante.", href: "/restaurant", icon: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z" },
  { id: "orders", label: "Pedidos", title: "Pedidos", description: "Registre pedidos e acompanhe os pedidos recentes de todos os canais.", href: "/restaurant/pedidos", icon: "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5" },
  { id: "tables", label: "Salão e mesas", title: "Salão e mesas", description: "Abra mesas, acompanhe comandas e gerencie os QR Codes do salão.", href: "/restaurant/salao", icon: "M4 8h16v9H4z M7 17v3 M17 17v3 M7 5h10v3" },
  { id: "kitchen", label: "Cozinha", title: "Cozinha", description: "Veja a fila de preparo e atualize cada pedido durante o atendimento.", href: "/restaurant/cozinha", icon: "M4 14h16 M6 14a6 6 0 0 1 12 0 M8 7V4 M12 6V3 M16 7V4" },
  { id: "menu", label: "Cardápio", title: "Cardápio", description: "Organize produtos, categorias, adicionais e a apresentação do menu público", href: "/restaurant/cardapio", icon: "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h4" },
  { id: "stock", label: "Estoque e custos", title: "Estoque e custos", description: "Cuide dos ingredientes, compras, fichas técnicas, perdas e contagens.", href: "/restaurant/estoque", icon: "M4 7 12 3l8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10" },
  { id: "customers", label: "Clientes", title: "Clientes", description: "Consulte o cadastro, os pedidos anteriores e a fidelidade.", href: "/restaurant/clientes", icon: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M3 20a6 6 0 0 1 12 0 M17 8h4 M19 6v4 M18 15a5 5 0 0 1 3 5" },
  { id: "reports", label: "Relatórios", title: "Relatórios", description: "Consulte o resumo dos pedidos recentes disponível no sistema.", href: "/restaurant/relatorios", icon: "M4 19V5 M4 19h17 M8 16v-4 M13 16V8 M18 16V5" },
  { id: "settings", label: "Configurações", title: "Configurações", description: "Ajuste pedidos por QR e as regras disponíveis de fidelidade.", href: "/restaurant/configuracoes", icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M19 13.5a7.5 7.5 0 0 0 0-3l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L13.7 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5z" },
];
const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const cartKey = (productId: string, optionChoiceIds: string[]) => `${productId}:${[...optionChoiceIds].sort().join(",")}`;
const statuses: Record<string, string> = { open: "Aguardando confirmação", sent_to_kitchen: "Na fila da cozinha", preparing: "Em preparo", ready: "Pronto", delivered: "Entregue", cancelled: "Cancelado" };

export function RestaurantConsole({ section = "overview" }: { section?: RestaurantArea }) {
  const [data, setData] = useState<Data>(initial);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [tableId, setTableId] = useState("");
  const [cart, setCart] = useState<Record<string, { productId: string; quantity: number; optionChoiceIds: string[] }>>({});
  const [optionSelections, setOptionSelections] = useState<Record<string, string[]>>({});
  const [customizingProductId, setCustomizingProductId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [notes, setNotes] = useState("");
  const [tableCount, setTableCount] = useState("10");
  const [firstTable, setFirstTable] = useState("1");
  const [pointsRate, setPointsRate] = useState("1");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [history, setHistory] = useState<HistoryOrder[]>([]);
  const [printId, setPrintId] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderSourceFilter, setOrderSourceFilter] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/restaurant", { cache: "no-store" });
    const payload = await response.json() as Data & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Não foi possível abrir o atendimento.");
    setData(payload);
    setError("");
    setLoaded(true);
    setPointsRate(String(payload.settings.loyalty_points_per_real || 1));
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/restaurant", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as Data & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Não foi possível abrir o atendimento.");
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setError("");
        setLoaded(true);
        setPointsRate(String(payload.settings.loyalty_points_per_real || 1));
      })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);

  async function send(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; order?: { order_number: number; id: string }; tables?: Table[]; createdCount?: number; skippedCount?: number };
      if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a ação.");
      if ((payload as { payment_status?: string }).payment_status === "paid") setMessage("Pagamento confirmado manualmente no caixa e registrado com usuário e horário.");
      else if ((payload as { alreadyPaid?: boolean }).alreadyPaid) setMessage("Este pedido já está marcado como pago no caixa.");
      else if ((payload as { status?: string }).status === "attended") setMessage("Solicitação marcada como atendida.");
      else if ((payload as { status?: string }).status === "cancelled") setMessage("Solicitação encerrada.");
      else if (payload.order?.order_number) setMessage(`Pedido #${payload.order.order_number} registrado.`);
      else if (typeof payload.createdCount === "number") setMessage(payload.createdCount ? `${payload.createdCount} mesa(s) criada(s).${payload.skippedCount ? ` ${payload.skippedCount} já existia(m) e foi(ram) mantida(s).` : ""}` : "Essas mesas já estavam cadastradas; nada foi duplicado.");
      else setMessage("Alteração salva.");
      try { await refresh(); }
      catch (reason) { setError(`A ação foi salva, mas a tela não conseguiu atualizar os dados: ${reason instanceof Error ? reason.message : "erro de leitura"}`); }
      return payload;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível concluir a ação.");
      return null;
    } finally { setBusy(false); }
  }

  function addProductToCart(product: Product, optionChoiceIds = optionSelections[product.id] || []) {
    const resolved = resolveMenuChoices(product.options || [], optionChoiceIds);
    if (!resolved.valid) { setError(resolved.error); return; }
    const key = `${product.id}:${[...optionChoiceIds].sort().join(",")}`;
    setCart((current) => ({ ...current, [key]: { productId: product.id, quantity: (current[key]?.quantity || 0) + 1, optionChoiceIds: [...optionChoiceIds] } }));
    setError(""); setCustomizingProductId("");
  }

  function toggleProductOption(product: Product, group: RestaurantMenuOption, choiceId: string) {
    setOptionSelections((current) => {
      const previous = current[product.id] || [];
      const groupIds = new Set(group.choices.map((choice) => choice.id));
      const inGroup = previous.filter((id) => groupIds.has(id));
      const elsewhere = previous.filter((id) => !groupIds.has(id));
      let next = inGroup.includes(choiceId) ? inGroup.filter((id) => id !== choiceId) : [...inGroup, choiceId];
      if (next.length > group.max) next = next.slice(1);
      return { ...current, [product.id]: [...elsewhere, ...next] };
    });
  }

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return data.products.filter((product) => !term || `${product.name} ${product.category || ""} ${product.sku || ""}`.toLocaleLowerCase("pt-BR").includes(term));
  }, [data.products, query]);
  const cartItems = Object.values(cart).filter((item) => item.quantity > 0);
  const cartTotal = cartItems.reduce((total, item) => {
    const product = data.products.find((row) => row.id === item.productId);
    const extras = product ? resolveMenuChoices(product.options || [], item.optionChoiceIds).extraPrice : 0;
    return total + ((product?.current_price ?? product?.sale_price ?? 0) + extras) * item.quantity;
  }, 0);
  const openOrders = data.orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const tableById = new Map(data.tables.map((table) => [table.id, table]));
  const activeArea = areas.find((item) => item.id === section) || areas[0];
  const attentionOrders = [...openOrders].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(0, 4);
  const filteredOrders = data.orders.filter((order) => {
    const matchesStatus = orderStatusFilter === "all" || order.status === orderStatusFilter;
    const matchesSource = orderSourceFilter === "all" || order.source === orderSourceFilter;
    const term = orderQuery.trim().toLocaleLowerCase("pt-BR");
    const matchesQuery = !term || String(order.order_number).includes(term) || (order.customer_name_snapshot || "").toLocaleLowerCase("pt-BR").includes(term) || (order.phone_snapshot || "").includes(term);
    return matchesStatus && matchesSource && matchesQuery;
  });
  const deliveredOrders = data.orders.filter((order) => order.status === "delivered");
  const deliveredRevenue = deliveredOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const averageTicket = deliveredOrders.length ? deliveredRevenue / deliveredOrders.length : 0;
  const sourceRows = [...new Set(data.orders.map((order) => order.source))].map((source) => ({
    source,
    label: source === "website" ? "Site público" : source === "qr" ? "Pedido por QR" : source === "table" ? "Salão" : "Balcão",
    count: data.orders.filter((order) => order.source === source).length,
    delivered: data.orders.filter((order) => order.source === source && order.status === "delivered").length,
  }));

  async function createOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cartItems.length) { setError("Adicione pelo menos um produto ao pedido."); return; }
    const result = await send("/api/restaurant", "POST", { kind: "order", tableId: tableId || null, customerName, phone, cpf, notes, items: cartItems, requestKey: crypto.randomUUID() });
    if (result) { setCart({}); setCustomerName(""); setPhone(""); setCpf(""); setNotes(""); }
  }

  async function createTables(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await send("/api/restaurant", "POST", { kind: "tables", count: Number(tableCount), firstNumber: Number(firstTable) });
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await send("/api/restaurant", "POST", { kind: "settings", qrOrdersEnabled: form.get("qrOrdersEnabled") === "on", loyaltyEnabled: form.get("loyaltyEnabled") === "on", loyaltyPointsPerReal: Number(pointsRate) });
  }

  async function findCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    try {
      const result = await fetch(`/api/restaurant?phone=${encodeURIComponent(phoneSearch)}`, { cache: "no-store" });
      const payload = await result.json() as { customer: Customer | null; history: HistoryOrder[]; error?: string };
      if (!result.ok) throw new Error(payload.error || "Não foi possível consultar o histórico.");
      setCustomer(payload.customer); setHistory(payload.history);
      if (!payload.customer) setMessage("Nenhum cadastro encontrado com esse telefone.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível consultar o histórico.");
    }
  }

  async function confirmCashPayment(order: Order) {
    const confirmed = window.confirm(`Confirma que recebeu ${currency(order.total)} do pedido #${order.order_number} no caixa? Isso registra o pagamento manualmente; não consulta banco ou provedor de pagamento.`);
    if (!confirmed) return;
    await send("/api/restaurant", "PATCH", { kind: "order-payment", id: order.id });
  }

  function printOrder(order: Order) {
    setPrintId(order.id);
    window.setTimeout(() => { window.print(); setPrintId(""); }, 100);
  }

  return <main className={styles.page}>
    <div className={styles.restaurantShell}>
      <aside className={styles.sidebar} aria-label="Área do restaurante">
        <Link className={styles.brand} href="/restaurant"><Image className={styles.brandLogo} src="/branding/sigmafiscal-icon.svg" width={42} height={42} alt="" priority/><span><strong>SigmaFiscal</strong><small>Restaurante</small></span></Link>
        <nav className={styles.sideLinks} aria-label="Navegação do restaurante">
          {areas.map((item) => <Link key={item.id} href={item.href} className={section === item.id ? styles.sideLinkActive : styles.sideLink} aria-current={section === item.id ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon}/></svg><span>{item.label}</span>
          </Link>)}
        </nav>
        <a className={styles.backLink} href="/erp/index.html">← Voltar ao ERP</a>
      </aside>

      <div className={styles.restaurantContent}>
        <details className={styles.mobileNav}>
          <summary><Image className={styles.brandLogo} src="/branding/sigmafiscal-icon.svg" width={38} height={38} alt=""/><span><small>RESTAURANTE</small><strong>{activeArea.label}</strong></span><span className={styles.mobileNavChevron} aria-hidden="true">⌄</span></summary>
          <nav aria-label="Navegação do restaurante para celular">{areas.map((item) => <Link key={item.id} href={item.href} aria-current={section === item.id ? "page" : undefined}>{item.label}</Link>)}<a href="/erp/index.html">Voltar ao ERP</a></nav>
        </details>

        <header className={styles.workspaceHeader}>
          <div><span className={styles.eyebrow}>OPERAÇÃO · RESTAURANTE</span><h1>{activeArea.title}</h1><p>{activeArea.description}</p></div>
          <div className={styles.headerActions}>
            {section !== "orders" ? <Link className={styles.primaryButton} href="/restaurant/pedidos#novo-pedido">Novo pedido</Link> : null}
            <button className={styles.refresh} onClick={() => void refresh().catch((reason: Error) => setError(reason.message))}>Atualizar dados</button>
          </div>
        </header>

        {loaded && error ? <div className={styles.alertError} role="alert">{error}</div> : null}
        {loaded && message ? <div className={styles.alertSuccess} role="status">{message}</div> : null}

        {!loaded ? <section className={styles.loadPanel} role={error ? "alert" : "status"}>
          <span className={styles.loadIcon} aria-hidden="true">{error ? "!" : "…"}</span>
          <div><strong>{error ? "Não foi possível carregar os dados" : "Carregando a operação"}</strong><p>{error || "Buscando pedidos, mesas e produtos desta empresa."}</p></div>
          {error ? <button className={styles.primaryButton} onClick={() => void refresh().catch((reason: Error) => setError(reason.message))}>Tentar novamente</button> : null}
        </section> : <>
          {section === "overview" ? <>
            <section className={styles.welcomePanel}>
              <div><span className={styles.welcomeEyebrow}>MOVIMENTO RECENTE</span><h2>Seu restaurante, em movimento.</h2><p>Veja o que precisa de atenção e abra a área certa para continuar o atendimento.</p></div>
              <Link className={styles.welcomeAction} href="/restaurant/pedidos#novo-pedido">+ <span>Novo pedido</span></Link>
            </section>
            <section className={styles.metricGrid} aria-label="Resumo da operação recente">
              <MetricCard label="Pedidos em aberto" value={String(openOrders.length)} hint="Aguardando ou em andamento" tone="blue"/>
              <MetricCard label="Na cozinha" value={String(data.orders.filter((order) => ["sent_to_kitchen", "preparing"].includes(order.status)).length)} hint="Fila e preparo" tone="orange"/>
              <MetricCard label="Mesas abertas" value={String(data.tables.filter((table) => table.active && table.service_status === "open").length)} hint={`${data.tables.filter((table) => table.active).length} mesas ativas`} tone="green"/>
              <MetricCard label="Pedidos por QR" value={data.settings.qr_orders_enabled ? "Ativo" : "Desativado"} hint="Gerenciado nas configurações" tone="purple"/>
            </section>
            <div className={styles.overviewGrid}>
              <section className={styles.sectionPanel}>
                <div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>ATALHOS</span><h2>O que você precisa fazer?</h2></div></div>
                <div className={styles.shortcutGrid}>
                  <Link href="/restaurant/pedidos#novo-pedido"><span className={styles.shortcutIcon}>＋</span><span><strong>Novo pedido</strong><small>Lançar no balcão ou salão</small></span><b>›</b></Link>
                  <Link href="/restaurant/salao#mesas"><span className={styles.shortcutIcon}>▦</span><span><strong>Abrir uma mesa</strong><small>Comanda, atendimento e QR</small></span><b>›</b></Link>
                  <Link href="/restaurant/cozinha"><span className={styles.shortcutIcon}>⌁</span><span><strong>Ver cozinha</strong><small>Acompanhar o preparo</small></span><b>›</b></Link>
                  <Link href="/restaurant/cardapio"><span className={styles.shortcutIcon}>☷</span><span><strong>Editar cardápio</strong><small>Produtos e preços cadastrados</small></span><b>›</b></Link>
                </div>
              </section>
              <section className={styles.sectionPanel}>
                <div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>PRECISAM DE ATENÇÃO</span><h2>Pedidos em andamento</h2></div><Link href="/restaurant/pedidos">Ver pedidos</Link></div>
                {attentionOrders.length ? <OrderList orders={attentionOrders} tableById={tableById} busy={busy} printId={printId} onStatus={(order, status) => void send("/api/restaurant", "PATCH", { kind: "order", id: order.id, status })} onPayment={confirmCashPayment} onPrint={printOrder}/> : <div className={styles.emptyState}><span>✓</span><strong>Nenhum pedido pendente agora</strong><p>Quando houver pedidos aguardando ou em preparo, eles aparecerão aqui.</p></div>}
              </section>
            </div>
            <p className={styles.dataScope}>Resumo atualizado com pedidos dos últimos 3 dias (até 200 registros), conforme os dados disponíveis no atendimento.</p>
          </> : null}

          {section === "orders" ? <div className={styles.ordersLayout}>
            <section className={`${styles.sectionPanel} ${styles.orderComposer}`} id="novo-pedido">
              <div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>LANÇAMENTO</span><h2>Novo pedido</h2><p>Escolha o local, adicione os produtos e confirme para enviar à equipe.</p></div></div>
              <form onSubmit={(event) => void createOrder(event)}>
                <div className={styles.formRow}><label>Mesa ou local<select value={tableId} onChange={(event) => setTableId(event.target.value)}><option value="">Balcão / retirada</option>{data.tables.filter((table) => table.active && table.service_status === "open").map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}</select></label><label>Buscar produto<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou categoria"/></label></div>
                <div className={styles.productGrid}>
  {filteredProducts.map((product) => <article className={styles.productCard} key={product.id}>
    {product.image_url ? <Image src={product.image_url} alt="" width={64} height={64} unoptimized/> : null}
    <div><strong>{product.name}</strong><small>{product.category || "Sem categoria"} / {product.unit}</small>{product.is_combo && product.combo_components?.length ? <small>Combo: {product.combo_components.map((component) => component.name).join(", ")}</small> : null}<b>{currency(product.current_price ?? product.sale_price)}</b></div>
    <button type="button" aria-label={"Adicionar " + product.name} onClick={() => product.options?.length ? setCustomizingProductId(product.id) : addProductToCart(product)}>{product.options?.length ? "Personalizar" : "+"}</button>
    {customizingProductId === product.id && product.options?.length ? <div className={styles.productOptionEditor}>
      {product.options.map((group) => <fieldset key={group.id}><legend>{group.name} / {group.min}-{group.max}</legend>{group.choices.map((choice) => <label key={choice.id}><input type={group.max === 1 ? "radio" : "checkbox"} name={product.id + "-" + group.id} checked={(optionSelections[product.id] || []).includes(choice.id)} onChange={() => toggleProductOption(product, group, choice.id)}/><span>{choice.name}</span>{choice.price ? <b>+ {currency(choice.price)}</b> : null}</label>)}</fieldset>)}
      <div><button type="button" className={styles.buttonGhost} onClick={() => setCustomizingProductId("")}>Voltar</button><button type="button" className={styles.primaryButton} onClick={() => addProductToCart(product)}>{"Adicionar / " + currency((product.current_price ?? product.sale_price) + resolveMenuChoices(product.options || [], optionSelections[product.id] || []).extraPrice)}</button></div>
    </div> : null}
  </article>)}
  {!filteredProducts.length ? <div className={styles.empty}>Nenhum produto ativo com preco de venda foi encontrado.</div> : null}
</div>{cartItems.length ? <div className={styles.cart}><div className={styles.sectionTitle}><h3>Itens do pedido</h3><span>{cartItems.length} linha(s)</span></div>{cartItems.map((item) => {
  const product = data.products.find((row) => row.id === item.productId)!;
  const key = cartKey(item.productId, item.optionChoiceIds);
  const selected = resolveMenuChoices(product.options || [], item.optionChoiceIds).selected;
  const unitPrice = (product.current_price ?? product.sale_price) + resolveMenuChoices(product.options || [], item.optionChoiceIds).extraPrice;
  return <div className={styles.cartRow} key={key}><span>{product.name}{product.is_combo && product.combo_components?.length ? <small>Combo: {product.combo_components.map((component) => component.name).join(", ")}</small> : null}{selected.length ? <small>{selected.map((option) => option.name).join(", ")}</small> : null}</span><div>
    <button type="button" aria-label={"Diminuir " + product.name} onClick={() => setCart((current) => { const next = { ...current }; const quantity = (next[key]?.quantity || 0) - 1; if (quantity <= 0) delete next[key]; else next[key] = { ...next[key], quantity }; return next; })}>-</button>
    <b>{item.quantity}</b>
    <button type="button" aria-label={"Aumentar " + product.name} onClick={() => setCart((current) => ({ ...current, [key]: { ...current[key], quantity: item.quantity + 1 } }))}>+</button>
    <strong>{currency(unitPrice * item.quantity)}</strong></div></div>; })}<div className={styles.total}><span>Total</span><strong>{currency(cartTotal)}</strong></div></div> : <div className={styles.cartEmpty}>Adicione produtos para montar o pedido.</div>}
                <details className={styles.customerFields}><summary>Identificação do cliente (opcional no pedido interno)</summary><div className={styles.formRow}><label>Nome<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nome do cliente"/></label><label>Telefone<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="DDD + telefone" inputMode="tel"/></label><label>CPF<input value={cpf} onChange={(event) => setCpf(event.target.value)} placeholder="Opcional" inputMode="numeric"/></label></div></details>
                <label className={styles.notesLabel}>Observação para a cozinha<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Ex.: sem cebola, ponto da carne"/></label>
                <button className={styles.primaryButton} disabled={busy || !cartItems.length}>{busy ? "Salvando…" : "Confirmar pedido"}</button>
              </form>
            </section>
            <section className={styles.sectionPanel}>
              <div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>ACOMPANHAMENTO</span><h2>Pedidos recentes</h2><p>Consulte e atualize a situação dos pedidos recebidos.</p></div></div>
              <div className={styles.orderFilters}><label>Buscar<input value={orderQuery} onChange={(event) => setOrderQuery(event.target.value)} placeholder="Número, cliente ou telefone"/></label><label>Situação<select value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)}><option value="all">Todas</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Origem<select value={orderSourceFilter} onChange={(event) => setOrderSourceFilter(event.target.value)}><option value="all">Todas</option><option value="table">Salão</option><option value="qr">QR</option><option value="website">Site público</option><option value="counter">Balcão</option></select></label></div>
              {filteredOrders.length ? <OrderList orders={filteredOrders} tableById={tableById} busy={busy} printId={printId} onStatus={(order, status) => void send("/api/restaurant", "PATCH", { kind: "order", id: order.id, status })} onPayment={confirmCashPayment} onPrint={printOrder}/> : <div className={styles.emptyState}><strong>Nenhum pedido encontrado</strong><p>Altere os filtros ou registre um novo pedido.</p></div>}
              <p className={styles.dataScope}>A API mostra pedidos dos últimos 3 dias, com limite de 200 registros.</p>
            </section>
          </div> : null}

          {section === "tables" ? <div className={styles.areaGrid}>
            <section className={styles.sectionPanel} id="mesas"><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>SALÃO</span><h2>Mapa de mesas</h2><p>Abra uma mesa para começar uma comanda e imprimir o QR individual.</p></div></div>
              <form className={styles.createTables} onSubmit={(event) => void createTables(event)}><label>Primeiro número<input type="number" min="1" max="9999" value={firstTable} onChange={(event) => setFirstTable(event.target.value)} required/></label><label>Quantidade de mesas<input type="number" min="1" max="50" value={tableCount} onChange={(event) => setTableCount(event.target.value)} required/></label><button className={styles.primaryButton} disabled={busy}>Criar mesas</button></form>
              {data.tables.length ? <div className={styles.tableGrid}>{data.tables.map((table) => <TableCard key={table.id} table={table} busy={busy} qrEnabled={data.settings.qr_orders_enabled} onToggle={(active) => void send("/api/restaurant", "PATCH", { kind: "table", id: table.id, active })} onSession={(status) => void send("/api/restaurant", "PATCH", { kind: "table-session", id: table.id, status })}/>)}</div> : <div className={styles.emptyState}><strong>Você ainda não cadastrou mesas</strong><p>Defina o primeiro número e quantas mesas existem no salão.</p></div>}
            </section>
            <section className={styles.sectionPanel}><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>PEDIDO DIGITAL</span><h2>Pedidos pelo QR</h2><p>Os pedidos digitais chegam para confirmação da equipe antes de irem à cozinha.</p></div></div><p className={styles.infoBox}>{data.settings.qr_orders_enabled ? "Pedidos por QR estão ativos para mesas com QR habilitado." : "Os QRs podem ser impressos, mas ainda não aceitam pedidos. Ative o recurso para receber pedidos digitais."}</p><button className={data.settings.qr_orders_enabled ? styles.buttonDanger : styles.primaryButton} disabled={busy} onClick={() => void send("/api/restaurant", "POST", { kind: "settings", qrOrdersEnabled: !data.settings.qr_orders_enabled, loyaltyEnabled: data.settings.loyalty_enabled, loyaltyPointsPerReal: Number(pointsRate) })}>{data.settings.qr_orders_enabled ? "Desativar pedidos por QR" : "Ativar pedidos por QR"}</button></section>
          </div> : null}

          {section === "tables" ? <section className={styles.sectionPanel}><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>PEDIDOS DE ATENDIMENTO</span><h2>Chamados das mesas</h2><p>Pedidos para chamar a equipe e solicitar a conta enviados pelos QR Codes.</p></div><button type="button" className={styles.refresh} onClick={() => void refresh().catch((reason: Error) => setError(reason.message))}>Atualizar fila</button></div>{!data.tableRequestsAvailable ? <div className={styles.infoBox}>A fila de chamados depende da atualização do banco do restaurante; ela ainda não está disponível neste ambiente.</div> : data.tableRequests.length ? <div className={styles.orderList}>{data.tableRequests.map((request) => { const table = tableById.get(request.table_id); return <article className={styles.orderCard} key={request.id}><div className={styles.orderTop}><div><strong>{request.request_type === "call_waiter" ? "Chamar garçom" : "Solicitar conta"}</strong><span>{table?.label || "Mesa"} · {dateTime(request.created_at)}</span></div><span className={styles.status}>Pendente</span></div><div className={styles.orderBottom}><span>Enviado pelo QR da mesa</span><div><button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => void send("/api/restaurant", "PATCH", { kind: "table-request", id: request.id, status: "cancelled" })}>Encerrar</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void send("/api/restaurant", "PATCH", { kind: "table-request", id: request.id, status: "attended" })}>Marcar atendido</button></div></div></article>; })}</div> : <div className={styles.emptyState}><strong>Nenhum chamado pendente</strong><p>As novas solicitações aparecerão aqui.</p></div>}</section> : null}

          {section === "kitchen" ? <section className={styles.sectionPanel}><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>PREPARO</span><h2>Fila da cozinha</h2><p>Pedidos recebidos, em preparo, prontos e entregues. Os pedidos aguardando confirmação ficam em Pedidos.</p></div><Link href="/restaurant/pedidos">Abrir pedidos</Link></div><div className={styles.kitchenGrid}>{[["sent_to_kitchen", "Recebidos"], ["preparing", "Em preparo"], ["ready", "Prontos"], ["delivered", "Entregues"]].map(([status, label]) => { const items = data.orders.filter((order) => order.status === status); return <section className={styles.kitchenColumn} key={status}><h3>{label}<span>{items.length}</span></h3><OrderList orders={items} tableById={tableById} busy={busy} printId={printId} onStatus={(order, next) => void send("/api/restaurant", "PATCH", { kind: "order", id: order.id, status: next })} onPayment={confirmCashPayment} onPrint={printOrder}/></section>; })}</div><p className={styles.dataScope}>Pedidos exibidos: últimos 3 dias, até 200 registros. Use “Imprimir comanda” para selecionar uma impressora instalada no dispositivo.</p></section> : null}

          {section === "menu" ? <RestaurantMenuManager/> : null}
          {section === "stock" ? <section className={styles.sectionPanel}><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>CUSTO, CONSUMO E ESTOQUE</span><h2>Estoque e custos</h2><p>A análise de consumo Cozinha Viva acompanha fichas técnicas, compras, contagens, perdas e preparo.</p></div></div><CozinhaViva/></section> : null}

          {section === "customers" ? <div className={styles.areaGrid}><section className={styles.sectionPanel}><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>RELACIONAMENTO</span><h2>Localizar cliente</h2><p>Pesquise pelo telefone com DDD para ver o cadastro, os pedidos anteriores e os pontos.</p></div></div><form className={styles.searchCustomer} onSubmit={(event) => void findCustomer(event)}><label>Telefone com DDD<input value={phoneSearch} onChange={(event) => setPhoneSearch(event.target.value)} placeholder="Ex.: (18) 99999-9999" inputMode="tel" required/></label><button className={styles.primaryButton} disabled={busy}>Consultar cliente</button></form>{customer ? <div className={styles.customerCard}><div><span>CLIENTE</span><h3>{customer.full_name}</h3><p>{customer.phone}{customer.cpf ? ` · CPF ${customer.cpf}` : ""}</p></div><strong>{data.settings.loyalty_enabled ? `${customer.loyalty_points} pontos` : "Fidelidade desligada"}</strong></div> : <div className={styles.emptyState}><strong>Consulte um cliente pelo telefone</strong><p>O sistema retorna o cadastro encontrado e o histórico associado.</p></div>}</section><section className={styles.sectionPanel}><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>HISTÓRICO</span><h2>Pedidos anteriores</h2></div></div>{customer ? <OrderList orders={history} tableById={tableById} busy={busy} printId={printId} onStatus={() => undefined} onPrint={printOrder} readOnly/> : <div className={styles.empty}>O histórico será exibido após a consulta.</div>}</section></div> : null}

          {section === "reports" ? <>
            <section className={styles.metricGrid} aria-label="Indicadores de pedidos recentes"><MetricCard label="Pedidos no período" value={String(data.orders.length)} hint="Dados recebidos pela API" tone="blue"/><MetricCard label="Entregues" value={String(deliveredOrders.length)} hint="Pedidos concluídos" tone="green"/><MetricCard label="Vendas entregues" value={currency(deliveredRevenue)} hint="Soma dos pedidos entregues" tone="purple"/><MetricCard label="Ticket médio entregue" value={currency(averageTicket)} hint="Somente pedidos entregues" tone="orange"/></section>
            <section className={styles.sectionPanel}><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>RESUMO OPERACIONAL</span><h2>Movimento por origem</h2><p>Os totais são calculados a partir dos pedidos recentes carregados pelo sistema.</p></div></div>{sourceRows.length ? <div className={styles.reportRows}>{sourceRows.map((row) => <article key={row.source}><span>{row.label}</span><strong>{row.count} pedido(s)</strong><small>{row.delivered} entregue(s)</small></article>)}</div> : <div className={styles.emptyState}><strong>Sem pedidos no período</strong><p>Assim que houver movimentação, os dados aparecerão neste resumo.</p></div>}<div className={styles.backendNote}><strong>Escopo deste relatório</strong><p>Esta tela é um resumo operacional dos últimos 3 dias (até 200 pedidos). Não substitui relatório fiscal, financeiro ou histórico completo de vendas.</p></div></section>
          </> : null}

        {section === "settings" ? <div className={styles.areaGrid}><section className={styles.sectionPanel}><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>PREFERÊNCIAS DISPONÍVEIS</span><h2>Atendimento digital e fidelidade</h2><p>Essas opções são salvas para a empresa ativa.</p></div></div><form key={`${data.settings.qr_orders_enabled}-${data.settings.loyalty_enabled}`} className={styles.settingsForm} onSubmit={(event) => void saveSettings(event)}><label className={styles.checkRow}><input name="qrOrdersEnabled" type="checkbox" defaultChecked={data.settings.qr_orders_enabled}/> Aceitar pedidos pelo QR das mesas</label><div className={styles.loyaltyBox}><label className={styles.checkRow}><input name="loyaltyEnabled" type="checkbox" defaultChecked={data.settings.loyalty_enabled}/> Ativar programa de fidelidade</label><label>Pontos por R$ 1,00<input type="number" min="0.01" max="100" step="0.01" value={pointsRate} onChange={(event) => setPointsRate(event.target.value)}/></label><small>Os pontos são adicionados uma única vez quando a equipe marca o pedido como entregue.</small></div><button className={styles.primaryButton} disabled={busy}>Salvar configurações</button></form></section><section className={styles.sectionPanel}><div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>SITE E CARDÁPIO</span><h2>Gerencie sua vitrine pública</h2><p>Produtos, fotos, adicionais, promoções, horários e endereço do site ficam no editor do cardápio.</p></div></div><div className={styles.backendNote}><Link href="/restaurant/cardapio">Abrir gerenciamento do cardápio e site público</Link><p>O site e os pedidos online só ficam públicos quando o módulo está liberado, o cardápio é publicado e as configurações necessárias são salvas.</p></div></section></div> : null}
        </>}
      </div>
    </div>
  </main>;
}

function MetricCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "blue" | "green" | "orange" | "purple" }) {
  return <article className={`${styles.metricCard} ${styles[`metric_${tone}`]}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function OrderList({
  orders, tableById, busy, printId, onStatus, onPrint, onPayment, readOnly = false,
}: {
  orders: Array<Order | HistoryOrder>;
  tableById: Map<string, Table>;
  busy: boolean;
  printId: string;
  onStatus: (order: Order, status: string) => void;
  onPrint: (order: Order) => void;
  onPayment?: (order: Order) => void;
  readOnly?: boolean;
}) {
  if (!orders.length) return <div className={styles.empty}>Nenhum pedido nesta etapa.</div>;
  return <div className={styles.orderList}>{orders.map((order) => {
    const table = order.table_id ? tableById.get(order.table_id) : null;
    const sourceLabel = table?.label || (order.source === "website" ? "Site público" : order.source === "qr" ? "Pedido por QR" : order.source === "table" ? "Salão" : "Balcão");
    const next = order.status === "open" ? ["sent_to_kitchen", "Enviar à cozinha"] : order.status === "sent_to_kitchen" ? ["preparing", "Iniciar preparo"] : order.status === "preparing" ? ["ready", "Marcar pronto"] : order.status === "ready" ? ["delivered", "Entregue"] : null;
    const paymentLabel = order.payment_status === "paid" ? "Pagamento registrado manualmente no caixa" : order.payment_status === "pending" ? "Pagamento pendente no caixa" : "";
    return <article className={styles.orderCard + " " + (printId === order.id ? styles.printTarget : "")} key={order.id}>
      <div className={styles.orderTop}><div><strong>Pedido #{order.order_number}</strong><span>{sourceLabel}</span></div><span className={styles.status + " " + (styles["status_" + order.status] || "")}>{statuses[order.status] || order.status}</span></div>
      <p className={styles.orderCustomer}>{order.customer_name_snapshot || "Cliente não informado"}{order.phone_snapshot ? " · " + order.phone_snapshot : ""} · {dateTime(order.created_at)}</p>
      <ul>{order.items.map((item, index) => <li key={(item.product_id || item.description) + "-" + index}><span>{item.quantity}× {item.description}{item.selectedOptions?.length ? <small>Opções: {item.selectedOptions.map((option) => option.name).join(", ")}</small> : null}{item.comboSnapshot?.length ? <small>Combo: {item.comboSnapshot.map((component) => component.name).join(", ")}</small> : null}{item.recipeSnapshot ? <small>Ficha v{item.recipeSnapshot.versionNo} · {item.recipeSnapshot.ingredients.map((ingredient) => ingredient.name).join(", ")}</small> : null}</span><b>{currency(item.total)}</b></li>)}</ul>
      {order.notes ? <p className={styles.kitchenNote}><b>Observação:</b> {order.notes}</p> : null}
      <div className={styles.orderBottom}><div><strong>{currency(order.total)}</strong>{paymentLabel ? <small>{paymentLabel}{order.payment_confirmed_at ? " · " + dateTime(order.payment_confirmed_at) : ""}</small> : null}</div><div>
        <button type="button" className={styles.buttonGhost} onClick={() => onPrint(order as Order)}>Imprimir comanda</button>
        {!readOnly && next ? <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => onStatus(order as Order, next[0])}>{next[1]}</button> : null}
        {!readOnly && onPayment && order.payment_status === "pending" && order.status !== "cancelled" ? <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => onPayment(order as Order)}>Registrar pagamento no caixa</button> : null}
        {!readOnly && ["open", "sent_to_kitchen", "preparing", "ready"].includes(order.status) ? <button type="button" className={styles.cancelButton} disabled={busy} onClick={() => onStatus(order as Order, "cancelled")}>Cancelar</button> : null}
      </div></div>
    </article>;
  })}</div>;
}
function TableCard({ table, busy, qrEnabled, onToggle, onSession }: { table: Table; busy: boolean; qrEnabled: boolean; onToggle: (active: boolean) => void; onSession: (status: "open" | "closed") => void }) {
  const [qr, setQr] = useState("");
  const [printing, setPrinting] = useState(false);
  const url = `/restaurant/qr/${table.qr_token}`;
  useEffect(() => {
    let active = true;
    const absoluteUrl = new URL(url, window.location.origin).toString();
    QRCode.toDataURL(absoluteUrl, { width: 240, margin: 1, color: { dark: "#12304a", light: "#ffffff" } })
      .then((value) => { if (active) setQr(value); })
      .catch(() => { if (active) setQr(""); });
    return () => { active = false; };
  }, [table.qr_token, url]);
  return <article className={`${styles.tableCard} ${printing ? styles.printTarget : ""}`}><div className={styles.tableCardHead}><div><strong>{table.label}</strong><small>Mesa {table.table_number} · {table.active ? (table.service_status === "open" ? "Aberta" : "Fechada") : "Desativada"}</small></div><button className={styles.buttonGhost} disabled={busy} onClick={() => onToggle(!table.active)}>{table.active ? "Desativar QR" : "Ativar mesa"}</button></div><button className={table.service_status === "open" ? styles.buttonDanger : styles.primaryButton} disabled={busy || !table.active} onClick={() => onSession(table.service_status === "open" ? "closed" : "open")}>{table.service_status === "open" ? "Fechar mesa" : "Abrir mesa"}</button>{qr ? <Image className={styles.qrImage} src={qr} width={150} height={150} unoptimized alt={`QR Code de ${table.label}`}/> : null}<label className={styles.qrUrl}>Link do cardápio<input readOnly value={url}/></label><div className={styles.qrActions}><button className={styles.buttonGhost} onClick={() => void navigator.clipboard.writeText(new URL(url, window.location.origin).toString())}>Copiar link</button><button className={styles.buttonGhost} onClick={() => { setPrinting(true); window.setTimeout(() => { window.print(); setPrinting(false); }, 100); }}>Imprimir QR</button><a className={styles.buttonGhost} href={url} target="_blank" rel="noreferrer">Abrir</a></div>{qrEnabled && table.active ? <small className={styles.qrReady}>QR habilitado · {table.service_status === "open" ? "recebendo pedidos" : "aguardando abertura da mesa"}</small> : null}</article>;
}
