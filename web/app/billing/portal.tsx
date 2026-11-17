"use client";

import { useEffect, useState } from "react";
import styles from "./portal.module.css";

type Charge = { id: string; description: string; amountMinor: number; dueAt: string; status: string; paymentMethod: string; boletoUrl: string | null; boletoLine: string | null; pixCopyPaste: string | null; pixQrUrl: string | null; paymentReportedAt: string | null; temporaryAccessUntil: string | null; paidAt: string | null };
type BillingData = { companyName: string; financeWhatsapp: string | null; subscription: { planName: string; status: string; endsAt: string | null; gracePeriodDays: number; graceEndsAt: string | null; temporaryAccessUntil: string | null; accessAllowed: boolean } | null; charges: Charge[] };
const statusLabels: Record<string,string> = { open: "Em aberto", overdue: "Vencida", payment_reported: "Pagamento informado", paid: "Paga", canceled: "Cancelada" };
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(value)) : "—";
const money = (minor: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(minor / 100);

export function BillingPortal() {
  const [data, setData] = useState<BillingData | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  async function refresh() {
    const response = await fetch("/api/billing", { cache: "no-store" });
    const payload = await response.json() as BillingData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as cobranças.");
    setData(payload);
  }
  useEffect(() => { void refresh().catch((error: Error) => setNotice(error.message)); }, []);
  async function reportPaid(chargeId: string) {
    setBusy(chargeId); setNotice("");
    try {
      const response = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "paid_notice", chargeId }) });
      const result = await response.json() as { error?: string; temporaryAccessUntil?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível registrar o aviso.");
      setNotice(`Pagamento informado. O acesso temporário fica disponível até ${date(result.temporaryAccessUntil)} enquanto a equipe financeira confere a compensação.`);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível informar o pagamento."); }
    finally { setBusy(""); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Código Pix copiado."); }
    catch { setNotice("Não foi possível copiar automaticamente. Selecione e copie o código Pix exibido."); }
  }

  return <main className={styles.page}><header className={styles.header}><a href="/erp/index.html" className={styles.brand}><span className={styles.mark}>S</span><span><b>SigmaFiscal</b><small>Área financeira da empresa</small></span></a><a className={styles.back} href="/erp/index.html">Voltar ao ERP</a></header><section className={styles.main}><p className={styles.kicker}>ASSINATURA E PAGAMENTOS</p><h1>{data?.companyName ? `Cobranças de ${data.companyName}` : "Cobranças da empresa"}</h1><p className={styles.lead}>Consulte vencimentos, acesse boleto ou Pix e informe quando já tiver feito o pagamento.</p>{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {data?.subscription ? <section className={styles.subscription}><div><span>PLANO ATUAL</span><h2>{data.subscription.planName}</h2><p>{data.subscription.accessAllowed ? "Acesso liberado" : "Acesso suspenso"} · vencimento {date(data.subscription.endsAt)}</p></div>{data.subscription.temporaryAccessUntil ? <div className={styles.temporary}><b>Acesso temporário</b><span>até {date(data.subscription.temporaryAccessUntil)}</span></div> : data.subscription.graceEndsAt && !data.subscription.accessAllowed ? <div className={styles.temporary}><b>Período de tolerância</b><span>até {date(data.subscription.graceEndsAt)}</span></div> : null}</section> : null}
    <div className={styles.sectionHead}><div><h2>Faturas e cobranças</h2><p>O acesso é reativado após a equipe confirmar o pagamento ou informar a compensação.</p></div></div>
    <div className={styles.charges}>{data?.charges.map((charge)=><article className={styles.charge} key={charge.id}><div className={styles.chargeHead}><div><span className={styles.ref}>{charge.paymentMethod === "pix" ? "PIX" : charge.paymentMethod === "boleto" ? "BOLETO" : "COBRANÇA"}</span><h3>{charge.description}</h3><p>Vencimento: <b>{date(charge.dueAt)}</b></p></div><span className={`${styles.status} ${styles[charge.status] || ""}`}>{statusLabels[charge.status] || charge.status}</span></div><div className={styles.amount}>{money(charge.amountMinor)}</div>
      {charge.paymentMethod === "boleto" ? <div className={styles.paymentData}>{charge.boletoUrl ? <a className={styles.primary} href={charge.boletoUrl} target="_blank" rel="noreferrer">Abrir / segunda via do boleto</a> : <p>A segunda via ainda não foi cadastrada. Fale com a equipe financeira.</p>}{charge.boletoLine ? <div><label>Linha digitável</label><code>{charge.boletoLine}</code></div> : null}</div> : null}
      {charge.paymentMethod === "pix" ? <div className={styles.paymentData}>{charge.pixQrUrl ? <a className={styles.primary} href={charge.pixQrUrl} target="_blank" rel="noreferrer">Abrir QR Code Pix</a> : null}{charge.pixCopyPaste ? <div><label>Pix copia e cola</label><code>{charge.pixCopyPaste}</code><button className={styles.secondary} onClick={()=>void copy(charge.pixCopyPaste || "")}>Copiar código Pix</button></div> : !charge.pixQrUrl ? <p>Os dados Pix ainda não foram cadastrados. Fale com a equipe financeira.</p> : null}</div> : null}
      {charge.status === "payment_reported" ? <div className={styles.paymentNote}>Pagamento informado em {date(charge.paymentReportedAt)}. A equipe financeira está verificando a compensação. {charge.temporaryAccessUntil ? `Acesso temporário até ${date(charge.temporaryAccessUntil)}.` : ""}</div> : null}
      {charge.status === "paid" ? <div className={styles.paid}>Pagamento confirmado em {date(charge.paidAt)}.</div> : charge.status !== "canceled" && charge.status !== "payment_reported" ? <div className={styles.chargeActions}><button className={styles.secondary} disabled={busy === charge.id} onClick={()=>void reportPaid(charge.id)}>{busy===charge.id ? "Registrando…" : "Já paguei"}</button>{data?.financeWhatsapp ? <a className={styles.whatsapp} href={`${data.financeWhatsapp}?text=${encodeURIComponent(`Olá, preciso de ajuda com a cobrança ${charge.description}.`)}`} target="_blank" rel="noreferrer">Falar com equipe financeira</a> : <span className={styles.supportMissing}>Canal financeiro ainda não configurado</span>}</div> : null}
      {charge.status === "payment_reported" && data?.financeWhatsapp ? <a className={styles.whatsapp} href={`${data.financeWhatsapp}?text=${encodeURIComponent(`Olá, informei o pagamento da cobrança ${charge.description} e preciso confirmar a compensação.`)}`} target="_blank" rel="noreferrer">Falar com equipe financeira</a> : null}
    </article>)}</div>{data && data.charges.length === 0 ? <div className={styles.empty}>Não há cobranças cadastradas para esta empresa. Se sua assinatura estiver suspensa, fale com a equipe financeira.</div> : null}<p className={styles.footnote}>Ao informar um pagamento, o sistema libera até 48 horas para conferência. Essa ação não confirma a compensação bancária; se ela não for identificada dentro do prazo, o acesso será suspenso novamente.</p></section></main>;
}
