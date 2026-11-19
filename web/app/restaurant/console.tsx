"use client";

import QRCode from "qrcode";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./restaurant.module.css";
import { CozinhaViva } from "./cozinha-viva";

type Product = { id: string; name: string; description?: string | null; sku?: string; category?: string | null; unit: string; sale_price: number };
type Table = { id: string; table_number: number; label: string; qr_token: string; active: boolean; service_status: "open" | "closed" };
type OrderItem = { product_id: string; description: string; quantity: number; unit_price: number; total: number; recipeSnapshot?: { versionNo: number; yieldQuantity: number; yieldUnit: string; ingredients: Array<{ name: string; quantityPerYield: number; unit: string; stockUnit: string }> } | null };
type Order = { id: string; order_number: number; table_id: string | null; customer_id: string | null; source: string; status: string; items: OrderItem[]; customer_name_snapshot: string; phone_snapshot: string; total: number; notes: string; created_at: string };
type Settings = { qr_orders_enabled: boolean; loyalty_enabled: boolean; loyalty_points_per_real: number };
type Data = { settings: Settings; tables: Table[]; products: Product[]; orders: Order[] };
type Customer = { id: string; full_name: string; phone: string; cpf: string | null; loyalty_points: number };
type HistoryOrder = Order & { created_at: string };
type Tab = "service" | "kitchen" | "kitchen-live" | "tables" | "customers" | "settings";

const initial: Data = { settings: { qr_orders_enabled: false, loyalty_enabled: false, loyalty_points_per_real: 1 }, tables: [], products: [], orders: [] };
const tabs: Array<{ id: Tab; label: string }> = [
  { id: "service", label: "Atendimento" }, { id: "kitchen", label: "Cozinha" }, { id: "kitchen-live", label: "Cozinha Viva" },
  { id: "tables", label: "Mesas e QR" }, { id: "customers", label: "Clientes e fidelidade" }, { id: "settings", label: "Configurações" },
];
const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const statuses: Record<string, string> = { open: "Aguardando confirmação", sent_to_kitchen: "Na fila da cozinha", preparing: "Em preparo", ready: "Pronto", delivered: "Entregue", cancelled: "Cancelado" };

