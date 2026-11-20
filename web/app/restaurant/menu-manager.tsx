"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RestaurantMenuOption, RestaurantMenuComponent } from "../../lib/restaurant-menu";
import styles from "./menu-manager.module.css";

type Category = { id: string; name: string; active: boolean; sort_order: number };
type MenuProduct = {
  id: string; name: string; description: string; sku: string; category: string; unit: string; active: boolean;
  salePrice: number; imagePath: string | null; imageUrl: string | null;
  options: RestaurantMenuOption[]; isCombo: boolean; comboComponents: RestaurantMenuComponent[];
  promotion: { label: string; price: number; startsAt: string | null; endsAt: string | null } | null;
  publicActive: boolean; sortOrder: number; currentPrice: number;
};
type Hours = Record<string, { open: boolean; from: string; to: string }>;
type Brand = {
  qrOrdersEnabled: boolean; publicName: string; publicDescription: string;
  logoPath: string | null; logoUrl: string | null; coverPath: string | null; coverUrl: string | null;
  brandColor: string; openingHours: Hours; publicSlug: string; websiteEnabled: boolean;
  websiteOrdersEnabled: boolean; websitePickupEnabled: boolean; contactPhone: string;
  whatsapp: string; publicEmail: string; publicAddress: string; mapUrl: string;
  instagramUrl: string; publicWebsiteUrl: string;
};
type MenuData = { schemaReady: boolean; previewTable: { label: string; qr_token: string } | null; products: MenuProduct[]; categories: Category[]; settings: Brand };
type PromotionDraft = { label: string; price: string; startsAt: string; endsAt: string };
type ProductDraft = {
  id: string; name: string; description: string; category: string; salePrice: string; active: boolean;
  publicActive: boolean; imagePath: string | null; imageUrl: string | null;
  options: RestaurantMenuOption[]; isCombo: boolean; comboComponents: RestaurantMenuComponent[];
  promotion: PromotionDraft | null; sortOrder: number;
};

const dayLabels: Array<[string, string]> = [["mon", "Segunda"], ["tue", "Terça"], ["wed", "Quarta"], ["thu", "Quinta"], ["fri", "Sexta"], ["sat", "Sábado"], ["sun", "Domingo"]];
const emptyHours = (): Hours => Object.fromEntries(dayLabels.map(([key]) => [key, { open: false, from: "", to: "" }]));
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
const toLocalDateTime = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16) : "";
const toDraft = (product: MenuProduct): ProductDraft => ({
  id: product.id, name: product.name, description: product.description || "", category: product.category || "", active: product.active,
  salePrice: String(product.salePrice), publicActive: product.publicActive, imagePath: product.imagePath, imageUrl: product.imageUrl,
  options: structuredClone(product.options || []), isCombo: product.isCombo, comboComponents: structuredClone(product.comboComponents || []),
  promotion: product.promotion ? { label: product.promotion.label, price: String(product.promotion.price), startsAt: toLocalDateTime(product.promotion.startsAt), endsAt: toLocalDateTime(product.promotion.endsAt) } : null,
  sortOrder: product.sortOrder || 0,
});

function newId() { return crypto.randomUUID(); }

function contrastRatio(hex: string, foreground: "#ffffff" | "#142a43") {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(value)) return 1;
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  const other = foreground === "#ffffff" ? 1 : 0.022;
  return (Math.max(luminance, other) + 0.05) / (Math.min(luminance, other) + 0.05);
}

function readableAccent(hex: string) {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#142a43") ? "#ffffff" : "#142a43";
}

