"use client";

import Image from "next/image";
import { createBrowserClient } from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";
import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveMenuChoices, type RestaurantMenuOption } from "../../lib/restaurant-menu";
import styles from "./restaurant.module.css";

type Product = {
  id: string; name: string; description: string; category: string; unit: string;
  sale_price: number; base_price: number; image_url: string | null; options: RestaurantMenuOption[];
  is_combo: boolean; combo_components: Array<{ product_id: string; name: string; quantity: number; unit: string }>;
  promotion: { label: string; price: number; startsAt: string | null; endsAt: string | null } | null;
  available: boolean; availableQuantity: number | null; availabilityMessage: string | null;
};
type Menu = {
  mode: "website" | "table"; company: string; description: string; table: string | null; tableOpen: boolean;
  logoUrl: string | null; coverUrl: string | null; brandColor: string;
  openingHours: Record<string, { open: boolean; from: string; to: string }>;
  categories: Array<{ id: string; name: string; active: boolean; sort_order: number }>;
  menu: Product[]; onlineOrdersEnabled: boolean; pickupEnabled: boolean;
  contactPhone: string; whatsapp: string; email: string; address: string;
  mapUrl: string; instagramUrl: string; websiteUrl: string;
};
type CartLine = { productId: string; quantity: number; optionChoiceIds: string[] };
type OrderItem = {
  product_id: string; description: string; quantity: number; unit_price: number; total: number;
  selectedOptionIds?: string[]; selectedOptions?: Array<{ name: string; price: number }>;
  promotionSnapshot?: { label: string; price: number } | null;
};
type HistoryOrder = {
  id: string; order_number: number; status: string; payment_status: string; fulfillment_type: string | null;
  items: OrderItem[]; total: number; notes: string; created_at: string;
  fiscalDocuments?: Array<{ id: string; documentType: string; number: number | null; series: string | null; authorizedAt: string; availableUntil: string; formats: Array<"pdf" | "xml"> }>;
};
type CustomerProfile = { id: string; name: string; phone: string; cpf: string | null; loyaltyPoints: number };
type Quote = { total: number; orderNumber: number | null; changed: boolean; promoChanged: boolean };
type ReorderIssue = { key: string; description: string; reason: string };

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
const cartKey = (id: string, options: string[]) => id + ":" + [...options].sort().join(",");
const days: Record<string, string> = { mon: "Segunda", tue: "Terça", wed: "Quarta", thu: "Quinta", fri: "Sexta", sat: "Sábado", sun: "Domingo" };
const statuses: Record<string, string> = { open: "Aguardando confirmação", sent_to_kitchen: "Enviado à cozinha", preparing: "Em preparo", ready: "Pronto", delivered: "Entregue", cancelled: "Cancelado" };

function queryFor(token?: string, slug?: string, extra?: Record<string, string>) {
  const params = new URLSearchParams(token ? { token } : { slug: slug || "" });
  Object.entries(extra || {}).forEach(([key, value]) => params.set(key, value));
  return params.toString();
}

function e164(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return "+" + digits;
  if (digits.length === 10 || digits.length === 11) return "+55" + digits;
  throw new Error("Informe um telefone brasileiro com DDD.");
}