export function RestaurantConsole() {
  const [data, setData] = useState<Data>(initial);
  const [tab, setTab] = useState<Tab>("service");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [tableId, setTableId] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
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
      if (payload.order?.order_number) setMessage(`Pedido #${payload.order.order_number} registrado.`);
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

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return data.products.filter((product) => !term || `${product.name} ${product.category || ""} ${product.sku || ""}`.toLocaleLowerCase("pt-BR").includes(term));
  }, [data.products, query]);
  const cartItems = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ productId: id, quantity }));
  const cartTotal = cartItems.reduce((total, item) => total + (data.products.find((product) => product.id === item.productId)?.sale_price || 0) * item.quantity, 0);
  const openOrders = data.orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const tableById = new Map(data.tables.map((table) => [table.id, table]));

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
    const result = await fetch(`/api/restaurant?phone=${encodeURIComponent(phoneSearch)}`, { cache: "no-store" });
    const payload = await result.json() as { customer: Customer | null; history: HistoryOrder[]; error?: string };
    if (!result.ok) { setError(payload.error || "Não foi possível consultar o histórico."); return; }
    setCustomer(payload.customer); setHistory(payload.history);
    if (!payload.customer) setMessage("Nenhum cadastro encontrado com esse telefone.");
  }

  function printOrder(order: Order) {
    setPrintId(order.id);
    window.setTimeout(() => { window.print(); setPrintId(""); }, 100);
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>OPERAÇÃO · RESTAURANTE</span><h1>Atendimento e cozinha</h1><p>Mesas, pedidos por QR e acompanhamento do preparo em um só lugar.</p></div>
      <div className={styles.headerActions}><a className={styles.back} href="/erp/index.html">Voltar ao ERP</a><button className={styles.refresh} onClick={() => void refresh().catch((reason: Error) => setError(reason.message))}>Atualizar pedidos</button></div>
    </header>

    {!loaded ? <section className={styles.panel} role={error ? "alert" : "status"}>
      {error ? <><p>{error}</p><button className={styles.refresh} onClick={() => void refresh().catch((reason: Error) => setError(reason.message))}>Tentar novamente</button></> : <p>Carregando mesas, produtos e pedidos…</p>}
    </section> : <>
    {error ? <div className={styles.alertError} role="alert">{error}</div> : null}
    {message ? <div className={styles.alertSuccess} role="status">{message}</div> : null}

    <section className={styles.metrics}>
      <article><span>Em atendimento</span><strong>{openOrders.length}</strong><small>Pedidos aguardando ou em preparo</small></article>
      <article><span>Na cozinha</span><strong>{data.orders.filter((order) => ["sent_to_kitchen", "preparing"].includes(order.status)).length}</strong><small>Comandas não finalizadas</small></article>
      <article><span>Mesas abertas</span><strong>{data.tables.filter((table) => table.active && table.service_status === "open").length}</strong><small>Mesas abertas para atendimento</small></article>
      <article><span>Pedidos por QR</span><strong>{data.settings.qr_orders_enabled ? "Ativo" : "Desativado"}</strong><small>Controlado nas configurações</small></article>
    </section>

    <nav className={styles.tabs} aria-label="Módulos do restaurante">{tabs.map((item) => <button key={item.id} className={tab === item.id ? styles.tabActive : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>

    {tab === "service" ? <div className={styles.serviceGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><span className={styles.step}>01 · LANÇAMENTO</span><h2>Novo pedido</h2><p>Escolha mesa ou balcão, monte os itens e confirme para enviar à fila.</p></div></div>
        <form onSubmit={(event) => void createOrder(event)}>
          <div className={styles.formRow}><label>Mesa / local<select value={tableId} onChange={(event) => setTableId(event.target.value)}><option value="">Balcão / retirada</option>{data.tables.filter((table) => table.active && table.service_status === "open").map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}</select></label><label>Buscar no cardápio<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou categoria"/></label></div>
          <div className={styles.productGrid}>{filteredProducts.slice(0, 12).map((product) => <article className={styles.productCard} key={product.id}><div><strong>{product.name}</strong><small>{product.category || "Cardápio"} · {product.unit}</small><b>{currency(product.sale_price)}</b></div><button type="button" aria-label={`Adicionar ${product.name}`} onClick={() => setCart((current) => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }))}>+</button></article>)}{!filteredProducts.length ? <div className={styles.empty}>Nenhum produto ativo com preço de venda foi encontrado.</div> : null}</div>
          {cartItems.length ? <div className={styles.cart}><div className={styles.sectionTitle}><h3>Itens do pedido</h3><span>{cartItems.length} produto(s)</span></div>{cartItems.map((item) => { const product = data.products.find((row) => row.id === item.productId)!; return <div className={styles.cartRow} key={item.productId}><span>{product.name}</span><div><button type="button" onClick={() => setCart((current) => ({ ...current, [product.id]: Math.max(0, (current[product.id] || 0) - 1) }))}>−</button><b>{item.quantity}</b><button type="button" onClick={() => setCart((current) => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }))}>+</button><strong>{currency(product.sale_price * item.quantity)}</strong></div></div>; })}<div className={styles.total}><span>Total</span><strong>{currency(cartTotal)}</strong></div></div> : null}
          <details className={styles.customerFields}><summary>Dados do cliente (opcional no atendimento interno)</summary><div className={styles.formRow}><label>Nome<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nome do cliente"/></label><label>Telefone<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="DDD + telefone" inputMode="tel"/></label><label>CPF<input value={cpf} onChange={(event) => setCpf(event.target.value)} placeholder="Opcional" inputMode="numeric"/></label></div></details>
          <label className={styles.notesLabel}>Observação para a cozinha<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Ex.: sem cebola, ponto da carne"/></label>
          <button className={styles.primaryButton} disabled={busy || !cartItems.length}>{busy ? "Salvando…" : "Confirmar pedido"}</button>
        </form>
      </section>
      <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.step}>02 · ACOMPANHAMENTO</span><h2>Pedidos em aberto</h2><p>Confirme o pedido e avance cada etapa até a entrega.</p></div></div><OrderList orders={openOrders.slice(0, 15)} tableById={tableById} busy={busy} printId={printId} onStatus={(order, status) => void send("/api/restaurant", "PATCH", { kind: "order", id: order.id, status })} onPrint={printOrder}/></section>
    </div> : null}

    {tab === "kitchen" ? <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.step}>PRODUÇÃO</span><h2>Fila da cozinha</h2><p>Pedidos em sequência de entrada. Use “Imprimir comanda” para selecionar a impressora instalada.</p></div></div><div className={styles.kitchenGrid}>{["sent_to_kitchen", "preparing", "ready"].map((status) => <section className={styles.kitchenColumn} key={status}><h3>{statuses[status]} <span>{data.orders.filter((order) => order.status === status).length}</span></h3><OrderList orders={data.orders.filter((order) => order.status === status)} tableById={tableById} busy={busy} printId={printId} onStatus={(order, next) => void send("/api/restaurant", "PATCH", { kind: "order", id: order.id, status: next })} onPrint={printOrder}/></section>)}</div></section> : null}

    {tab === "tables" ? <div className={styles.twoCol}><section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.step}>SALÃO</span><h2>Mesas e QR Code</h2><p>Abra a mesa para iniciar o atendimento e imprima um QR exclusivo para ela.</p></div></div><form className={styles.createTables} onSubmit={(event) => void createTables(event)}><label>Primeira mesa<input type="number" min="1" max="9999" value={firstTable} onChange={(event) => setFirstTable(event.target.value)} required/></label><label>Quantidade<input type="number" min="1" max="50" value={tableCount} onChange={(event) => setTableCount(event.target.value)} required/></label><button className={styles.primaryButton} disabled={busy}>Criar mesas</button></form><div className={styles.tableGrid}>{data.tables.map((table) => <TableCard key={table.id} table={table} busy={busy} qrEnabled={data.settings.qr_orders_enabled} onToggle={(active) => void send("/api/restaurant", "PATCH", { kind: "table", id: table.id, active })} onSession={(status) => void send("/api/restaurant", "PATCH", { kind: "table-session", id: table.id, status })}/>)}</div>{!data.tables.length ? <div className={styles.empty}>Cadastre as mesas para abrir pedidos no salão.</div> : null}</section>
      <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.step}>PEDIDO DIGITAL</span><h2>Controle do QR</h2><p>Ative os pedidos digitais depois de conferir seu cardápio e as mesas.</p></div></div><p className={styles.infoBox}>{data.settings.qr_orders_enabled ? "Os clientes podem abrir o cardápio pelo QR e enviar pedidos para confirmação da equipe." : "Os links e QRs das mesas ficam prontos, mas não aceitam pedidos até ativar essa opção."}</p><button className={data.settings.qr_orders_enabled ? styles.buttonDanger : styles.primaryButton} disabled={busy} onClick={() => void send("/api/restaurant", "POST", { kind: "settings", qrOrdersEnabled: !data.settings.qr_orders_enabled, loyaltyEnabled: data.settings.loyalty_enabled, loyaltyPointsPerReal: Number(pointsRate) })}>{data.settings.qr_orders_enabled ? "Desativar pedidos por QR" : "Ativar pedidos por QR"}</button><p className={styles.note}>Pedidos enviados por QR entram como “Aguardando confirmação”. A equipe decide quando enviar à cozinha.</p></section></div> : null}

    {tab === "customers" ? <div className={styles.twoCol}><section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.step}>RELACIONAMENTO</span><h2>Histórico do cliente</h2><p>Pesquise pelo telefone cadastrado para ver pedidos anteriores e pontuação.</p></div></div><form className={styles.searchCustomer} onSubmit={(event) => void findCustomer(event)}><label>Telefone com DDD<input value={phoneSearch} onChange={(event) => setPhoneSearch(event.target.value)} placeholder="Ex.: (18) 99999-9999" inputMode="tel" required/></label><button className={styles.primaryButton}>Consultar histórico</button></form>{customer ? <div className={styles.customerCard}><div><span>CLIENTE</span><h3>{customer.full_name}</h3><p>{customer.phone}{customer.cpf ? ` · CPF ${customer.cpf}` : ""}</p></div><strong>{data.settings.loyalty_enabled ? `${customer.loyalty_points} pontos` : "Fidelidade desligada"}</strong></div> : null}</section><section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.step}>PEDIDOS</span><h2>Compras anteriores</h2></div></div>{customer ? <OrderList orders={history} tableById={tableById} busy={busy} printId={printId} onStatus={() => undefined} onPrint={printOrder} readOnly/> : <div className={styles.empty}>Pesquise um cliente para consultar o histórico.</div>}</section></div> : null}

    {tab === "settings" ? <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.step}>PREFERÊNCIAS</span><h2>Configurações do restaurante</h2><p>Ative somente os recursos que sua equipe vai utilizar.</p></div></div><form key={`${data.settings.qr_orders_enabled}-${data.settings.loyalty_enabled}`} className={styles.settingsForm} onSubmit={(event) => void saveSettings(event)}><label className={styles.checkRow}><input name="qrOrdersEnabled" type="checkbox" defaultChecked={data.settings.qr_orders_enabled}/> Aceitar pedidos pelo QR das mesas</label><div className={styles.loyaltyBox}><label className={styles.checkRow}><input name="loyaltyEnabled" type="checkbox" defaultChecked={data.settings.loyalty_enabled}/> Ativar programa de fidelidade</label><label>Pontos por R$ 1,00<input type="number" min="0.01" max="100" step="0.01" value={pointsRate} onChange={(event) => setPointsRate(event.target.value)}/></label><small>Os pontos são adicionados uma única vez quando a equipe marca o pedido como entregue. A regra é configurável por esta empresa.</small></div><button className={styles.primaryButton} disabled={busy}>Salvar configurações</button></form></section> : null}
    {tab === "kitchen-live" ? <CozinhaViva/> : null}
    </>}
  </main>;
}

