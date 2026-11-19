"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./restaurant.module.css";

type Product = { id: string; name: string; description: string | null; category: string | null; unit: string; sale_price: number };
type Menu = { company: string; table: string; tableOpen: boolean; menu: Product[] };
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

export function RestaurantQrMenu({ token }: { token: string }) {
  const [data, setData] = useState<Menu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(0);
  const [sending, setSending] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [notes, setNotes] = useState("");
  const requestKey = useRef("");

  useEffect(() => {
    let active = true;
    fetch(`/api/restaurant?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as Menu & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Este cardápio não está disponível.");
        if (active) setData(payload);
      })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const cartItems = useMemo(() => Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })), [cart]);
  const total = useMemo(() => cartItems.reduce((sum, item) => sum + (data?.menu.find((product) => product.id === item.id)?.sale_price || 0) * item.quantity, 0), [cartItems, data]);

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !cartItems.length) { setError("Adicione ao menos um produto antes de enviar."); return; }
    setError(""); setSending(true);
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    try {
      const response = await fetch("/api/restaurant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, requestKey: requestKey.current, customerName: name, phone, cpf, notes, items: cartItems.map((item) => ({ productId: item.id, quantity: item.quantity })) }),
      });
      const payload = await response.json() as { order?: { order_number: number }; error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível enviar o pedido.");
      setSuccess(payload.order?.order_number || 0);
      requestKey.current = "";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o pedido.");
    } finally { setSending(false); }
  }

  return <main className={styles.qrPage}>
    <header className={styles.qrBrand}>
      <span>Cardápio digital · {data?.table || "Mesa"}</span>
      <h1>{data?.company || "Restaurante"}</h1>
      <p>Escolha os produtos e envie seu pedido. A equipe confirmará e encaminhará para preparo.</p>
    </header>
    {loading ? <div className={styles.qrEmpty}>Carregando cardápio…</div> : null}
    {error ? <div className={styles.qrError} role="alert">{error}</div> : null}
    {success ? <section className={styles.qrSuccess} role="status"><h2>Pedido enviado</h2><p>Seu pedido <strong>#{success}</strong> chegou à equipe. Aguarde a confirmação.</p><button className={styles.buttonGhost} onClick={() => { setSuccess(0); setCart({}); setName(""); setPhone(""); setCpf(""); setNotes(""); }}>Fazer outro pedido</button></section> : null}
    {!loading && data && !success ? <>
      {!data.tableOpen ? <div className={styles.qrEmpty}>A mesa está fechada no momento. Peça à equipe para abrir o atendimento.</div> : null}
      <section className={styles.qrMenu} aria-label="Produtos do cardápio">
        {data.menu.map((product) => <article className={styles.qrProduct} key={product.id}>
          <div><h3>{product.name}</h3>{product.description ? <p>{product.description}</p> : null}<strong>{money(product.sale_price)}</strong></div>
          <button type="button" aria-label={`Adicionar ${product.name}`} onClick={() => setCart((current) => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }))}>+</button>
        </article>)}
        {!data.menu.length ? <div className={styles.qrEmpty}>O restaurante ainda não publicou itens disponíveis no cardápio.</div> : null}
      </section>
      {cartItems.length ? <form className={styles.qrCheckout} onSubmit={(event) => void submitOrder(event)}>
        <h2>Seu pedido</h2>
        {cartItems.map((item) => { const product = data.menu.find((row) => row.id === item.id)!; return <div className={styles.qrProduct} key={item.id}><div><h3>{product.name}</h3><p>{item.quantity} × {money(product.sale_price)}</p></div><div><button className={styles.buttonGhost} type="button" aria-label={`Remover uma unidade de ${product.name}`} onClick={() => setCart((current) => ({ ...current, [product.id]: Math.max(0, (current[product.id] || 0) - 1) }))}>−</button> <button className={styles.buttonGhost} type="button" aria-label={`Adicionar uma unidade de ${product.name}`} onClick={() => setCart((current) => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }))}>+</button></div></div>; })}
        <div className={styles.qrTotals}><span>Total do pedido</span><strong>{money(total)}</strong></div>
        <label>Seu nome<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} autoComplete="name" required/></label>
        <label>Telefone com DDD<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" required/></label>
        <label>CPF <span>(opcional)</span><input value={cpf} onChange={(event) => setCpf(event.target.value)} placeholder="Informe se quiser identificar a compra" inputMode="numeric" autoComplete="off"/></label>
        <label>Observação para a cozinha (opcional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Ex.: sem cebola"/></label>
        <p className={styles.qrNotice}>Nome e telefone são usados para identificar o pedido. O CPF é opcional. O histórico completo do cliente fica visível apenas para a equipe autenticada.</p>
        <button type="submit" disabled={sending || !data.tableOpen}>{sending ? "Enviando pedido…" : "Enviar pedido para confirmação"}</button>
      </form> : null}
    </> : null}
  </main>;
}