function contrastRatio(hex: string, foreground: string) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const foregroundValue = Number.parseInt(foreground.replace("#", ""), 16);
  if (!Number.isFinite(value) || !Number.isFinite(foregroundValue)) return 1;
  const luminance = (color: number) => {
    const channels = [(color >> 16) & 255, (color >> 8) & 255, color & 255].map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const first = luminance(value), second = luminance(foregroundValue);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function readableAccent(hex: string) {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#142a43") ? "#ffffff" : "#142a43";
}

function readableAccentText(hex: string) {
  const matched = hex.match(/^#([0-9a-f]{6})$/i);
  if (!matched) return "#1052ad";
  const original = Number.parseInt(matched[1], 16);
  let red = (original >> 16) & 255, green = (original >> 8) & 255, blue = original & 255;
  for (let step = 0; step < 20; step += 1) {
    const candidate = "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("");
    if (contrastRatio(candidate, "#ffffff") >= 4.5) return candidate;
    red = Math.round(red * 0.88); green = Math.round(green * 0.88); blue = Math.round(blue * 0.88);
  }
  return "#142a43";
}

export function RestaurantPublicMenu({ token, slug }: { token?: string; slug?: string }) {
  const [data, setData] = useState<Menu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState<{ number: number; status: string } | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [history, setHistory] = useState<HistoryOrder[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileCpf, setProfileCpf] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [customizing, setCustomizing] = useState("");
  const [optionsByProduct, setOptionsByProduct] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [tableBusy, setTableBusy] = useState(false);
  const [tableNotice, setTableNotice] = useState("");
  const [documentBusy, setDocumentBusy] = useState("");
  const [reorderIssues, setReorderIssues] = useState<ReorderIssue[]>([]);
  const [reorderIssueOrder, setReorderIssueOrder] = useState<number | null>(null);
  const requestKey = useRef("");
  const context = useMemo(() => queryFor(token, slug), [token, slug]);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const supabase = useMemo(() => supabaseUrl && supabaseKey ? createBrowserClient(supabaseUrl, supabaseKey) : null, [supabaseUrl, supabaseKey]);

  function setAuthSession(next: Session | null) {
    setSession(next);
    setQuote(null);
    setAccountLoading(Boolean(next));
    setAuthError("");
    if (!next) { setProfile(null); setHistory([]); setEditingProfile(false); }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/restaurant?" + context, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as Menu & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Este cardápio não está disponível.");
        if (active) setData(payload);
      })
      .catch((reason: Error) => { if (active) { setError(reason.message); setAccountLoading(false); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [context]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data: result }) => { if (active) setAuthSession(result.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { if (active) setAuthSession(next); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [supabase]);

  const loadAccount = useCallback(async (accessToken: string, cpf?: string) => {
    const extra: Record<string, string> = { account: "1" };
    if (cpf?.replace(/\D/g, "")) extra.cpf = cpf.replace(/\D/g, "");
    const response = await fetch("/api/restaurant?" + queryFor(token, slug, extra), {
      cache: "no-store", headers: { Authorization: "Bearer " + accessToken },
    });
    const payload = await response.json() as { profile?: CustomerProfile | null; history?: HistoryOrder[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Não foi possível consultar sua conta.");
    return { profile: payload.profile || null, history: payload.history || [] };
  }, [slug, token]);

  useEffect(() => {
    if (!session?.access_token || !data) return;
    let active = true;
    void loadAccount(session.access_token)
      .then((payload) => {
        if (!active) return;
        setProfile(payload.profile);
        setHistory(payload.history);
        if (payload.profile) {
          setProfileName(payload.profile.name);
          setProfileCpf(payload.profile.cpf || "");
        }
      })
      .catch((reason: Error) => { if (active) setAuthError(reason.message); })
      .finally(() => { if (active) setAccountLoading(false); });
    return () => { active = false; };
  }, [session, data, loadAccount]);

  useEffect(() => {
    if (!session?.access_token || !profile || !data) return;
    let active = true;
    const timer = window.setInterval(() => {
      void loadAccount(session.access_token).then((payload) => {
        if (active) { setProfile(payload.profile); setHistory(payload.history); }
      }).catch(() => undefined);
    }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session?.access_token, profile, data, loadAccount]);

  const visibleMenu = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return data?.menu.filter((item) => (category === "all" || item.category === category) &&
      (!term || (item.name + " " + item.description + " " + item.category).toLocaleLowerCase("pt-BR").includes(term))) || [];
  }, [data, search, category]);
  const cartItems = Object.entries(cart).filter(([, item]) => item.quantity > 0).map(([key, item]) => ({ key, ...item }));
  const productFor = (item: CartLine) => data?.menu.find((product) => product.id === item.productId);
  const linePrice = (item: CartLine) => {
    const product = productFor(item);
    return product ? product.sale_price + resolveMenuChoices(product.options, item.optionChoiceIds).extraPrice : 0;
  };
  const cartTotal = cartItems.reduce((sum, item) => sum + linePrice(item) * item.quantity, 0);
  const canOrder = Boolean(data?.onlineOrdersEnabled && (data.mode === "website" || data.tableOpen));

  function clearQuote() { setQuote(null); requestKey.current = ""; }

  function addItem(product: Product, choiceIds: string[] = []) {
    if (!product.available) { setError(product.availabilityMessage || "Este produto está indisponível no momento."); return; }
    const resolution = resolveMenuChoices(product.options, choiceIds);
    if (!resolution.valid) { setError(resolution.error); return; }
    const currentQuantity = Object.values(cart).filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
    if (product.availableQuantity !== null && currentQuantity >= product.availableQuantity) {
      setError("O estoque atual permite até " + product.availableQuantity + " unidade(s) deste produto.");
      return;
    }
    const key = cartKey(product.id, choiceIds);
    setCart((current) => ({ ...current, [key]: { productId: product.id, quantity: (current[key]?.quantity || 0) + 1, optionChoiceIds: [...choiceIds] } }));
    setError(""); setCustomizing(""); clearQuote();
  }

  function changeQuantity(item: CartLine, delta: number) {
    const product = productFor(item);
    const totalForProduct = Object.values(cart).filter((line) => line.productId === item.productId).reduce((sum, line) => sum + line.quantity, 0);
    if (delta > 0 && product?.availableQuantity !== null && product?.availableQuantity !== undefined && totalForProduct >= product.availableQuantity) {
      setError("O estoque atual permite até " + product.availableQuantity + " unidade(s) deste produto.");
      return;
    }
    const key = cartKey(item.productId, item.optionChoiceIds);
    setCart((current) => {
      const next = { ...current };
      const quantity = (next[key]?.quantity || 0) + delta;
      if (quantity <= 0) delete next[key]; else next[key] = { ...next[key], quantity };
      return next;
    });
    setError(""); clearQuote();
  }

  function toggleOption(product: Product, group: RestaurantMenuOption, choiceId: string) {
    setOptionsByProduct((current) => {
      const before = current[product.id] || [];
      const groupIds = new Set(group.choices.map((choice) => choice.id));
      const inGroup = before.filter((id) => groupIds.has(id));
      const elsewhere = before.filter((id) => !groupIds.has(id));
      let next = inGroup.includes(choiceId) ? inGroup.filter((id) => id !== choiceId) : [...inGroup, choiceId];
      if (next.length > group.max) next = next.slice(1);
      return { ...current, [product.id]: [...elsewhere, ...next] };
    });
  }

  async function quoteItems(items: Array<{ productId: string; quantity: number; optionChoiceIds: string[] }>, previous?: { number: number; total: number; hadPromotion: boolean }) {
    if (!session?.access_token) { setError("Confirme seu telefone para revisar e enviar o pedido."); return; }
    setQuoteBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/restaurant", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ token, slug, kind: "quote-order", items }),
      });
      const payload = await response.json() as { total?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível conferir preço e estoque.");
      const latest = Number(payload.total);
      if (!Number.isFinite(latest)) throw new Error("O restaurante não retornou um total válido.");
      const changed = Boolean(previous && Math.abs(previous.total - latest) > 0.009);
      setQuote({ total: latest, orderNumber: previous?.number ?? null, changed, promoChanged: Boolean(changed && previous?.hadPromotion) });
      setNotice(changed
        ? (previous?.hadPromotion ? "A promoção ou o preço mudou. Confira o valor atualizado antes de confirmar." : "O preço atual mudou em relação ao pedido anterior. Confira antes de confirmar.")
        : "Preço e disponibilidade conferidos. Revise o total e confirme para enviar.");
    } catch (reason) { setQuote(null); setError(reason instanceof Error ? reason.message : "Não foi possível conferir preço e estoque."); }
    finally { setQuoteBusy(false); }
  }

  async function quoteCart() {
    if (reorderIssues.length) { setError("Revise os itens antigos da repetição: escolha um substituto ou remova cada item explicitamente."); return; }
    if (!profile) { setError("Entre na sua conta e conclua o cadastro para continuar."); return; }
    await quoteItems(cartItems.map(({ productId, quantity, optionChoiceIds }) => ({ productId, quantity, optionChoiceIds })));
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !profile || !session?.access_token || !cartItems.length) { setError("Entre na sua conta e adicione itens disponíveis ao pedido."); return; }
    if (!quote) { setError("Confira preço e estoque antes de enviar o pedido."); return; }
    setSending(true); setError("");
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    try {
      const response = await fetch("/api/restaurant", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({
          token, slug, kind: "order", requestKey: requestKey.current, expectedTotal: quote.total,
          customerName: profile.name, cpf: profile.cpf || "", notes,
          items: cartItems.map(({ productId, quantity, optionChoiceIds }) => ({ productId, quantity, optionChoiceIds })),
        }),
      });
      const payload = await response.json() as { order?: { order_number: number; status: string }; error?: string; requiresPriceConfirmation?: boolean; total?: number };
      if (!response.ok) {
        if (payload.requiresPriceConfirmation && Number.isFinite(Number(payload.total))) {
          setQuote({ ...quote, total: Number(payload.total) });
          throw new Error(payload.error || "O total mudou. Confira e confirme novamente.");
        }
        throw new Error(payload.error || "Não foi possível enviar o pedido.");
      }
      setSuccess({ number: payload.order?.order_number || 0, status: payload.order?.status || "open" });
      requestKey.current = ""; setCart({}); setQuote(null); setNotes(""); setNotice("");
      void loadAccount(session.access_token).then((payload) => { setProfile(payload.profile); setHistory(payload.history); }).catch((reason: Error) => setAuthError(reason.message));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar o pedido."); }
    finally { setSending(false); }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthError(""); setAuthBusy(true);
    if (!supabase) { setAuthError("A autenticação por telefone não está configurada neste ambiente."); setAuthBusy(false); return; }
    try {
      if (profileCpf.replace(/\D/g, "").length !== 11) throw new Error("Informe os 11 dígitos do CPF para consultar seu cadastro após confirmar o telefone.");
      const phoneNumber = e164(phone);
      const { error: sendError } = await supabase.auth.signInWithOtp({ phone: phoneNumber });
      if (sendError) throw sendError;
      setPhone(phoneNumber); setOtpSent(true); setNotice("Enviamos um código de verificação por SMS.");
    } catch (reason) { setAuthError(reason instanceof Error ? reason.message : "Não foi possível enviar o código. Confira a configuração de SMS."); }
    finally { setAuthBusy(false); }
  }

  async function confirmCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthError(""); setAuthBusy(true);
    if (!supabase) { setAuthError("A autenticação por telefone não está configurada neste ambiente."); setAuthBusy(false); return; }
    try {
      const { data: result, error: verifyError } = await supabase.auth.verifyOtp({ phone: e164(phone), token: otp.trim(), type: "sms" });
      if (verifyError) throw verifyError;
      if (!result.session) throw new Error("O provedor não confirmou a sessão. Solicite outro código.");
      setAuthSession(result.session);
      const account = await loadAccount(result.session.access_token, profileCpf);
      setProfile(account.profile); setHistory(account.history);
      if (account.profile) { setProfileName(account.profile.name); setProfileCpf(account.profile.cpf || ""); }
      setOtpSent(false); setOtp(""); setNotice("Telefone confirmado para acessar sua conta neste restaurante.");
    } catch (reason) { setAuthError(reason instanceof Error ? reason.message : "Código inválido ou expirado."); }
    finally { setAuthBusy(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.access_token) { setAuthError("Confirme seu telefone para salvar o cadastro."); return; }
    setAuthBusy(true); setAuthError(""); setNotice("");
    try {
      const response = await fetch("/api/restaurant", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ token, slug, kind: "customer-profile", customerName: profileName, cpf: profileCpf }),
      });
      const payload = await response.json() as { profile?: CustomerProfile; error?: string };
      if (!response.ok || !payload.profile) throw new Error(payload.error || "Não foi possível salvar seu cadastro.");
      setProfile(payload.profile); setEditingProfile(false); setNotice("Cadastro salvo para este restaurante.");
      const account = await loadAccount(session.access_token);
      setProfile(account.profile); setHistory(account.history);
      if (account.profile) { setProfileName(account.profile.name); setProfileCpf(account.profile.cpf || ""); }
    } catch (reason) { setAuthError(reason instanceof Error ? reason.message : "Não foi possível salvar seu cadastro."); }
    finally { setAuthBusy(false); }
  }

  async function signOut() {
    if (!supabase) return;
    setAuthBusy(true); setAuthError("");
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setAuthError(signOutError.message);
    else { setAuthSession(null); setPhone(""); setNotice("Você saiu da sua conta."); }
    setAuthBusy(false);
  }

  async function sendTableRequest(type: "call_waiter" | "request_bill") {
    if (!token || !data?.tableOpen) return;
    setTableBusy(true); setTableNotice(""); setError("");
    try {
      const response = await fetch("/api/restaurant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "table-request", token, requestType: type }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "A equipe não recebeu a solicitação.");
      setTableNotice(type === "call_waiter" ? "Solicitação para chamar o garçom enviada à equipe." : "Solicitação de conta enviada à equipe.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "A equipe não recebeu a solicitação."); }
    finally { setTableBusy(false); }
  }

  async function openCustomerDocument(fiscalDocument: NonNullable<HistoryOrder["fiscalDocuments"]>[number], format: "pdf" | "xml") {
    if (!session?.access_token) { setAuthError("Confirme seu telefone para acessar o documento."); return; }
    const popup = format === "pdf" ? window.open("about:blank", "_blank") : null;
    if (popup) popup.opener = null;
    setDocumentBusy(fiscalDocument.id + ":" + format); setAuthError("");
    try {
      const response = await fetch("/api/restaurant?" + queryFor(token, slug, { document: "1", id: fiscalDocument.id, format }), {
        cache: "no-store", headers: { Authorization: "Bearer " + session.access_token },
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error || "Não foi possível abrir o documento fiscal.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (format === "pdf" && popup) {
        popup.location.replace(objectUrl);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } else {
        popup?.close();
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `${fiscalDocument.documentType}-${fiscalDocument.number || "documento"}.${format}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    } catch (reason) {
      popup?.close();
      setAuthError(reason instanceof Error ? reason.message : "Não foi possível abrir o documento fiscal.");
    } finally { setDocumentBusy(""); }
  }

  async function reorder(order: HistoryOrder) {
    if (!data || !profile) return;
    const nextCart: Record<string, CartLine> = {};
    const items: Array<{ productId: string; quantity: number; optionChoiceIds: string[] }> = [];
    const issues: ReorderIssue[] = [];
    let hadPromotion = false;
    for (const [index, old] of order.items.entries()) {
      const issueKey = `${index}:${old.product_id}`;
      if (old.selectedOptions?.length && !Array.isArray(old.selectedOptionIds)) {
        issues.push({ key: issueKey, description: old.description, reason: "Este pedido antigo não guarda os identificadores dos adicionais." }); continue;
      }
      const product = data.menu.find((item) => item.id === old.product_id);
      if (!product) { issues.push({ key: issueKey, description: old.description, reason: "Este produto não está mais no cardápio." }); continue; }
      if (!product.available) { issues.push({ key: issueKey, description: product.name, reason: product.availabilityMessage || "Este item está indisponível no momento." }); continue; }
      const ids = Array.isArray(old.selectedOptionIds) ? old.selectedOptionIds : [];
      const resolved = resolveMenuChoices(product.options, ids);
      if (!resolved.valid) { issues.push({ key: issueKey, description: product.name, reason: "Os adicionais deste produto mudaram. Confira as opções atuais." }); continue; }
      const key = cartKey(product.id, ids);
      nextCart[key] = { productId: product.id, quantity: Number(old.quantity), optionChoiceIds: ids };
      items.push({ productId: product.id, quantity: Number(old.quantity), optionChoiceIds: ids });
      hadPromotion = hadPromotion || Boolean(old.promotionSnapshot);
    }
    setCart(nextCart); setQuote(null); setSuccess(null);
    setError("");
    if (issues.length) {
      setReorderIssues(issues); setReorderIssueOrder(order.order_number);
      setNotice("O pedido antigo mudou. Escolha outros itens no cardápio ou remova cada item sinalizado para continuar.");
      window.setTimeout(() => document.getElementById("qr-reorder-review")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }), 0);
      return;
    }
    setReorderIssues([]); setReorderIssueOrder(null);
    await quoteItems(items, { number: order.order_number, total: Number(order.total), hadPromotion });
    window.setTimeout(() => document.getElementById("qr-checkout")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 0);
  }

  function removeReorderIssue(key: string) {
    const remaining = reorderIssues.filter((issue) => issue.key !== key);
    setReorderIssues(remaining);
    if (!remaining.length) setReorderIssueOrder(null);
    setError("");
    setNotice("Item antigo removido da repetição conforme sua escolha. Confira o carrinho e os preços atuais antes de enviar.");
  }

  const accent = data?.brandColor || "#1768d2";
  const pageStyle = { "--qr-accent": accent, "--qr-accent-contrast": readableAccent(accent), "--qr-accent-text": readableAccentText(accent) } as CSSProperties;
  const signedIn = Boolean(session?.access_token);
  return <main className={`${styles.qrPage} ${data?.mode === "website" ? styles.publicWebsite : styles.tableMenu}`} data-menu-mode={data?.mode || "loading"} style={pageStyle}>
    {loading ? <div className={styles.qrEmpty} role="status">Carregando cardápio…</div> : null}
    {error && !data ? <div className={styles.qrError} role="alert">{error}</div> : null}
    {data ? <>
      <header className={styles.qrBrand}>
        {data.coverUrl ? <Image className={styles.qrCover} src={data.coverUrl} alt="Capa do restaurante" width={1000} height={280} unoptimized/> : <div className={styles.qrCoverEmpty} aria-hidden="true"/>}
        <div className={styles.qrBrandContent}>
          {data.logoUrl ? <Image className={styles.qrLogo} src={data.logoUrl} alt={"Logo " + data.company} width={64} height={64} unoptimized/> : <span className={styles.qrBrandFallback}>{data.company.slice(0, 1).toUpperCase()}</span>}
          <div className={styles.qrPublicTop}><span className={styles.qrModeLabel}>{data.mode === "table" ? "Cardápio digital · " + data.table : "Cardápio do restaurante"}</span><h1>{data.company}</h1><p>{data.description || "Conheça o cardápio e escolha seus produtos."}</p>{data.mode === "website" ? <a className={styles.qrHeroCta} href="#qr-menu-heading">Explorar cardápio <span aria-hidden="true">↓</span></a> : null}</div>
          <div className={styles.qrWebsiteContact}>
            {data.address ? <span>{data.address}</span> : null}{data.mapUrl ? <a href={data.mapUrl} target="_blank" rel="noreferrer">Ver localização</a> : null}
            {data.contactPhone ? <a href={"tel:" + data.contactPhone.replace(/\D/g, "")}>{data.contactPhone}</a> : null}
            {data.whatsapp ? <a href={"https://wa.me/" + data.whatsapp.replace(/\D/g, "")} target="_blank" rel="noreferrer">WhatsApp</a> : null}
            {data.email ? <a href={"mailto:" + data.email}>E-mail</a> : null}{data.instagramUrl ? <a href={data.instagramUrl} target="_blank" rel="noreferrer">Instagram</a> : null}
            {data.websiteUrl ? <a href={data.websiteUrl} target="_blank" rel="noreferrer">Site</a> : null}
          </div>
          <details className={styles.qrHours}><summary>Horário de atendimento</summary><ul>{Object.entries(data.openingHours || {}).filter(([, hours]) => hours.open).map(([day, hours]) => <li key={day}>{days[day] || day}: {hours.from}–{hours.to}</li>)}</ul>{!Object.values(data.openingHours || {}).some((hours) => hours.open) ? <small>Horário não informado.</small> : null}</details>
        </div>
      </header>
      {error ? <div className={styles.qrError} role="alert">{error}</div> : null}
      {notice ? <div className={styles.qrNotice} role="status">{notice}</div> : null}
      {success ? <section className={styles.qrSuccess} role="status"><h2>Pedido recebido pela equipe</h2><p>Pedido <strong>#{success.number}</strong> · {statuses[success.status] || "Aguardando confirmação"}</p><p>Pagamento pendente no caixa. A equipe vai confirmar o pedido e encaminhar para preparo.</p><button type="button" className={styles.buttonGhost} onClick={() => setSuccess(null)}>Voltar ao cardápio</button></section> : null}

      <section className={styles.qrAccount} aria-labelledby="qr-account-title">
        <div className={styles.qrAccountHeading}><div><span>CONTA DO CLIENTE</span><h2 id="qr-account-title">Seus pedidos e dados</h2></div>{profile ? <button type="button" className={styles.buttonGhost} disabled={authBusy} onClick={() => void signOut()}>Sair</button> : null}</div>
        {!supabase ? <p className={styles.qrAuthMessage} role="alert">Autenticação por telefone indisponível: este ambiente ainda não está configurado para enviar SMS.</p> : null}
        {!signedIn ? <div className={styles.qrAuthForms}>
          {!otpSent ? <form className={styles.qrAuthForm} onSubmit={(event) => void requestCode(event)}><label>Telefone com DDD<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" required/></label><label>CPF<input value={profileCpf} onChange={(event) => setProfileCpf(event.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="11 dígitos" inputMode="numeric" autoComplete="off" minLength={11} maxLength={11} required/></label><p>Enviaremos um código por SMS. O CPF ajuda a localizar seu cadastro depois da confirmação do telefone; CPF sozinho não abre pedidos ou histórico. Usamos seus dados para a conta e o atendimento, nunca para marketing automático.</p><button type="submit" disabled={authBusy || !supabase}>{authBusy ? "Enviando código…" : "Confirmar telefone e consultar conta"}</button></form>
          : <form className={styles.qrAuthForm} onSubmit={(event) => void confirmCode(event)}><label>Código recebido por SMS<input value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" minLength={4} maxLength={10} required/></label><p>Enviado para {phone}. Se a mensagem não chegar, confira o provedor de SMS ou solicite outro código.</p><button type="submit" disabled={authBusy || !supabase}>{authBusy ? "Verificando…" : "Confirmar telefone"}</button><button type="button" className={styles.buttonGhost} disabled={authBusy} onClick={() => { setOtpSent(false); setOtp(""); }}>Trocar telefone</button></form>}
        </div> : accountLoading ? <p className={styles.qrAuthMessage} role="status">Consultando sua conta neste restaurante…</p>
        : profile && !editingProfile ? <div className={styles.qrProfile}><div><strong>{profile.name}</strong><span>{profile.phone}{profile.cpf ? " · CPF " + profile.cpf : ""}</span><small>O acesso é protegido pelo telefone confirmado. O histórico fica separado por restaurante.</small></div><button type="button" className={styles.buttonGhost} onClick={() => setEditingProfile(true)}>Editar cadastro</button></div>
        : <form className={styles.qrAuthForm} onSubmit={(event) => void saveProfile(event)}><p>{profile ? "Atualize os dados deste restaurante." : "Complete seu cadastro neste restaurante para enviar pedidos e consultar seu histórico."}</p><label>Nome completo<input value={profileName} onChange={(event) => setProfileName(event.target.value)} minLength={2} maxLength={120} autoComplete="name" required/></label><label>CPF<input value={profileCpf} onChange={(event) => setProfileCpf(event.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="11 dígitos" inputMode="numeric" autoComplete="off" minLength={11} maxLength={11} required={!profile?.cpf}/></label><p>O telefone foi confirmado por SMS. Usamos estes dados para identificar seus pedidos; marketing não é ativado.</p><button type="submit" disabled={authBusy}>{authBusy ? "Salvando…" : "Salvar cadastro"}</button>{profile ? <button type="button" className={styles.buttonGhost} onClick={() => setEditingProfile(false)}>Cancelar edição</button> : null}</form>}
        {authError ? <p className={styles.qrError} role="alert">{authError}</p> : null}
        {profile ? <div className={styles.qrHistory}><div className={styles.qrAccountHeading}><div><span>HISTÓRICO</span><h3>Pedidos recentes neste restaurante</h3></div><button type="button" className={styles.buttonGhost} disabled={accountLoading} onClick={() => session?.access_token ? void loadAccount(session.access_token) : undefined}>Atualizar</button></div>
          {history.length ? history.map((order) => <article className={styles.qrHistoryCard} key={order.id}><div className={styles.qrHistoryTop}><strong>Pedido #{order.order_number}</strong><span>{statuses[order.status] || order.status}</span></div><small>{new Date(order.created_at).toLocaleString("pt-BR")} · {order.fulfillment_type === "pickup" ? "Retirada" : "Mesa"} · {order.payment_status === "paid" ? "Pagamento registrado no caixa" : order.payment_status === "pending" ? "Pagamento pendente no caixa" : "Pagamento não informado"}</small><ul>{order.items.map((item, index) => <li key={item.product_id + ":" + index}>{item.quantity} × {item.description}{item.selectedOptions?.length ? " · " + item.selectedOptions.map((option) => option.name).join(", ") : ""}</li>)}</ul>{order.fiscalDocuments?.length ? <div className={styles.qrCustomerDocuments}><strong>Documento fiscal disponível por 30 dias</strong>{order.fiscalDocuments.map((fiscalDocument) => <div key={fiscalDocument.id}><span>{fiscalDocument.documentType.toUpperCase()} {fiscalDocument.number || ""}{fiscalDocument.series ? " · Série " + fiscalDocument.series : ""}</span><div>{fiscalDocument.formats.includes("pdf") ? <button type="button" className={styles.buttonGhost} disabled={Boolean(documentBusy)} onClick={() => void openCustomerDocument(fiscalDocument, "pdf")}>{documentBusy === fiscalDocument.id + ":pdf" ? "Abrindo PDF…" : "Visualizar PDF"}</button> : null}{fiscalDocument.formats.includes("xml") ? <button type="button" className={styles.buttonGhost} disabled={Boolean(documentBusy)} onClick={() => void openCustomerDocument(fiscalDocument, "xml")}>{documentBusy === fiscalDocument.id + ":xml" ? "Baixando XML…" : "Baixar XML"}</button> : null}</div><small>Disponível até {new Date(fiscalDocument.availableUntil).toLocaleDateString("pt-BR")}.</small></div>)}</div> : null}<div className={styles.qrHistoryBottom}><strong>{money(order.total)}</strong><button type="button" className={styles.buttonGhost} onClick={() => void reorder(order)}>Pedir novamente</button></div></article>) : <p className={styles.qrEmpty}>Você ainda não tem pedidos neste restaurante.</p>}
        </div> : null}
      </section>

      {data.mode === "table" ? <section className={styles.qrTableActions}><span>{data.tableOpen ? "Atendimento da mesa aberto" : "Mesa fechada no momento"}</span><div><button type="button" className={styles.buttonGhost} disabled={!data.tableOpen || tableBusy} onClick={() => void sendTableRequest("call_waiter")}>Chamar garçom</button><button type="button" className={styles.buttonGhost} disabled={!data.tableOpen || tableBusy} onClick={() => void sendTableRequest("request_bill")}>Pedir a conta</button></div>{tableNotice ? <p role="status">{tableNotice}</p> : null}</section> : null}
      {!data.tableOpen && data.mode === "table" ? <div className={styles.qrEmpty}>A mesa está fechada no momento. Peça à equipe para abrir o atendimento.</div> : null}
      {data.mode === "website" && !data.onlineOrdersEnabled ? <div className={styles.qrEmpty}>Cardápio disponível para consulta. O restaurante ainda não habilitou pedidos pelo site.</div> : null}

      {reorderIssues.length ? <section id="qr-reorder-review" className={styles.qrReorderReview} aria-labelledby="qr-reorder-title"><div><span>REVISÃO NECESSÁRIA</span><h2 id="qr-reorder-title">Pedido #{reorderIssueOrder} mudou</h2><p>Nenhum item foi removido sem sua escolha. Selecione um substituto no cardápio ou remova cada item abaixo.</p></div>{reorderIssues.map((issue) => <article key={issue.key}><div><strong>{issue.description}</strong><small>{issue.reason}</small></div><div><button type="button" className={styles.buttonGhost} onClick={() => { setSearch(""); document.getElementById("qr-menu-heading")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }}>Ver cardápio</button><button type="button" className={styles.buttonDanger} onClick={() => removeReorderIssue(issue.key)}>Remover este item da repetição</button></div></article>)}</section> : null}

      <div className={styles.qrMenuHeading} id="qr-menu-heading"><div><span>MENU</span><h2>Escolha seus itens</h2></div><label className={styles.qrSearch}>Buscar no cardápio<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome do produto"/></label></div>
      <nav className={styles.qrCategories} aria-label="Categorias do cardápio"><button type="button" className={category === "all" ? styles.qrCategoryActive : ""} onClick={() => setCategory("all")}>Todos</button>{data.categories.filter((item) => item.active).map((item) => <button type="button" key={item.id} className={category === item.name ? styles.qrCategoryActive : ""} onClick={() => setCategory(item.name)}>{item.name}</button>)}</nav>
      <section className={styles.qrMenu} aria-label="Produtos do cardápio">
        {visibleMenu.map((product) => <article className={styles.qrProduct + (!product.available ? " " + styles.qrProductUnavailable : "")} key={product.id}>
          {product.image_url ? <Image className={styles.qrProductPhoto} src={product.image_url} alt={product.name} width={720} height={480} unoptimized/> : <div className={styles.qrProductPhotoEmpty} aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><rect x="6.5" y="8" width="35" height="32" rx="5"/><circle cx="18" cy="19" r="3.5"/><path d="m9 35 10-10 7 6 5-5 8 9"/></svg></div>}
          <div className={styles.qrProductBody}><div className={styles.qrProductMeta}>{product.is_combo ? <span>Combo</span> : product.category ? <span>{product.category}</span> : <span>{product.unit}</span>}{product.promotion ? <b>{product.promotion.label}</b> : null}{!product.available ? <b className={styles.qrUnavailableBadge}>Indisponível</b> : null}</div><h3>{product.name}</h3>{product.description ? <p>{product.description}</p> : null}
            {product.is_combo && product.combo_components.length ? <ul className={styles.qrCombo}>{product.combo_components.map((component) => <li key={component.product_id}>{component.quantity} × {component.name}</li>)}</ul> : null}
            <div className={styles.qrProductPrice}>{product.promotion ? <del>{money(product.base_price)}</del> : null}<strong>{money(product.sale_price)}</strong></div>
            {!product.available ? <p className={styles.qrAvailabilityText}>{product.availabilityMessage || "Indisponível no momento."}</p> : product.options.length && customizing === product.id ? <div className={styles.qrOptions}>{product.options.map((group) => <fieldset key={group.id}><legend>{group.name} <small>Escolha {group.min === group.max ? group.min : group.min + "–" + group.max}</small></legend>{group.choices.map((choice) => <label key={choice.id}><input type={group.max === 1 ? "radio" : "checkbox"} name={product.id + "-" + group.id} checked={(optionsByProduct[product.id] || []).includes(choice.id)} onChange={() => toggleOption(product, group, choice.id)}/><span>{choice.name}</span>{choice.price ? <b>+ {money(choice.price)}</b> : null}</label>)}</fieldset>)}<div className={styles.qrOptionActions}><button type="button" className={styles.buttonGhost} onClick={() => setCustomizing("")}>Voltar</button><button type="button" onClick={() => addItem(product, optionsByProduct[product.id] || [])}>Adicionar · {money(product.sale_price + resolveMenuChoices(product.options, optionsByProduct[product.id] || []).extraPrice)}</button></div></div> : <button className={styles.qrAddButton} type="button" disabled={!canOrder || !product.available} aria-label={product.options.length ? "Personalizar " + product.name : "Adicionar " + product.name} onClick={() => product.options.length ? setCustomizing(product.id) : addItem(product)}>{!canOrder ? "Pedidos indisponíveis" : product.options.length ? "Personalizar" : "+ Adicionar"}</button>}
          </div>
        </article>)}
        {!visibleMenu.length ? <div className={styles.qrEmpty}>Nenhum item encontrado nesta categoria.</div> : null}
      </section>

      {cartItems.length && canOrder ? <button type="button" className={styles.qrFloatingCart} onClick={() => document.getElementById("qr-checkout")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" })} aria-label={`Ver pedido com ${cartItems.length} item(ns), total ${money(quote?.total ?? cartTotal)}`}><span>Ver pedido · {cartItems.length} item(ns)</span><strong>{money(quote?.total ?? cartTotal)}</strong></button> : null}
      {cartItems.length && canOrder ? <form id="qr-checkout" className={styles.qrCheckout} onSubmit={(event) => void submitOrder(event)}>
        <div className={styles.qrCheckoutTitle}><div><span>SEU PEDIDO</span><h2>Confira os itens</h2></div><b>{cartItems.length} item(ns)</b></div>
        {cartItems.map((item) => { const product = productFor(item)!; const chosen = resolveMenuChoices(product.options, item.optionChoiceIds).selected; return <div className={styles.qrCartRow} key={item.key}><div><strong>{product.name}</strong><small>{chosen.length ? chosen.map((option) => option.name).join(" · ") : "Sem adicionais"}</small><span>{item.quantity} × {money(linePrice(item))}</span></div><div className={styles.qrQuantity}><button className={styles.buttonGhost} type="button" aria-label={"Remover uma unidade de " + product.name} onClick={() => changeQuantity(item, -1)}>−</button><b>{item.quantity}</b><button className={styles.buttonGhost} type="button" aria-label={"Adicionar uma unidade de " + product.name} onClick={() => changeQuantity(item, 1)}>+</button><strong>{money(linePrice(item) * item.quantity)}</strong></div></div>; })}
        <div className={styles.qrTotals}><span>Total do pedido</span><strong>{money(quote?.total ?? cartTotal)}</strong></div>
        <label>Observação para a cozinha (opcional)<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Ex.: sem cebola"/></label>
        <p className={styles.qrNotice}>Retirada no restaurante. Pagamento no caixa; o pedido fica pendente até a equipe registrar o recebimento. Pix online não está disponível neste restaurante.</p>
        {!profile ? <p className={styles.qrAuthMessage}>Entre na sua conta e complete o cadastro acima para enviar o pedido.</p> : null}
        {quote?.orderNumber ? <p className={styles.qrAuthMessage}>Repetindo o pedido #{quote.orderNumber}. {quote.promoChanged ? "A promoção mudou; confirme o preço atual." : "Confira os dados atuais antes de enviar."}</p> : null}
        {!quote ? <button type="button" disabled={quoteBusy || !profile || !session?.access_token} onClick={() => void quoteCart()}>{quoteBusy ? "Conferindo preço e estoque…" : "Conferir preço e disponibilidade"}</button> : <><button type="submit" disabled={sending || quoteBusy || !profile}>{sending ? "Enviando pedido…" : "Confirmar pedido · " + money(quote.total)}</button><button type="button" className={styles.buttonGhost} disabled={sending || quoteBusy} onClick={() => void quoteCart()}>Conferir novamente</button></>}
      </form> : cartItems.length && !canOrder ? <div className={styles.qrEmpty}>O restaurante não está aceitando pedidos neste canal.</div> : null}
    </> : null}
  </main>;
}