function OrderList({ orders, tableById, busy, printId, onStatus, onPrint, readOnly = false }: { orders: Array<Order | HistoryOrder>; tableById: Map<string, Table>; busy: boolean; printId: string; onStatus: (order: Order, status: string) => void; onPrint: (order: Order) => void; readOnly?: boolean }) {
  if (!orders.length) return <div className={styles.empty}>Nenhum pedido nesta etapa.</div>;
  return <div className={styles.orderList}>{orders.map((order) => { const table = order.table_id ? tableById.get(order.table_id) : null; const next = order.status === "open" ? ["sent_to_kitchen", "Enviar à cozinha"] : order.status === "sent_to_kitchen" ? ["preparing", "Iniciar preparo"] : order.status === "preparing" ? ["ready", "Marcar pronto"] : order.status === "ready" ? ["delivered", "Entregue"] : null; return <article className={`${styles.orderCard} ${printId === order.id ? styles.printTarget : ""}`} key={order.id}><div className={styles.orderTop}><div><strong>Pedido #{order.order_number}</strong><span>{table?.label || (order.source === "qr" ? "Pedido por QR" : "Balcão")}</span></div><span className={`${styles.status} ${styles[`status_${order.status}`] || ""}`}>{statuses[order.status] || order.status}</span></div><p className={styles.orderCustomer}>{order.customer_name_snapshot || "Cliente não informado"}{order.phone_snapshot ? ` · ${order.phone_snapshot}` : ""} · {dateTime(order.created_at)}</p><ul>{order.items.map((item, index) => <li key={`${item.product_id || item.description}-${index}`}><span>{item.quantity}× {item.description}{item.recipeSnapshot ? <small>Ficha v{item.recipeSnapshot.versionNo} · {item.recipeSnapshot.ingredients.map((ingredient) => ingredient.name).join(", ")}</small> : null}</span><b>{currency(item.total)}</b></li>)}</ul>{order.notes ? <p className={styles.kitchenNote}><b>Observação:</b> {order.notes}</p> : null}<div className={styles.orderBottom}><strong>{currency(order.total)}</strong><div><button type="button" className={styles.buttonGhost} onClick={() => onPrint(order as Order)}>Imprimir comanda</button>{!readOnly && next ? <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => onStatus(order as Order, next[0])}>{next[1]}</button> : null}{!readOnly && ["open", "sent_to_kitchen", "preparing", "ready"].includes(order.status) ? <button type="button" className={styles.cancelButton} disabled={busy} onClick={() => onStatus(order as Order, "cancelled")}>Cancelar</button> : null}</div></div></article>; })}</div>;
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