export function RestaurantMenuManager() {
  const [data, setData] = useState<MenuData | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<"products" | "categories" | "brand">("products");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryEdits, setCategoryEdits] = useState<Record<string, string>>({});
  const [brand, setBrand] = useState<Brand>({
    qrOrdersEnabled: false, publicName: "", publicDescription: "", logoPath: null, logoUrl: null,
    coverPath: null, coverUrl: null, brandColor: "#1768d2", openingHours: emptyHours(),
    publicSlug: "", websiteEnabled: false, websiteOrdersEnabled: false, websitePickupEnabled: false,
    contactPhone: "", whatsapp: "", publicEmail: "", publicAddress: "", mapUrl: "",
    instagramUrl: "", publicWebsiteUrl: "",
  });
  const selectedIdRef = useRef("");

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/restaurant/menu", { cache: "no-store" });
      const payload = await response.json() as MenuData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o cardápio.");
      setData(payload);
      setBrand({ ...payload.settings, openingHours: { ...emptyHours(), ...(payload.settings.openingHours || {}) } });
      setCategoryEdits(Object.fromEntries(payload.categories.map((category) => [category.id, category.name])));
      const product = payload.products.find((item) => item.id === selectedIdRef.current) || payload.products[0];
      setSelectedId(product?.id || "");
      setDraft(product ? toDraft(product) : null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar o cardápio.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (data?.products || []).filter((product) => !term || `${product.name} ${product.category} ${product.sku}`.toLocaleLowerCase("pt-BR").includes(term));
  }, [data?.products, search]);
  const publicPreviewProducts = useMemo(() => (data?.products || []).map((product) => {
    if (!draft || draft.id !== product.id) return product;
    const price = Number(draft.salePrice);
    const promotionPrice = Number(draft.promotion?.price);
    const start = draft.promotion?.startsAt ? new Date(draft.promotion.startsAt).getTime() : null;
    const end = draft.promotion?.endsAt ? new Date(draft.promotion.endsAt).getTime() : null;
    const promotionActive = Boolean(draft.promotion && Number.isFinite(promotionPrice) && promotionPrice > 0 && promotionPrice < price &&
      (start === null || start <= Date.now()) && (end === null || end >= Date.now()));
    return {
      ...product, name: draft.name || product.name, description: draft.description,
      category: draft.category, salePrice: price, currentPrice: promotionActive ? promotionPrice : price,
      imageUrl: draft.imageUrl, publicActive: draft.publicActive, promotion: promotionActive ? draft.promotion : null,
      isCombo: draft.isCombo, comboComponents: draft.comboComponents,
    };
  }).filter((product) => product.active && product.publicActive), [data?.products, draft]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/restaurant/menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Não foi possível salvar as alterações.");
  }

  function changeProduct<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveProduct(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!draft) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const body: Record<string, unknown> = { action: data?.schemaReady ? "save-product" : "save-product-basic", id: draft.id, name: draft.name, description: draft.description, category: draft.category, salePrice: Number(draft.salePrice) };
      if (data?.schemaReady) Object.assign(body, {
        publicActive: draft.publicActive, options: draft.options, isCombo: draft.isCombo, comboComponents: draft.comboComponents,
        promotion: draft.promotion ? { label: draft.promotion.label, price: Number(draft.promotion.price), startsAt: draft.promotion.startsAt ? new Date(draft.promotion.startsAt).toISOString() : null, endsAt: draft.promotion.endsAt ? new Date(draft.promotion.endsAt).toISOString() : null } : null,
        sortOrder: draft.sortOrder,
      });
      await post(body);
      setMessage(`Produto “${draft.name.trim()}” salvo no cadastro desta empresa.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar o produto."); }
    finally { setBusy(false); }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await post({ action: "create-category", name: categoryName.trim() }); setMessage("Categoria criada e salva."); setCategoryName(""); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível criar a categoria."); }
    finally { setBusy(false); }
  }

  async function saveCategory(category: Category) {
    const name = (categoryEdits[category.id] || "").trim();
    if (name === category.name) return;
    setBusy(true); setError(""); setMessage("");
    try { await post({ action: "rename-category", id: category.id, name }); setMessage(`Categoria renomeada para “${name}”; os produtos vinculados foram atualizados.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível renomear a categoria."); }
    finally { setBusy(false); }
  }

  async function deleteCategory(category: Category) {
    if (!window.confirm(`Excluir a categoria “${category.name}”? Só é possível remover categorias sem produtos vinculados.`)) return;
    setBusy(true); setError(""); setMessage("");
    try { await post({ action: "delete-category", id: category.id }); setMessage(`Categoria “${category.name}” removida.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível remover a categoria."); }
    finally { setBusy(false); }
  }

  async function saveBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await post({
        action: "save-brand", publicName: brand.publicName, publicDescription: brand.publicDescription,
        brandColor: brand.brandColor, openingHours: brand.openingHours, publicSlug: brand.publicSlug,
        websiteEnabled: brand.websiteEnabled, websiteOrdersEnabled: brand.websiteOrdersEnabled,
        websitePickupEnabled: brand.websitePickupEnabled, contactPhone: brand.contactPhone,
        whatsapp: brand.whatsapp, publicEmail: brand.publicEmail, publicAddress: brand.publicAddress,
        mapUrl: brand.mapUrl, instagramUrl: brand.instagramUrl, publicWebsiteUrl: brand.publicWebsiteUrl,
      });
      setMessage("Identidade, descrição e horários do cardápio foram salvos.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a identidade do restaurante."); }
    finally { setBusy(false); }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>, purpose: "item" | "logo" | "cover", productId?: string) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const form = new FormData(); form.set("file", file); form.set("purpose", purpose); if (productId) form.set("productId", productId);
      const response = await fetch("/api/restaurant/menu-assets", { method: "POST", body: form });
      const payload = await response.json() as { path?: string; imageUrl?: string; error?: string };
      if (!response.ok || !payload.path) throw new Error(payload.error || "A imagem não foi salva.");
      if (purpose === "item") {
        changeProduct("imagePath", payload.path);
        changeProduct("imageUrl", payload.imageUrl || null);
      } else {
        setBrand((current) => purpose === "logo"
          ? { ...current, logoPath: payload.path!, logoUrl: payload.imageUrl || null }
          : { ...current, coverPath: payload.path!, coverUrl: payload.imageUrl || null });
      }
      setMessage("Imagem enviada e vinculada ao cardápio.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "A imagem não foi salva."); }
    finally { setBusy(false); input.value = ""; }
  }

  function updateOption(index: number, patch: Partial<RestaurantMenuOption>) {
    if (!draft) return;
    const options = draft.options.map((option, position) => position === index ? { ...option, ...patch } : option);
    changeProduct("options", options);
  }

  function updateChoice(groupIndex: number, choiceIndex: number, patch: { name?: string; price?: number }) {
    if (!draft) return;
    const options = draft.options.map((group, index) => index === groupIndex ? { ...group, choices: group.choices.map((choice, position) => position === choiceIndex ? { ...choice, ...patch } : choice) } : group);
    changeProduct("options", options);
  }

  if (loading && !data) return <section className={styles.load} role="status">Carregando produtos e configurações salvos…</section>;
  if (!data) return <section className={styles.loadError} role="alert"><strong>Não foi possível abrir o cardápio</strong><p>{error}</p><button type="button" onClick={() => void load()}>Tentar novamente</button></section>;

  return <section className={styles.manager}>
    <header className={styles.hero}>
      {brand.coverUrl ? <Image className={styles.heroCover} src={brand.coverUrl} alt="Capa do restaurante" width={1200} height={360} unoptimized/> : <div className={styles.heroCoverPlaceholder} aria-hidden="true"/>}
      <div className={styles.heroContent}>
        <div className={styles.heroLogo}>{brand.logoUrl ? <Image src={brand.logoUrl} alt="Logo do restaurante" width={58} height={58} unoptimized/> : <span aria-hidden="true">S</span>}</div>
        <div><span className={styles.eyebrow}>CARDAPIO DO RESTAURANTE</span><h2>{brand.publicName || "Organize o menu do seu restaurante"}</h2><p>Edite produtos do cadastro existente, configure opcoes e confira a versao publica salva.</p></div>
        <div className={styles.heroActions}>{data.previewTable && brand.qrOrdersEnabled ? <Link href={"/restaurant/qr/" + data.previewTable.qr_token} target="_blank" rel="noopener noreferrer" className={styles.primary}>Pre-visualizar</Link> : data.previewTable ? <Link href="/restaurant/configuracoes" className={styles.secondary}>Ativar pedidos por QR</Link> : <Link href="/restaurant/salao" className={styles.secondary}>Criar QR no salao</Link>}<button type="button" className={styles.secondary} disabled={busy || loading} onClick={() => void load()}>Atualizar</button></div>
      </div>
    </header>

    {!data.schemaReady ? <div className={styles.migrationNotice} role="status"><strong>Recursos avancados aguardam a migration local do cardapio.</strong><p>O cadastro basico de produto continua disponivel. Categorias proprias, fotos, adicionais, combos, promocoes e aparencia publica so serao gravados depois de aplicar <code>20261119_jvg_restaurant_menu_management.sql</code> no banco. Esta implementacao nao aplicou a migration.</p></div> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {message ? <div className={styles.success} role="status">{message}</div> : null}

    <nav className={styles.tabs} aria-label="Gerenciar cardapio">
      <button type="button" className={tab === "products" ? styles.tabActive : ""} onClick={() => setTab("products")}>Produtos <span>{data.products.length}</span></button>
      <button type="button" className={tab === "categories" ? styles.tabActive : ""} disabled={!data.schemaReady} onClick={() => setTab("categories")}>Categorias <span>{data.categories.length}</span></button>
      <button type="button" className={tab === "brand" ? styles.tabActive : ""} disabled={!data.schemaReady} onClick={() => setTab("brand")}>Aparencia e horarios</button>
    </nav>

    {tab === "products" ? <div className={styles.catalogLayout}>
      <aside className={styles.catalogPanel}>
        <div className={styles.catalogHeading}><div><span className={styles.eyebrow}>CATALOGO ERP</span><h3>Produtos</h3></div><a href="/erp/index.html#products" className={styles.textLink}>Cadastrar produto</a></div>
        <label className={styles.search}>Buscar produto<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, SKU ou categoria"/></label>
        <div className={styles.productList}>
          {filteredProducts.map((product) => <button key={product.id} type="button" onClick={() => { setSelectedId(product.id); setDraft(toDraft(product)); }} className={[styles.productPick, selectedId === product.id ? styles.productPickActive : ""].join(" ")}>
            <span className={styles.productThumb}>{product.imageUrl ? <Image src={product.imageUrl} alt="" width={52} height={52} unoptimized/> : <span aria-hidden="true">{product.name.slice(0, 1).toUpperCase()}</span>}</span>
            <span className={styles.productPickText}><strong>{product.name}</strong><small>{product.category || "Sem categoria"} · {money(product.currentPrice)}{product.promotion ? " · Oferta" : ""}{!product.active ? " · Inativo no ERP" : ""}</small></span>
            <span className={product.publicActive ? styles.publishedDot : styles.hiddenDot} title={product.publicActive ? "Visivel no cardapio" : "Oculto no cardapio"}/>
          </button>)}
          {!filteredProducts.length ? <div className={styles.empty}><strong>Nenhum produto encontrado</strong><p>Cadastre o produto no catalogo do ERP e ele aparecera aqui.</p><a href="/erp/index.html#products">Abrir produtos</a></div> : null}
        </div>
      </aside>

      {draft ? <form className={styles.editor} onSubmit={(event) => void saveProduct(event)}>
        <div className={styles.editorHeader}><div><span className={styles.eyebrow}>EDIÇÃO DO PRODUTO</span><h3>{draft.name || "Novo item"}</h3><p>As informações fiscais permanecem no cadastro do ERP; este painel salva os dados comerciais do cardápio.</p></div><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Salvando…" : "Salvar produto"}</button></div>
        <div className={styles.basicGrid}>
          <label>Nome do produto *<input value={draft.name} maxLength={160} required onChange={(event) => changeProduct("name", event.target.value)}/></label>
          <label>Preço de venda (R$) *<input value={draft.salePrice} type="number" min="0" step="0.01" required onChange={(event) => changeProduct("salePrice", event.target.value)}/></label>
          <label className={styles.full}>Descrição<input value={draft.description} maxLength={1000} onChange={(event) => changeProduct("description", event.target.value)} placeholder="Descrição que aparecerá para o cliente"/></label>
          {data.schemaReady ? <label>Categoria<select value={draft.category} onChange={(event) => changeProduct("category", event.target.value)}><option value="">Sem categoria</option>{data.categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label> : <label>Categoria<input value={draft.category} maxLength={80} onChange={(event) => changeProduct("category", event.target.value)} placeholder="Ex.: Lanches"/></label>}
          <label className={styles.toggle}><input type="checkbox" checked={draft.publicActive} disabled={!data.schemaReady || !draft.active} onChange={(event) => changeProduct("publicActive", event.target.checked)}/><span><strong>Visível no cardápio público</strong><small>{draft.active ? "O produto continua no cadastro e no estoque do ERP." : "Ative primeiro no cadastro de produtos do ERP."}</small></span></label>
        </div>

        <section className={styles.photoSection}>
          <div><h4>Foto do produto</h4><p>PNG, JPEG ou WebP; até 2 MB. A imagem fica na pasta da empresa.</p></div>
          {draft.imageUrl ? <Image className={styles.itemPhoto} src={draft.imageUrl} alt={`Foto de ${draft.name}`} width={148} height={112} unoptimized/> : <div className={styles.photoPlaceholder}>Sem foto</div>}
          <label className={styles.secondary}>Enviar foto<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !data.schemaReady} onChange={(event) => void upload(event, "item", draft.id)}/></label>
        </section>

        <div className={styles.advancedGrid}>
          <section className={styles.subPanel}>
            <div className={styles.subHeading}><div><h4>Adicionais e opções</h4><p>Monte grupos como tamanho, ponto ou acompanhamentos.</p></div><button type="button" className={styles.secondary} disabled={!data.schemaReady || draft.options.length >= 8} onClick={() => changeProduct("options", [...draft.options, { id: newId(), name: "", min: 0, max: 1, choices: [{ id: newId(), name: "", price: 0 }] }])}>+ Adicionar grupo</button></div>
            {!draft.options.length ? <div className={styles.emptyInline}>Nenhum adicional configurado.</div> : draft.options.map((group, groupIndex) => <article className={styles.optionCard} key={group.id}>
              <div className={styles.optionTop}><label>Nome do grupo<input value={group.name} maxLength={60} disabled={!data.schemaReady} placeholder="Ex.: Adicionais" onChange={(event) => updateOption(groupIndex, { name: event.target.value })}/></label><label>Mínimo<input type="number" min="0" max="20" value={group.min} disabled={!data.schemaReady} onChange={(event) => updateOption(groupIndex, { min: Number(event.target.value) })}/></label><label>Máximo<input type="number" min="1" max="20" value={group.max} disabled={!data.schemaReady} onChange={(event) => updateOption(groupIndex, { max: Number(event.target.value) })}/></label><button type="button" className={styles.remove} aria-label="Remover grupo" disabled={!data.schemaReady} onClick={() => changeProduct("options", draft.options.filter((_, index) => index !== groupIndex))}>Remover</button></div>
              <div className={styles.choiceList}>{group.choices.map((choice, choiceIndex) => <div className={styles.choiceRow} key={choice.id}><label>Opção<input value={choice.name} maxLength={60} disabled={!data.schemaReady} onChange={(event) => updateChoice(groupIndex, choiceIndex, { name: event.target.value })}/></label><label>Adicional (R$)<input type="number" min="0" step="0.01" value={choice.price} disabled={!data.schemaReady} onChange={(event) => updateChoice(groupIndex, choiceIndex, { price: Number(event.target.value) })}/></label><button type="button" className={styles.remove} disabled={!data.schemaReady || group.choices.length <= 1} onClick={() => updateOption(groupIndex, { choices: group.choices.filter((_, index) => index !== choiceIndex) })}>×</button></div>)}<button type="button" className={styles.addLink} disabled={!data.schemaReady || group.choices.length >= 20} onClick={() => updateOption(groupIndex, { choices: [...group.choices, { id: newId(), name: "", price: 0 }] })}>+ Adicionar opção</button></div>
            </article>)}
          </section>

          <section className={styles.subPanel}>
            <div className={styles.subHeading}><div><h4>Combo</h4><p>Associe itens do catálogo para mostrar a composição ao cliente.</p></div><label className={styles.inlineCheck}><input type="checkbox" checked={draft.isCombo} disabled={!data.schemaReady} onChange={(event) => changeProduct("isCombo", event.target.checked)}/> Este produto é um combo</label></div>
            {draft.isCombo ? <div className={styles.comboList}>{draft.comboComponents.map((component, index) => <div className={styles.choiceRow} key={`${component.productId}-${index}`}><label>Produto<select value={component.productId} disabled={!data.schemaReady} onChange={(event) => changeProduct("comboComponents", draft.comboComponents.map((row, rowIndex) => rowIndex === index ? { ...row, productId: event.target.value } : row))}><option value="">Selecione</option>{data.products.filter((product) => product.id !== draft.id && product.active).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Quantidade<input type="number" min="0.001" max="99.999" step="0.001" value={component.quantity} disabled={!data.schemaReady} onChange={(event) => changeProduct("comboComponents", draft.comboComponents.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row))}/></label><button type="button" className={styles.remove} disabled={!data.schemaReady} onClick={() => changeProduct("comboComponents", draft.comboComponents.filter((_, rowIndex) => rowIndex !== index))}>×</button></div>)}<button type="button" className={styles.addLink} disabled={!data.schemaReady || draft.comboComponents.length >= 20} onClick={() => changeProduct("comboComponents", [...draft.comboComponents, { productId: "", quantity: 1 }])}>+ Adicionar produto ao combo</button></div> : <div className={styles.emptyInline}>Este produto será exibido individualmente.</div>}
          </section>

          <section className={styles.subPanel}>
            <div className={styles.subHeading}><div><h4>Promoção</h4><p>O preço promocional só vale dentro do período informado.</p></div><label className={styles.inlineCheck}><input type="checkbox" checked={Boolean(draft.promotion)} disabled={!data.schemaReady} onChange={(event) => changeProduct("promotion", event.target.checked ? { label: "Oferta", price: "", startsAt: "", endsAt: "" } : null)}/> Ativar promoção</label></div>
            {draft.promotion ? <div className={styles.promotionGrid}><label>Nome da oferta<input value={draft.promotion.label} maxLength={60} disabled={!data.schemaReady} onChange={(event) => changeProduct("promotion", { ...draft.promotion!, label: event.target.value })}/></label><label>Preço promocional (R$)<input type="number" min="0" step="0.01" required value={draft.promotion.price} disabled={!data.schemaReady} onChange={(event) => changeProduct("promotion", { ...draft.promotion!, price: event.target.value })}/></label><label>Início (opcional)<input type="datetime-local" value={draft.promotion.startsAt} disabled={!data.schemaReady} onChange={(event) => changeProduct("promotion", { ...draft.promotion!, startsAt: event.target.value })}/></label><label>Fim (opcional)<input type="datetime-local" value={draft.promotion.endsAt} disabled={!data.schemaReady} onChange={(event) => changeProduct("promotion", { ...draft.promotion!, endsAt: event.target.value })}/></label></div> : <div className={styles.emptyInline}>Nenhuma promoção ativa.</div>}
          </section>
        </div>
        <footer className={styles.editorFooter}><span>SKU {data.products.find((product) => product.id === draft.id)?.sku || "não informado"} · unidade {data.products.find((product) => product.id === draft.id)?.unit || "UN"}</span><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Salvando…" : "Salvar alterações"}</button></footer>
      </form> : <div className={styles.empty}><strong>Não há produtos cadastrados</strong><p>Cadastre um produto para começar o cardápio.</p><a href="/erp/index.html#products">Abrir cadastro de produtos</a></div>}
    </div> : null}

    {tab === "categories" ? <div className={styles.categoryLayout}>
      <section className={styles.subPanel}><div className={styles.subHeading}><div><span className={styles.eyebrow}>ORGANIZAÇÃO DO MENU</span><h3>Categorias do cardápio</h3><p>Renomear uma categoria atualiza os produtos vinculados. Excluir só é permitido quando estiver vazia.</p></div></div><form className={styles.addCategory} onSubmit={(event) => void createCategory(event)}><label>Nova categoria<input value={categoryName} maxLength={60} minLength={2} required onChange={(event) => setCategoryName(event.target.value)} placeholder="Ex.: Bebidas"/></label><button type="submit" className={styles.primary} disabled={busy}>Adicionar categoria</button></form><div className={styles.categoryList}>{data.categories.map((category) => <div className={styles.categoryRow} key={category.id}><label>Nome<input value={categoryEdits[category.id] || ""} maxLength={60} disabled={!category.id.match(/^[0-9a-f-]{36}$/i)} onChange={(event) => setCategoryEdits((current) => ({ ...current, [category.id]: event.target.value }))}/></label><span>{category.id.startsWith("legacy:") ? "Categoria em texto no produto" : category.active ? "Ativa" : "Inativa"}</span>{category.id.startsWith("legacy:") ? <small>Para editar esta categoria, crie-a e reatribua os produtos no cadastro.</small> : <div><button type="button" className={styles.secondary} disabled={busy || categoryEdits[category.id] === category.name} onClick={() => void saveCategory(category)}>Salvar nome</button><button type="button" className={styles.remove} disabled={busy} onClick={() => void deleteCategory(category)}>Excluir</button></div>}</div>)}{!data.categories.length ? <div className={styles.empty}><strong>Nenhuma categoria cadastrada</strong><p>Crie uma categoria e selecione-a ao editar um produto.</p></div> : null}</div></section>
      <aside className={styles.subPanel}><span className={styles.eyebrow}>PRÉVIA DE ORGANIZAÇÃO</span><h3>Assim o cliente encontra os itens</h3><p>As categorias salvas organizam o cardápio por tipo de produto. Produtos sem categoria continuam disponíveis em “Outros”.</p><div className={styles.previewChips}>{data.categories.filter((category) => category.active).map((category) => <span key={category.id}>{category.name}</span>)}</div><p className={styles.note}>O cadastro fiscal, NCM, estoque e custo continuam no cadastro do produto no ERP.</p></aside>
    </div> : null}

    {tab === "brand" ? <div className={styles.brandLayout}>
      <form className={styles.brandEditor} onSubmit={(event) => void saveBrand(event)}>
        <div className={styles.subHeading}><div><span className={styles.eyebrow}>SITE E CARDÁPIO PÚBLICO</span><h3>Configure a página do restaurante</h3><p>O site e os QR das mesas usam o mesmo cardápio, fotos, preços e identidade. O tema da área interna não muda.</p></div><button className={styles.primary} disabled={busy}>{busy ? "Salvando…" : "Salvar site"}</button></div>
        <div className={styles.brandFields}>
          <label>Endereço público<input value={brand.publicSlug} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={(event) => setBrand((current) => ({ ...current, publicSlug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} placeholder="meu-restaurante"/></label>
          <label>Nome público<input value={brand.publicName} maxLength={120} onChange={(event) => setBrand((current) => ({ ...current, publicName: event.target.value }))} placeholder="Usa o nome cadastrado se vazio"/></label>
          <label>Cor principal<input type="color" value={brand.brandColor} onChange={(event) => setBrand((current) => ({ ...current, brandColor: event.target.value }))}/></label>
          <label>Telefone de contato<input value={brand.contactPhone} inputMode="tel" maxLength={24} onChange={(event) => setBrand((current) => ({ ...current, contactPhone: event.target.value }))} placeholder="(00) 00000-0000"/></label>
          <label>WhatsApp<input value={brand.whatsapp} inputMode="tel" maxLength={24} onChange={(event) => setBrand((current) => ({ ...current, whatsapp: event.target.value }))} placeholder="(00) 00000-0000"/></label>
          <label>E-mail público<input type="email" value={brand.publicEmail} maxLength={160} onChange={(event) => setBrand((current) => ({ ...current, publicEmail: event.target.value }))}/></label>
          <label className={styles.full}>Descrição do restaurante<textarea value={brand.publicDescription} maxLength={280} rows={3} onChange={(event) => setBrand((current) => ({ ...current, publicDescription: event.target.value }))} placeholder="Apresente o restaurante em poucas palavras"/></label>
          <label className={styles.full}>Endereço<input value={brand.publicAddress} maxLength={300} onChange={(event) => setBrand((current) => ({ ...current, publicAddress: event.target.value }))}/></label>
          <label>Link do mapa<input type="url" value={brand.mapUrl} onChange={(event) => setBrand((current) => ({ ...current, mapUrl: event.target.value }))} placeholder="https://…"/></label>
          <label>Instagram<input type="url" value={brand.instagramUrl} onChange={(event) => setBrand((current) => ({ ...current, instagramUrl: event.target.value }))} placeholder="https://…"/></label>
          <label className={styles.full}>Outro site<input type="url" value={brand.publicWebsiteUrl} onChange={(event) => setBrand((current) => ({ ...current, publicWebsiteUrl: event.target.value }))} placeholder="https://…"/></label>
        </div>
        <div className={styles.siteControls}>
          <label className={styles.inlineCheck}><input type="checkbox" checked={brand.websiteEnabled} onChange={(event) => setBrand((current) => ({ ...current, websiteEnabled: event.target.checked, websiteOrdersEnabled: event.target.checked && current.websiteOrdersEnabled }))}/> Publicar site e cardápio</label>
          <label className={styles.inlineCheck}><input type="checkbox" checked={brand.websiteOrdersEnabled} disabled={!brand.websiteEnabled} onChange={(event) => setBrand((current) => ({ ...current, websiteOrdersEnabled: event.target.checked, websitePickupEnabled: event.target.checked || current.websitePickupEnabled }))}/> Receber pedidos pelo site</label>
          <label className={styles.inlineCheck}><input type="checkbox" checked={brand.websitePickupEnabled} disabled={!brand.websiteEnabled || !brand.websiteOrdersEnabled} onChange={(event) => setBrand((current) => ({ ...current, websitePickupEnabled: event.target.checked }))}/> Permitir retirada no restaurante</label>
          <p>Entrega e pagamento online não são exibidos porque esses fluxos não estão configurados. O pedido pelo site fica para pagar no caixa.</p>
        </div>
        <div className={styles.brandImages}><div className={styles.uploadTile}>{brand.logoUrl ? <Image src={brand.logoUrl} alt="Logo salva" width={90} height={90} unoptimized/> : <div className={styles.photoPlaceholder}>Logo</div>}<div><strong>Logo do restaurante</strong><small>PNG, JPEG ou WebP · até 2 MB</small><label className={styles.secondary}>Enviar logo<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => void upload(event, "logo")}/></label></div></div><div className={styles.uploadTile}>{brand.coverUrl ? <Image className={styles.coverThumb} src={brand.coverUrl} alt="Capa salva" width={180} height={90} unoptimized/> : <div className={styles.coverPlaceholder}>Capa</div>}<div><strong>Imagem de capa</strong><small>PNG, JPEG ou WebP · até 2 MB</small><label className={styles.secondary}>Enviar capa<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => void upload(event, "cover")}/></label></div></div></div>
        <section className={styles.hoursEditor}><div><h4>Horário de atendimento</h4><p>Os horários salvos aparecem no site e no cardápio por QR.</p></div><div className={styles.hoursList}>{dayLabels.map(([key, label]) => <div key={key} className={styles.hoursRow}><label className={styles.inlineCheck}><input type="checkbox" checked={brand.openingHours[key]?.open || false} onChange={(event) => setBrand((current) => ({ ...current, openingHours: { ...current.openingHours, [key]: { ...current.openingHours[key], open: event.target.checked, from: current.openingHours[key]?.from || "09:00", to: current.openingHours[key]?.to || "18:00" } } }))}/>{label}</label><label>Abre<input type="time" value={brand.openingHours[key]?.from || ""} disabled={!brand.openingHours[key]?.open} onChange={(event) => setBrand((current) => ({ ...current, openingHours: { ...current.openingHours, [key]: { ...current.openingHours[key], from: event.target.value } } }))}/></label><label>Fecha<input type="time" value={brand.openingHours[key]?.to || ""} disabled={!brand.openingHours[key]?.open} onChange={(event) => setBrand((current) => ({ ...current, openingHours: { ...current.openingHours, [key]: { ...current.openingHours[key], to: event.target.value } } }))}/></label></div>)}</div></section>
        <div className={styles.themeActions}><button type="button" className={styles.secondary} onClick={() => setBrand((current) => ({ ...current, brandColor: "#1768d2" }))}>Restaurar tema padrão</button><small>Restaura a cor principal sem remover logo, capa ou horários. Salve para publicar.</small></div>
      </form>
      <aside className={styles.publicPreview} style={{ "--preview-color": brand.brandColor, "--preview-foreground": readableAccent(brand.brandColor) } as CSSProperties}>
        <div className={styles.previewLabel}><span className={styles.eyebrow}>PRÉ-VISUALIZAÇÃO AO VIVO</span><small>Inclui alterações ainda não salvas</small></div>
        {brand.coverUrl ? <Image className={styles.previewCover} src={brand.coverUrl} alt="Prévia da capa" width={640} height={190} unoptimized/> : <div className={styles.previewCoverEmpty}/>}
        <div className={styles.previewBody}>{brand.logoUrl ? <Image className={styles.previewLogo} src={brand.logoUrl} alt="Prévia da logo" width={52} height={52} unoptimized/> : null}<span className={styles.eyebrow}>CARDÁPIO DO RESTAURANTE</span><h3>{brand.publicName || "Nome do restaurante"}</h3>{brand.publicDescription ? <p>{brand.publicDescription}</p> : null}{brand.publicAddress ? <p>{brand.publicAddress}</p> : null}{brand.mapUrl ? <a href={brand.mapUrl} target="_blank" rel="noreferrer">Abrir mapa</a> : null}{dayLabels.some(([key]) => brand.openingHours[key]?.open) ? <><strong>Horários</strong><ul>{dayLabels.filter(([key]) => brand.openingHours[key]?.open).map(([key, label]) => <li key={key}>{label}: {brand.openingHours[key].from}–{brand.openingHours[key].to}</li>)}</ul></> : null}</div>
        <div className={styles.previewMenu}>
          <div className={styles.previewMenuHeading}><strong>Cardápio</strong><span>{publicPreviewProducts.length} item(ns) visível(is)</span></div>
          {data.categories.filter((category) => category.active).length ? <div className={styles.previewChips}>{data.categories.filter((category) => category.active).map((category) => <span key={category.id}>{category.name}</span>)}</div> : null}
          {publicPreviewProducts.length ? publicPreviewProducts.slice(0, 5).map((product) => <article className={styles.previewProduct} key={product.id}>
            {product.imageUrl ? <Image src={product.imageUrl} alt="" width={48} height={48} unoptimized/> : <span className={styles.previewProductPlaceholder} aria-hidden="true">{product.name.slice(0, 1).toUpperCase()}</span>}
            <div><strong>{product.name}</strong><small>{product.category || "Outros"}{product.isCombo ? " · Combo" : ""}{product.promotion ? " · " + product.promotion.label : ""}</small><b>{money(product.currentPrice)}</b></div>
          </article>) : <p className={styles.previewEmpty}>Cadastre e publique produtos ativos para exibi-los aqui.</p>}
          {publicPreviewProducts.length > 5 ? <small className={styles.previewMore}>Mais {publicPreviewProducts.length - 5} item(ns) no cardápio.</small> : null}
        </div>
        <p className={styles.contrastInfo}>Contraste do botão principal: {contrastRatio(brand.brandColor, readableAccent(brand.brandColor)).toFixed(2)}:1 · {contrastRatio(brand.brandColor, readableAccent(brand.brandColor)) >= 4.5 ? "adequado" : "revise a cor"}</p>
        {brand.websiteEnabled && brand.publicSlug ? <Link href={"/r/" + brand.publicSlug} target="_blank" rel="noopener noreferrer" className={styles.secondary}>Abrir site público salvo</Link> : <p className={styles.note}>Salve e publique o endereço para abrir a página pública.</p>}
        {data.previewTable && brand.qrOrdersEnabled ? <Link href={"/restaurant/qr/" + data.previewTable.qr_token} target="_blank" rel="noopener noreferrer" className={styles.secondary}>Pré-visualizar QR de mesa</Link> : data.previewTable ? <p className={styles.note}>Pedidos por QR estão desativados nas Configurações.</p> : <p className={styles.note}>Crie uma mesa na área Salão e mesas para gerar o QR.</p>}
      </aside>
    </div> : null}
  </section>;
}
