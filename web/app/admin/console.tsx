"use client";

import { useEffect, useMemo, useState } from "react";

type DocumentItem = { code: string; status: string; note: string };
type Company = {
  id: string;
  legalName: string;
  tradeName: string;
  cnpj: string;
  license: { planCode: string; planName: string; status: string; startsAt: string | null; endsAt: string | null };
  focus: { configured: boolean; hint: string };
  documents: DocumentItem[];
};
type Catalog = { code: string; label?: string; name?: string; days?: number };

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa", trialing: "Aguardando liberação", paused: "Suspensa", canceled: "Encerrada",
  past_due: "Em atraso", incomplete: "Sem licença",
};
const DOC_STATUS = [
  ["pending", "Pendente"], ["received", "Recebido"], ["approved", "Aprovado"], ["rejected", "Recusado"],
];

function dateLabel(value: string | null) {
  if (!value) return "Sem vencimento";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

export function AdminConsole({ name }: { name: string }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Catalog[]>([]);
  const [documents, setDocuments] = useState<Catalog[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Carregando empresas...");
  const [needsMigration, setNeedsMigration] = useState(false);
  const [busy, setBusy] = useState("");

  async function load() {
    const response = await fetch("/api/admin/licenses", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível carregar as licenças.");
    setNeedsMigration(Boolean(data.needsMigration));
    setCompanies(data.companies || []);
    setPlans(data.plans || []);
    setDocuments(data.documents || []);
    setMessage(data.needsMigration ? "Falta aplicar a migration de licenças no Supabase." : "");
  }

  useEffect(() => { load().catch((error: Error) => setMessage(error.message)); }, []);

  async function send(companyId: string, body: Record<string, unknown>) {
    setBusy(companyId);
    try {
      const response = await fetch("/api/admin/licenses", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      await load();
      setMessage("Salvo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally { setBusy(""); }
  }

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return companies;
    return companies.filter((company) => `${company.legalName} ${company.tradeName} ${company.cnpj}`.toLowerCase().includes(term));
  }, [companies, query]);

  return (
    <main style={{ minHeight: "100vh", background: "#f4f7fb", color: "#172033", fontFamily: "system-ui,sans-serif", padding: "28px 16px 48px" }}>
      <section style={{ maxWidth: 980, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, color: "#1769d2", fontWeight: 700, letterSpacing: ".04em", fontSize: 12 }}>ADMINISTRAÇÃO</p>
            <h1 style={{ margin: "6px 0 0", fontSize: 28 }}>Licenças dos clientes</h1>
            <p style={{ margin: "8px 0 0", color: "#5c6b80" }}>Olá, {name}. O cliente cria a conta. Aqui você confere os documentos, grava o token da Focus e libera o plano.</p>
          </div>
          <a href="/logout" style={{ color: "#1769d2", fontWeight: 700 }}>Sair</a>
        </header>
        {message ? <p role="status" style={{ background: "#fff", border: "1px solid #d9e2ec", borderRadius: 12, padding: 12 }}>{message}</p> : null}
        <label style={{ display: "block", margin: "16px 0" }}>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>Buscar empresa</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou CNPJ" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d5deea", borderRadius: 12, padding: "12px 14px", font: "inherit" }} />
        </label>
        {needsMigration ? <p>No Supabase, execute o arquivo supabase/migrations/20261116_jvg_client_licenses.sql e atualize esta página.</p> : null}
        <div style={{ display: "grid", gap: 14 }}>
          {visible.map((company) => (
            <article key={`${company.id}-${company.license.status}-${company.license.endsAt || ""}-${company.focus.hint}-${company.documents.map((item) => item.status + item.note).join("|")}`} style={{ background: "#fff", border: "1px solid #d9e2ec", borderRadius: 16, padding: 16 }}>
              <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>{company.tradeName || company.legalName}</h2>
                  <p style={{ margin: "4px 0 0", color: "#5c6b80" }}>{company.legalName}{company.cnpj ? ` · ${company.cnpj}` : ""}</p>
                </div>
                <strong>{STATUS_LABEL[company.license.status] || company.license.status} · {company.license.planName}</strong>
              </header>
              <p style={{ color: "#5c6b80" }}>Vigência até {dateLabel(company.license.endsAt)}</p>
              <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void send(company.id, { action: "activate", planCode: data.get("planCode") }); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select name="planCode" defaultValue={plans.some((plan) => plan.code === company.license.planCode) ? company.license.planCode : plans[0]?.code} aria-label="Plano" style={{ flex: "1 1 180px", minHeight: 42, borderRadius: 10, border: "1px solid #d5deea", padding: "0 10px" }}>
                  {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {plan.days} dias</option>)}
                </select>
                <button disabled={busy === company.id} style={buttonStyle}>Liberar</button>
                <button type="button" disabled={busy === company.id} onClick={() => void send(company.id, { action: "pause" })} style={quietButton}>Suspender</button>
                <button type="button" disabled={busy === company.id} onClick={() => void send(company.id, { action: "cancel" })} style={quietButton}>Encerrar</button>
              </form>
              <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void send(company.id, { action: "token", token: data.get("token") }); }} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <input name="token" type="password" autoComplete="off" placeholder={company.focus.configured ? `Token salvo · final ${company.focus.hint}` : "Token da Focus desta empresa"} aria-label="Token da Focus" style={{ flex: "1 1 240px", minHeight: 42, borderRadius: 10, border: "1px solid #d5deea", padding: "0 10px" }} />
                <button disabled={busy === company.id} style={buttonStyle}>Salvar token</button>
              </form>
              <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                {company.documents.map((item) => {
                  const label = documents.find((entry) => entry.code === item.code)?.label || item.code;
                  return (
                    <form className="doc-row" key={item.code} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void send(company.id, { action: "document", documentCode: item.code, status: data.get("status"), note: data.get("note") }); }}>
                      <strong style={{ alignSelf: "center" }}>{label}</strong>
                      <select name="status" defaultValue={item.status} aria-label={`Situação de ${label}`} style={{ minHeight: 40, borderRadius: 10, border: "1px solid #d5deea" }}>
                        {DOC_STATUS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                      </select>
                      <input name="note" defaultValue={item.note} placeholder="Observação" aria-label={`Observação de ${label}`} style={{ minHeight: 40, borderRadius: 10, border: "1px solid #d5deea", padding: "0 10px" }} />
                      <button disabled={busy === company.id} style={quietButton}>Salvar</button>
                    </form>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </section>
      <style>{`.doc-row{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(120px,.6fr) minmax(0,1fr) auto;gap:8px}@media(max-width:720px){.doc-row{grid-template-columns:1fr}}`}</style>
    </main>
  );
}

const buttonStyle = { minHeight: 42, border: 0, borderRadius: 10, background: "#1769d2", color: "#fff", fontWeight: 700, padding: "0 14px" };
const quietButton = { minHeight: 42, border: "1px solid #d5deea", borderRadius: 10, background: "#fff", color: "#172033", fontWeight: 700, padding: "0 12px" };
