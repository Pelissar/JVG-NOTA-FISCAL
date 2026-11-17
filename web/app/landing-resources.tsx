"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BUSINESS_TYPES } from "../lib/business-types";
import styles from "./landing-resources.module.css";
import overrides from "./landing-resources-overrides.module.css";

type Plan = { code: string; name: string; description: string; interval: string; amountMinor: number | null; businessTypes: string[] };
type Publication = { id: string; content_type: string; title: string; summary: string; body: string; published_at: string };
type PublicData = { plans: Plan[]; content: Publication[] };
const intervalNames: Record<string,string> = { month: "mês", quarter: "trimestre", semester: "semestre", year: "ano" };
const money = (value: number | null) => value == null ? "Sob consulta" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value/100);

export function LandingResources() {
  const [data, setData] = useState<PublicData>({ plans: [], content: [] });
  const [message, setMessage] = useState("");
  const [caseCode, setCaseCode] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch("/api/public/content", { cache: "no-store" });
      if (!response.ok) return;
      const value = await response.json() as PublicData;
      if (active) setData(value);
    })().catch(() => {});
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setCaseCode(""); setWhatsapp("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, consent: values.consent === "on" }) });
      const result = await response.json() as { error?: string; caseCode?: string; whatsapp?: string | null };
      if (!response.ok) throw new Error(result.error || "Não foi possível registrar a solicitação.");
      setCaseCode(result.caseCode || ""); setWhatsapp(result.whatsapp || ""); setMessage("Solicitação recebida. Nossa equipe comercial entrará em contato."); form.reset();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível enviar a solicitação."); }
    finally { setBusy(false); }
  }
  return <div className={overrides.landingOverrides}>
    {data.plans.length ? <section className={styles.section} id="planos"><div className={styles.inner}><div className={styles.heading}><div><span>PLANOS DO SIGMAFISCAL</span><h2>Uma estrutura que acompanha sua operação.</h2></div><p>Selecione seu segmento no pedido de contato. Nossa equipe confirma módulos, implantação e valores.</p></div><div className={styles.planGrid}>{data.plans.map((plan)=><article className={styles.plan} key={plan.code}><span className={styles.segment}>{plan.businessTypes.slice(0,3).join(" · ") || "Para sua empresa"}</span><h3>{plan.name}</h3><p>{plan.description}</p><strong>{money(plan.amountMinor)}<small> / {intervalNames[plan.interval] || plan.interval}</small></strong><a href="#solicitar">Solicitar contato</a></article>)}</div></div></section> : null}
    {data.content.length ? <section className={`${styles.section} ${styles.updates}`} id="novidades"><div className={styles.inner}><div className={styles.heading}><div><span>CONTEÚDO E ATUALIZAÇÕES</span><h2>Novidades do sistema e do ambiente fiscal.</h2></div><p>Publicações aprovadas pela equipe SigmaFiscal.</p></div><div className={styles.contentGrid}>{data.content.map((item)=><article className={styles.contentCard} key={item.id}><span>{item.content_type === "changelog" ? "ATUALIZAÇÃO DO SISTEMA" : "ARTIGO"} · {new Intl.DateTimeFormat("pt-BR",{dateStyle:"medium"}).format(new Date(item.published_at))}</span><h3>{item.title}</h3><p>{item.summary}</p>{item.body ? <details><summary>Ler conteúdo</summary><div>{item.body}</div></details> : null}</article>)}</div></div></section> : null}
    <section className={styles.section} id="solicitar"><div className={`${styles.inner} ${styles.leadLayout}`}><div><span className={styles.kicker}>FALE COM NOSSA EQUIPE</span><h2>Solicite uma apresentação para sua empresa.</h2><p>Envie seus dados e indique o segmento. A solicitação gera um número de atendimento; a equipe comercial entra em contato para avaliar as necessidades e o plano adequado.</p><ul><li>Comércio, tecnologia e assistência técnica</li><li>Restaurantes, mercados e farmácias</li><li>Distribuição, indústria, logística e serviços</li></ul><p className={styles.disclaimer}>A solicitação não cria uma assinatura nem inicia cobrança. O acesso é ativado após análise e liberação da equipe.</p></div><form className={styles.form} onSubmit={submit}><h3>Solicitar contato</h3><div className={styles.formGrid}><label>Empresa<input name="companyName" required minLength={2} maxLength={160}/></label><label>Responsável<input name="contactName" required minLength={2} maxLength={120}/></label><label>E-mail<input type="email" name="email" required maxLength={254}/></label><label>CNPJ<input name="cnpj" inputMode="text" autoCapitalize="characters" required placeholder="14 caracteres" maxLength={18}/></label><label>Telefone com DDD<input name="phone" inputMode="tel" required placeholder="(00) 00000-0000" maxLength={24}/></label><label>Segmento<select name="businessType" required defaultValue=""><option value="" disabled>Selecione a atividade</option>{BUSINESS_TYPES.map((item)=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label className={styles.full}>O que sua empresa precisa?<textarea name="message" rows={3} maxLength={2000} placeholder="Conte brevemente quais módulos ou operação deseja organizar."/></label><label className={styles.consent}><input name="consent" type="checkbox" required/>Autorizo contato da equipe sobre esta solicitação.</label><label className={styles.honeypot} aria-hidden="true">Site<input name="website" tabIndex={-1} autoComplete="off"/></label></div><button disabled={busy}>{busy ? "Enviando…" : "Enviar solicitação"}</button>{message ? <p className={styles.feedback} role="status">{message}{caseCode ? <><br/><b>Protocolo: {caseCode}</b></> : null}{whatsapp ? <><br/><a href={whatsapp} target="_blank" rel="noreferrer">Continuar pelo WhatsApp</a></> : null}</p> : null}</form></div></section>
  </div>;
}
