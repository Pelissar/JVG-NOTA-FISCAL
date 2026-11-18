"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BUSINESS_TYPES } from "../../lib/business-types";
import { PLATFORM_MODULES } from "../../lib/platform-modules";
import styles from "./console.module.css";
import overrides from "./console-overrides.module.css";

type AdminCompany = {
  id: string; tenantId: string; legalName: string; tradeName: string; cnpj: string;
  businessType: string; status: string; accessStatus: string;
  subscription: { id: string; planCode: string; planName: string; status: string; startsAt: string | null; endsAt: string | null; temporaryAccessUntil: string | null; gracePeriodDays: number } | null;
  moduleAccess: Array<{ key: string; label: string; enabled: boolean; origin: string; source: string | null; note: string }>;
  fiscalUsage: Record<string, number> | null;
  charges: Array<{ id: string; description: string; amount_minor: number; due_at: string; status: string; payment_method: string }>;
  documents: Array<{ document_code: string; status: string; note?: string }>;
  invites: Array<{ id: string; email: string; display_name: string; role: string; status: string }>;
};
type Plan = { code: string; name: string; description: string; billing_interval: string; amount_minor: number | null; active: boolean; is_public: boolean; grace_period_days: number; enabled_business_types: string[]; max_users: number | null; max_companies: number | null; sort_order: number; modules: Record<string, boolean>; subscriber_count: number };
type Application = { id: string; case_code: string; company_name: string; contact_name: string; email: string; cnpj: string; phone: string; business_type: string; message: string; status: string; admin_note: string; linked_company_id: string | null; assigned_admin_id: string | null; assigned_admin_name: string; history: Array<Record<string, unknown>>; created_at: string; updated_at?: string };
type Charge = { id: string; company_id: string; company_name: string; description: string; amount_minor: number; due_at: string; status: string; payment_method: string; boleto_url: string | null; boleto_line: string | null; pix_copy_paste: string | null; pix_qr_url: string | null; manually_confirmed_by?: string | null; manual_confirmation_note?: string };
type Content = { id: string; content_type: string; slug: string; title: string; summary: string; body: string; status: string; published_at: string | null };
type Invite = { id: string; company_id: string; email: string; display_name: string; role: string; status: string };
type Data = { companies: AdminCompany[]; plans: Plan[]; applications: Application[]; charges: Charge[]; content: Content[]; invites: Invite[]; platformAdmins: Array<{ email: string; user_id: string; active: boolean }>; recentActivity: Array<Record<string, unknown>>; fiscalMetrics: Record<string, unknown> | null; moduleInventory: typeof PLATFORM_MODULES; capabilities: { moduleOverrides: boolean; requestHistory: boolean; paymentAudit: boolean; fiscalMetrics: boolean; auditLog: boolean }; summary: { companies: number; activeCompanies: number; suspendedCompanies: number; pendingApplications: number; activeSubscriptions: number; expiredSubscriptions: number; openCharges: number } };

const nav = [["overview", "Visão geral"], ["application_manager", "Solicitações"], ["companies", "Empresas"], ["billing", "Cobranças"], ["plans", "Planos"], ["team", "Equipe"], ["content", "Conteúdo"]] as const;
type Section = (typeof nav)[number][0];
const roleNames: Record<string, string> = { technician: "Técnico", commercial: "Comercial", accounting: "Contabilidade" };
const statusNames: Record<string, string> = { new: "Nova", contacted: "Em contato", approved: "Aprovada", closed: "Encerrada", open: "Em aberto", overdue: "Vencida", payment_reported: "Pagamento informado", paid: "Paga", canceled: "Cancelada", active: "Ativa", pilot: "Piloto", paused: "Suspensa", suspended: "Suspensa", canceled_subscription: "Encerrada", trialing: "Aguardando liberação", incomplete: "Incompleta", unknown: "Indisponível", draft: "Rascunho", published: "Publicado", archived: "Arquivado", invited: "Convite enviado" };
const intervalNames: Record<string, string> = { month: "Mensal", quarter: "Trimestral", semester: "Semestral", year: "Anual" };
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value)) : "—";
const money = (minor?: number | null) => minor == null ? "Sob consulta" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(minor / 100);
const typeLabel = (code: string) => BUSINESS_TYPES.find((item) => item.code === code)?.label || "Outro segmento";
const emptyData: Data = { companies: [], plans: [], applications: [], charges: [], content: [], invites: [], platformAdmins: [], recentActivity: [], fiscalMetrics: null, moduleInventory: PLATFORM_MODULES, capabilities: { moduleOverrides: false, requestHistory: false, paymentAudit: false, fiscalMetrics: false, auditLog: false }, summary: { companies: 0, activeCompanies: 0, suspendedCompanies: 0, pendingApplications: 0, activeSubscriptions: 0, expiredSubscriptions: 0, openCharges: 0 } };

export function AdminConsole({ name }: { name: string }) {
  const [data, setData] = useState<Data>(emptyData);
  const [section, setSection] = useState<Section>("overview");
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [subscriptionFilter, setSubscriptionFilter] = useState("");
  const [accessFilter, setAccessFilter] = useState("");
  const [fiscalCompanyId, setFiscalCompanyId] = useState("");
  const [fiscalFrom, setFiscalFrom] = useState("");
  const [fiscalTo, setFiscalTo] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [editingContent, setEditingContent] = useState<Content | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const params = new URLSearchParams();
      if (fiscalCompanyId) params.set("companyId", fiscalCompanyId);
      if (fiscalFrom) params.set("from", fiscalFrom);
      if (fiscalTo) params.set("to", fiscalTo);
      const response = await fetch(`/api/admin/platform${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os dados administrativos.");
      setData(payload); setLoaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao consultar o painel administrativo.";
      setLoadError(message); throw error;
    } finally { setLoading(false); }
  }, [fiscalCompanyId, fiscalFrom, fiscalTo]);
  // Initial data load is asynchronous; refresh owns loading and error state for the request.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh().catch((error: Error) => setNotice(error.message)); }, [refresh]);

  async function mutate(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; changed?: { enabled?: boolean }; moduleChanges?: Array<{ module: string }>; subscribersAffected?: number; manualConfirmation?: boolean; confirmedBy?: string | null; after?: Record<string, unknown>; historyAvailable?: boolean };
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar.");
      let successMessage = "Alteração salva.";
      if (result.changed) successMessage = `Módulo ${result.changed.enabled ? "liberado" : "desativado"} para a empresa.`;
      else if (result.moduleChanges) successMessage = `Plano atualizado. ${result.subscribersAffected || 0} assinatura(s) vinculada(s); concessões individuais preservadas.`;
      else if (result.manualConfirmation) successMessage = `Pagamento registrado manualmente por ${result.confirmedBy || "administrador"}; assinatura e acesso atualizados.`;
      else if (result.after && body.action === "subscription") successMessage = `Assinatura ${String(result.after.status || "atualizada")} e acesso da empresa atualizado.`;
      else if (body.action === "application" && result.historyAvailable === false) successMessage = "Atendimento salvo. O histórico detalhado será registrado quando a migration administrativa for aplicada.";
      try { await refresh(); }
      catch (error) {
        const reason = error instanceof Error ? error.message : "erro ao recarregar os dados";
        setNotice(`${successMessage} A gravação foi concluída, mas a atualização da tela falhou: ${reason}`);
        return true;
      }
      setNotice(successMessage); return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao salvar."); return false; }
    finally { setBusy(false); }
  }

  const filteredCompanies = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return data.companies.filter((company) => {
      const textMatches = !term || `${company.tradeName} ${company.legalName} ${company.cnpj} ${typeLabel(company.businessType)}`.toLocaleLowerCase("pt-BR").includes(term);
      return textMatches && (!planFilter || company.subscription?.planCode === planFilter) &&
        (!subscriptionFilter || (company.subscription?.status || "incomplete") === subscriptionFilter) &&
        (!accessFilter || company.accessStatus === accessFilter);
    });
  }, [data.companies, query, planFilter, subscriptionFilter, accessFilter]);

  function formValues(form: HTMLFormElement) { return Object.fromEntries(new FormData(form).entries()); }
  const submit = (action: (event: FormEvent<HTMLFormElement>) => Promise<unknown>) => (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void action(event); };

  if (!loaded) return <main className={`${styles.shell} ${overrides.adminOverrides}`}>
    <header className={styles.topbar}><a href="/admin" className={styles.brand}><span className={styles.mark}>S</span><span><b>SigmaFiscal</b><small>Administração da plataforma</small></span></a><div className={styles.topActions}><span>Olá, {name}</span><a className={styles.buttonGhost} href="/logout">Sair</a></div></header>
    <section className={styles.content}>
      {loading ? <div className={styles.adminState} role="status"><strong>Carregando administração…</strong><span>Consultando empresas, planos, cobranças e atividade.</span></div> : <div className={styles.adminError} role="alert"><strong>Não foi possível carregar os dados do painel.</strong><span>{loadError || "Confira a conexão e tente novamente."}</span><button className={styles.buttonPrimary} onClick={() => void refresh().catch(() => undefined)}>Tentar novamente</button></div>}
    </section>
  </main>;

  return <main className={`${styles.shell} ${overrides.adminOverrides}`}>
    <header className={styles.topbar}><a href="/admin" className={styles.brand}><span className={styles.mark}>S</span><span><b>SigmaFiscal</b><small>Administração da plataforma</small></span></a><div className={styles.topActions}><span>Olá, {name}</span><a className={styles.buttonGhost} href="/logout">Sair</a></div></header>
    <div className={styles.layout}>
      <aside className={styles.sidebar}><div className={styles.sideTitle}>PLATAFORMA</div>{nav.map(([id, label]) => <button key={id} className={`${styles.navButton} ${section === id ? styles.selected : ""}`} onClick={() => setSection(id)}>{label}{id === "application_manager" && data.summary.pendingApplications > 0 ? <span className={styles.badge}>{data.summary.pendingApplications}</span> : null}</button>)}<div className={styles.sideFoot}><a href="/erp/index.html">Abrir ERP</a></div></aside>
      <section className={styles.content}>
        <div className={styles.pageHead}><div><p className={styles.eyebrow}>SIGMAFISCAL · OPERAÇÃO SAAS</p><h1>{nav.find((item) => item[0] === section)?.[1]}</h1><p>Empresas, assinaturas, cobrança e comunicação com clientes em um só lugar.</p></div><button className={styles.buttonGhost} onClick={() => void refresh().catch((error: Error) => setNotice(error.message))}>Atualizar dados</button></div>
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

        {section === "overview" ? <>
          <div className={styles.metrics}>
            <Metric title="Empresas cadastradas" value={data.summary.companies} detail="Empresas na plataforma"/>
            <Metric title="Acesso ativo" value={data.summary.activeCompanies} detail="Inclui empresas piloto"/>
            <Metric title="Acesso suspenso" value={data.summary.suspendedCompanies} detail="Bloqueadas no ERP"/>
            <Metric title="Solicitações pendentes" value={data.summary.pendingApplications} detail="Aguardando contato ou decisão"/>
            <Metric title="Assinaturas ativas" value={data.summary.activeSubscriptions} detail="Dentro da vigência"/>
            <Metric title="Assinaturas vencidas" value={data.summary.expiredSubscriptions} detail="Vigência encerrada"/>
            <Metric title="Cobranças abertas" value={data.summary.openCharges} detail="Abertas, vencidas ou informadas"/>
          </div>
          <section className={styles.panel}>
            <PanelHead title="Uso fiscal" detail="Contagens reais dos documentos registrados para as empresas selecionadas."/>
            <div className={styles.fiscalFilters}>
              <label>Empresa<select value={fiscalCompanyId} onChange={(event) => setFiscalCompanyId(event.target.value)}><option value="">Todas as empresas</option>{data.companies.map((company) => <option key={company.id} value={company.id}>{company.tradeName || company.legalName}</option>)}</select></label>
              <label>De<input type="date" value={fiscalFrom} onChange={(event) => setFiscalFrom(event.target.value)}/></label>
              <label>Até<input type="date" value={fiscalTo} onChange={(event) => setFiscalTo(event.target.value)}/></label>
              <button className={styles.buttonGhost} disabled={loading} onClick={() => void refresh().catch(() => undefined)}>Aplicar período</button>
            </div>
            {data.capabilities.fiscalMetrics && data.fiscalMetrics ? <div className={styles.fiscalMetrics}>
              <Metric title="NF-e autorizadas" value={Number(data.fiscalMetrics.nfeIssued || 0)} detail="No período"/>
              <Metric title="NF-e canceladas" value={Number(data.fiscalMetrics.nfeCancelled || 0)} detail="No período"/>
              <Metric title="NF-e rejeitadas" value={Number(data.fiscalMetrics.nfeRejected || 0)} detail="No período"/>
              <Metric title="NFC-e autorizadas" value={Number(data.fiscalMetrics.nfceIssued || 0)} detail="No período"/>
              <Metric title="NFC-e canceladas" value={Number(data.fiscalMetrics.nfceCancelled || 0)} detail="No período"/>
              <Metric title="NFC-e rejeitadas" value={Number(data.fiscalMetrics.nfceRejected || 0)} detail="No período"/>
              <Metric title="Entradas importadas" value={Number(data.fiscalMetrics.inboundImported || 0)} detail="NF-e de entrada"/>
            </div> : <p className={styles.callout}>As métricas fiscais ficam disponíveis após aplicar a migration administrativa de métricas. Nenhum total foi estimado.</p>}
          </section>
          <div className={styles.twoColumns}>
            <section className={styles.panel}><PanelHead title="Solicitações recentes" detail="Novas empresas interessadas" action={<button className={styles.linkButton} onClick={() => setSection("application_manager")}>Ver todas</button>}/>{data.applications.slice(0, 5).map((item) => <div className={styles.listRow} key={item.id}><div><b>{item.company_name}</b><small>{item.case_code} · {item.contact_name} · {typeLabel(item.business_type)}</small></div><Status value={item.status}/></div>)}{data.applications.length === 0 ? <Empty text="Nenhuma solicitação recebida."/> : null}</section>
            <section className={styles.panel}><PanelHead title="Atividade administrativa" detail="Alterações recentes registradas na trilha de auditoria."/>{data.recentActivity.map((item, index) => <div className={styles.listRow} key={String(item.id || index)}><div><b>{String(item.action || "Ação administrativa")}</b><small>{String(item.entity_type || "")}{item.created_at ? ` · ${date(String(item.created_at))}` : ""}</small></div><span>{String(item.admin_user_id || "")}</span></div>)}{data.recentActivity.length === 0 ? <Empty text={data.capabilities.auditLog ? "Ainda não há ações administrativas registradas." : "A trilha de auditoria depende da migration administrativa."}/> : null}</section>
          </div>
          <div className={styles.twoColumns}>
            <section className={styles.panel}><PanelHead title="Cobranças recentes" detail="Boletos, Pix e cobranças registradas" action={<button className={styles.linkButton} onClick={() => setSection("billing")}>Gerenciar</button>}/>{data.charges.slice(0, 5).map((item) => <div className={styles.listRow} key={item.id}><div><b>{item.company_name}</b><small>{item.description} · vence {date(item.due_at)}</small></div><strong>{money(item.amount_minor)}</strong></div>)}{data.charges.length === 0 ? <Empty text="Nenhuma cobrança registrada."/> : null}</section>
            <section className={styles.panel}><PanelHead title="Atalhos da operação" detail="Ações administrativas comuns"/><div className={styles.quickActions}><button onClick={() => setSection("companies")}>Liberar uma empresa</button><button onClick={() => setSection("billing")}>Lançar cobrança</button><button onClick={() => setSection("team")}>Criar acesso de equipe</button><button onClick={() => setSection("content")}>Publicar atualização</button></div></section>
          </div>
        </> : null}

        {section === "application_manager" ? <ApplicationsManager applications={data.applications} companies={data.companies} admins={data.platformAdmins} historyAvailable={data.capabilities.requestHistory} busy={busy} onMutate={mutate}/> : null}

        {section === "companies" ? <>
          <div className={styles.toolbar}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, CNPJ ou segmento"/>
            <select className={styles.filterSelect} aria-label="Filtrar por plano" value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}><option value="">Todos os planos</option>{data.plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select>
            <select className={styles.filterSelect} aria-label="Filtrar assinatura" value={subscriptionFilter} onChange={(event) => setSubscriptionFilter(event.target.value)}><option value="">Todas as assinaturas</option>{[["active","Ativa"],["trialing","Em teste"],["paused","Suspensa"],["past_due","Em atraso"],["canceled","Encerrada"],["incomplete","Sem assinatura"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select className={styles.filterSelect} aria-label="Filtrar acesso" value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)}><option value="">Todo acesso</option>{[["active","Ativo"],["pilot","Piloto"],["suspended","Suspenso"],["unknown","Desconhecido"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
            <span>{filteredCompanies.length} empresas</span>
          </div>
          <div className={styles.cards}>{filteredCompanies.map((company) => <CompanyCardEnhanced key={`${company.id}:${company.subscription?.planCode || ""}:${company.subscription?.endsAt || ""}`} company={company} plans={data.plans} busy={busy} canManageModules={data.capabilities.moduleOverrides} onMutate={mutate}/>)}</div>
          {filteredCompanies.length === 0 ? <Empty text="Nenhuma empresa corresponde aos filtros."/> : null}
        </> : null}

        {section === "billing" ? <><section className={styles.panel}><PanelHead title="Criar cobrança" detail="Cadastre boleto/Pix gerado pelo provedor ou uma cobrança manual. A confirmação de pagamento aqui é manual."/><form className={styles.formGrid} onSubmit={submit(async (event) => { const form = event.currentTarget; const values = formValues(form); const result = await mutate("/api/admin/platform", "POST", { action: "charge", ...values, amountMinor: Math.round(Number(String(values.amount).replace(",", ".")) * 100), dueAt: values.dueAt ? new Date(`${values.dueAt}T23:59:00`).toISOString() : "" }); if (result) form.reset(); })}><label>Empresa<select name="companyId" required defaultValue=""><option value="" disabled>Selecione</option>{data.companies.map((c)=><option key={c.id} value={c.id}>{c.tradeName || c.legalName}</option>)}</select></label><label>Descrição<input name="description" required defaultValue="Assinatura SigmaFiscal"/></label><label>Valor (R$)<input name="amount" inputMode="decimal" required placeholder="99,90"/></label><label>Vencimento<input name="dueAt" type="date" required/></label><label>Forma de pagamento<select name="paymentMethod"><option value="boleto">Boleto</option><option value="pix">Pix</option><option value="manual">Manual</option></select></label><label>Link do boleto (HTTPS)<input name="boletoUrl" type="url" placeholder="https://…"/></label><label className={styles.wide}>Linha digitável<input name="boletoLine"/></label><label className={styles.wide}>Pix copia e cola<textarea name="pixCopyPaste" rows={2}/></label><label>Link do QR Pix<input name="pixQrUrl" type="url" placeholder="https://…"/></label><label>Referência do provedor<input name="providerReference"/></label><label className={styles.wide}>Nota interna<textarea name="adminNote" rows={2}/></label><div className={styles.wide}><button className={styles.buttonPrimary} disabled={busy}>Criar cobrança</button></div></form></section><section className={styles.panel}><PanelHead title="Histórico de cobranças" detail="A marcação de paga atualiza a assinatura e reabre o acesso."/>{!data.capabilities.paymentAudit ? <p className={styles.callout}>A confirmação auditável de pagamentos depende da migration administrativa. Aplique-a no Supabase antes de confirmar recebimentos.</p> : null}<div className={styles.tableWrap}><table><thead><tr><th>Empresa</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Pagamento</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{data.charges.map((charge)=><tr key={charge.id}><td>{charge.company_name}</td><td>{charge.description}</td><td>{money(charge.amount_minor)}</td><td>{date(charge.due_at)}</td><td>{charge.payment_method === "boleto" ? <>{charge.boleto_url ? <a href={charge.boleto_url} target="_blank" rel="noreferrer">Abrir boleto</a> : "Boleto pendente"}<small>{charge.boleto_line}</small></> : charge.payment_method === "pix" ? <>{charge.pix_copy_paste ? <button className={styles.linkButton} onClick={() => void navigator.clipboard.writeText(charge.pix_copy_paste || "")}>Copiar Pix</button> : "Pix pendente"}{charge.pix_qr_url ? <a href={charge.pix_qr_url} target="_blank" rel="noreferrer">QR Pix</a> : null}</> : "Manual"}</td><td><Status value={charge.status}/>{charge.manually_confirmed_by ? <small>Confirmação manual · {charge.manual_confirmation_note}</small> : null}</td><td><ChargeActions charge={charge} busy={busy} canConfirm={data.capabilities.paymentAudit} onMutate={mutate}/></td></tr>)}</tbody></table></div></section><p className={styles.callout}>Esta versão registra cobranças, links e confirmação manual. Não gera boletos/Pix nem consulta compensação bancária automaticamente; para isso falta contratar e integrar um provedor de pagamento.</p></> : null}

        {section === "plans" ? <><section className={styles.panel}><PanelHead title={editingPlan ? `Editar plano · ${editingPlan.name}` : "Novo plano"} detail="Defina preço, período de tolerância, segmentos e publicação na página inicial."/><PlanEditor key={editingPlan?.code || "new"} initial={editingPlan} affectedCompanies={editingPlan ? data.companies.filter((company) => company.subscription?.planCode === editingPlan.code) : []} canManageModules={data.capabilities.moduleOverrides} busy={busy} onCancel={() => setEditingPlan(null)} onSave={async (body) => { const ok = await mutate("/api/admin/platform", editingPlan ? "PATCH" : "POST", { action: "plan", ...body }); if (ok) setEditingPlan(null); }}/></section><section className={styles.panel}><PanelHead title="Planos cadastrados" detail="Planos públicos aparecem na página inicial."/><div className={styles.cards}>{data.plans.map((plan)=><article className={styles.planCard} key={plan.code}><div className={styles.cardTop}><div><h2>{plan.name}</h2><p>{plan.code} · {intervalNames[plan.billing_interval] || plan.billing_interval} · {money(plan.amount_minor)}</p></div><Status value={plan.active ? (plan.is_public ? "published" : "active") : "paused"}/></div><p>{plan.description || "Sem descrição"}</p><small>{plan.grace_period_days} dias de tolerância · {plan.enabled_business_types.map(typeLabel).join(", ") || "Sem segmentos"}</small><div className={styles.planModuleSummary}><b>{plan.subscriber_count} empresa(s) vinculada(s)</b><span>{data.capabilities.moduleOverrides ? PLATFORM_MODULES.filter((module) => plan.modules?.[module.key]).map((module) => module.label).join(" · ") || "Sem módulos incluídos" : "Módulos preservados até a migration de permissões estar aplicada"}</span></div><button className={styles.buttonGhost} onClick={() => setEditingPlan(plan)}>Editar plano</button></article>)}</div></section></> : null}

        {section === "team" ? <><section className={styles.panel}><PanelHead title="Convidar usuário para empresa" detail="O convite é enviado pelo Supabase Auth. Cada acesso fica associado a uma única empresa."/><form className={styles.formGrid} onSubmit={submit(async (event) => { const form = event.currentTarget; const values = formValues(form); const ok = await mutate("/api/admin/team", "POST", values); if (ok) form.reset(); })}><label>Empresa<select name="companyId" required defaultValue=""><option value="" disabled>Selecione</option>{data.companies.map((c)=><option key={c.id} value={c.id}>{c.tradeName || c.legalName}</option>)}</select></label><label>Nome<input name="name" required minLength={2}/></label><label>E-mail<input name="email" type="email" required/></label><label>Função<select name="role"><option value="technician">Técnico</option><option value="commercial">Comercial</option><option value="accounting">Contabilidade · leitura</option></select></label><div className={styles.wide}><button className={styles.buttonPrimary} disabled={busy}>Enviar convite</button></div></form></section><section className={styles.panel}><PanelHead title="Equipe convidada" detail="Acesso vinculado à empresa indicada."/><div className={styles.tableWrap}><table><thead><tr><th>Empresa</th><th>Usuário</th><th>Função</th><th>Status</th></tr></thead><tbody>{data.invites.map((invite)=><tr key={invite.id}><td>{data.companies.find((c)=>c.id===invite.company_id)?.tradeName || data.companies.find((c)=>c.id===invite.company_id)?.legalName || "Empresa"}</td><td>{invite.display_name}<small>{invite.email}</small></td><td>{roleNames[invite.role] || invite.role}</td><td><Status value={invite.status}/></td></tr>)}</tbody></table></div></section></> : null}

        {section === "content" ? <><section className={styles.panel}><PanelHead title={editingContent ? "Editar publicação" : "Publicar no site"} detail="Atualizações e artigos aparecem na página inicial somente após publicação."/><ContentEditor key={editingContent?.id || "new-content"} initial={editingContent} busy={busy} onCancel={() => setEditingContent(null)} onSave={async (body) => { const ok = await mutate("/api/admin/platform", editingContent ? "PATCH" : "POST", { action: "content", ...body, ...(editingContent ? { id: editingContent.id } : {}) }); if (ok) setEditingContent(null); }}/></section><section className={styles.panel}><PanelHead title="Publicações e rascunhos" detail="Revise antes de publicar informações fiscais ou comerciais."/><div className={styles.cards}>{data.content.map((item)=><article className={styles.card} key={item.id}><div className={styles.cardTop}><div><span className={styles.case}>{item.content_type === "changelog" ? "ATUALIZAÇÃO DO SISTEMA" : "ARTIGO"}</span><h2>{item.title}</h2><p>/{item.slug} · {date(item.published_at)}</p></div><Status value={item.status}/></div><p>{item.summary}</p><div className={styles.rowActions}><button className={styles.buttonGhostSmall} onClick={() => setEditingContent(item)}>Editar</button>{item.status !== "published" ? <button className={styles.buttonPrimarySmall} disabled={busy} onClick={() => void mutate("/api/admin/platform", "PATCH", { action: "content", id: item.id, status: "published", contentType: item.content_type, title: item.title, slug: item.slug, summary: item.summary, body: item.body })}>Publicar</button> : <button className={styles.buttonGhostSmall} disabled={busy} onClick={() => void mutate("/api/admin/platform", "PATCH", { action: "content", id: item.id, status: "draft", contentType: item.content_type, title: item.title, slug: item.slug, summary: item.summary, body: item.body })}>Tirar do ar</button>}<button className={styles.buttonGhostSmall} disabled={busy} onClick={() => void mutate("/api/admin/platform", "PATCH", { action: "content", id: item.id, status: "archived", contentType: item.content_type, title: item.title, slug: item.slug, summary: item.summary, body: item.body })}>Arquivar</button></div></article>)}</div>{data.content.length === 0 ? <Empty text="Ainda não há publicações."/> : null}</section></> : null}
      </section>
    </div>
  </main>;
}

function Metric({ title, value, detail }: { title: string; value: number; detail: string }) { return <article className={styles.metric}><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>; }
function PanelHead({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) { return <header className={styles.panelHead}><div><h2>{title}</h2><p>{detail}</p></div>{action}</header>; }
function Status({ value }: { value: string }) { return <span className={`${styles.status} ${styles[`status_${value}`] || ""}`}>{statusNames[value] || value}</span>; }
function Empty({ text }: { text: string }) { return <div className={styles.empty}>{text}</div>; }

function ChargeActions({ charge, busy, canConfirm, onMutate }: { charge: Charge; busy: boolean; canConfirm: boolean; onMutate: (path: string, method: "POST" | "PATCH", body: Record<string, unknown>) => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const terminal = ["paid", "canceled"].includes(charge.status);
  return <div className={styles.chargeActions}>
    <div className={styles.rowActions}>
      {charge.status !== "paid" ? <button type="button" className={styles.buttonPrimarySmall} disabled={busy || !canConfirm || charge.status === "canceled"} onClick={() => setConfirming((open) => !open)}>Registrar recebimento</button> : null}
      <button type="button" className={styles.buttonGhostSmall} disabled={busy || terminal} onClick={() => { if (!window.confirm(`Cancelar a cobrança ${charge.description} de ${money(charge.amount_minor)}?`)) return; void onMutate("/api/admin/platform", "PATCH", { action: "charge", id: charge.id, status: "canceled" }); }}>Cancelar</button>
    </div>
    {!canConfirm && charge.status !== "paid" ? <small className={styles.muted}>A auditoria de confirmação precisa da migration administrativa.</small> : null}
    {confirming && canConfirm ? <form className={styles.chargeConfirmForm} onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const note = String(new FormData(form).get("manualConfirmationNote") || "").trim();
      if (note.length < 8 || !window.confirm(`Confirma que verificou o recebimento desta cobrança de ${money(charge.amount_minor)}? Essa ação reativa a assinatura vinculada e será registrada na auditoria.`)) return;
      void onMutate("/api/admin/platform", "PATCH", { action: "charge", id: charge.id, status: "paid", manualConfirmation: true, manualConfirmationNote: note }).then((saved) => { if (saved) setConfirming(false); });
    }}>
      <label className={styles.checkLabel}><input type="checkbox" name="verified" required/>Verifiquei o recebimento no extrato bancário ou no provedor.</label>
      <label>Registro da conferência<textarea name="manualConfirmationNote" minLength={8} maxLength={1000} rows={2} required placeholder="Informe a data, referência ou evidência conferida."/></label>
      <button className={styles.buttonPrimarySmall} disabled={busy}>Confirmar pagamento e reativar</button>
    </form> : null}
  </div>;
}

function ApplicationsManager({ applications, companies, admins, historyAvailable, busy, onMutate }: { applications: Application[]; companies: AdminCompany[]; admins: Data["platformAdmins"]; historyAvailable: boolean; busy: boolean; onMutate: (path: string, method: "POST" | "PATCH", body: Record<string, unknown>) => Promise<boolean> }) {
  const eventLabel: Record<string, string> = { created: "Solicitação recebida", updated: "Dados atualizados", assigned: "Responsável alterado", status_changed: "Situação alterada", note_changed: "Anotação alterada" };
  return <section className={styles.panel}>
    <PanelHead title="Solicitações comerciais" detail="Acompanhe os contatos reais recebidos pelo site, atribua responsáveis e registre o andamento."/>
    {applications.length === 0 ? <Empty text="Nenhuma solicitação comercial recebida."/> : <div className={styles.cards}>{applications.map((item) => {
      const matches = companies.filter((company) => company.cnpj.toUpperCase().replace(/[^A-Z0-9]/g, "") === item.cnpj.toUpperCase().replace(/[^A-Z0-9]/g, ""));
      return <article className={styles.card} key={`${item.id}:${item.updated_at || item.created_at}`}>
        <div className={styles.cardTop}><div><span className={styles.case}>{item.case_code}</span><h2>{item.company_name}</h2><p>{typeLabel(item.business_type)} · CNPJ {item.cnpj}</p></div><Status value={item.status}/></div>
        <div className={styles.contactGrid}><span><b>Responsável</b>{item.contact_name}</span><span><b>E-mail</b><a href={`mailto:${item.email}`}>{item.email}</a></span><span><b>Telefone</b><a href={`tel:${item.phone}`}>{item.phone}</a></span><span><b>Recebida</b>{date(item.created_at)}</span><span><b>Atendimento atribuído</b>{item.assigned_admin_name || "Sem responsável"}</span></div>
        {item.message ? <p className={styles.message}>{item.message}</p> : null}
        <form className={styles.formGrid} onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); void onMutate("/api/admin/platform", "PATCH", { action: "application", id: item.id, status: values.status, adminNote: values.adminNote, linkedCompanyId: values.linkedCompanyId, assignedAdminId: values.assignedAdminId }); }}>
          <label>Situação<select name="status" defaultValue={item.status}>{[["new","Nova"],["contacted","Em contato"],["approved","Aprovada"],["closed","Encerrada"]].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Responsável interno<select name="assignedAdminId" defaultValue={item.assigned_admin_id || ""}><option value="">Sem responsável</option>{admins.filter((admin) => admin.active && admin.user_id).map((admin) => <option key={admin.user_id} value={admin.user_id}>{admin.email}</option>)}</select></label>
          <label>Vincular cadastro com o mesmo CNPJ<select name="linkedCompanyId" defaultValue={item.linked_company_id || ""}><option value="">Não vincular ainda</option>{matches.map((company) => <option value={company.id} key={company.id}>{company.tradeName || company.legalName}</option>)}</select></label>
          <label className={styles.wide}>Anotações internas<textarea name="adminNote" defaultValue={item.admin_note} rows={2} maxLength={2000} placeholder="Próximo contato, necessidade ou decisão comercial"/></label>
          <div className={`${styles.wide} ${styles.formActions}`}><button className={styles.buttonPrimary} disabled={busy}>Salvar atendimento</button><a className={styles.buttonGhost} href={`https://wa.me/${item.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${item.contact_name}, sobre sua solicitação ${item.case_code} do SigmaFiscal.`)}`} target="_blank" rel="noreferrer">Abrir WhatsApp</a></div>
        </form>
        {historyAvailable ? <div className={styles.historyList}><strong>Histórico deste atendimento</strong>{item.history.length ? item.history.map((event, index) => <div className={styles.historyRow} key={String(event.id || index)}><span>{eventLabel[String(event.event_type)] || "Atualização"}</span><small>{String(event.actor_name || "Equipe SigmaFiscal")} · {event.created_at ? date(String(event.created_at)) : "Data indisponível"}</small></div>) : <small>O histórico começa a ser registrado nas próximas alterações.</small>}</div> : <p className={styles.muted}>O histórico detalhado será habilitado quando a migration administrativa estiver aplicada.</p>}
      </article>;
    })}</div>}
  </section>;
}

function CompanyCardEnhanced({ company, plans, busy, canManageModules, onMutate }: { company: AdminCompany; plans: Plan[]; busy: boolean; canManageModules: boolean; onMutate: (path: string, method: "POST" | "PATCH", body: Record<string, unknown>) => Promise<boolean> }) {
  const eligiblePlans = plans.filter((plan) => plan.active && (plan.enabled_business_types || []).includes(company.businessType));
  const [planCode, setPlanCode] = useState(company.subscription?.planCode || eligiblePlans[0]?.code || "");
  const [endsAt, setEndsAt] = useState(company.subscription?.endsAt?.slice(0, 10) || "");
  const [source, setSource] = useState("manual");
  const [moduleNote, setModuleNote] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const activePlan = plans.find((plan) => plan.code === planCode);
  const fiscal = company.fiscalUsage;
  const subscriptionChanged = planCode !== (company.subscription?.planCode || "") || endsAt !== (company.subscription?.endsAt?.slice(0, 10) || "");
  const saveSubscription = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!planCode) return;
    const summary = `${company.tradeName || company.legalName}\nPlano: ${company.subscription?.planName || "sem plano"} → ${activePlan?.name || planCode}\nVálido até: ${endsAt ? date(endsAt) : "fim do período do plano"}\nOs módulos concedidos manualmente ou como adicionais serão preservados.`;
    if (!window.confirm(`Confirmar alteração de plano e vigência?\n\n${summary}`)) return;
    void onMutate("/api/admin/platform", "PATCH", { action: "subscription", companyId: company.id, operation: "activate", planCode, endsAt });
  };
  const updateModule = (module: AdminCompany["moduleAccess"][number], enabled: boolean) => {
    const action = enabled ? "liberar" : "desativar";
    if (!window.confirm(`Deseja ${action} ${module.label} para ${company.tradeName || company.legalName}?`)) return;
    void onMutate("/api/admin/platform", "POST", { action: "module", companyId: company.id, moduleKey: module.key, enabled, source, note: moduleNote });
  };
  const changeAccess = (operation: "pause" | "cancel") => {
    const wording = operation === "pause" ? "suspender o acesso" : "encerrar a assinatura e suspender o acesso";
    if (!window.confirm(`Confirma ${wording} de ${company.tradeName || company.legalName}?`)) return;
    void onMutate("/api/admin/platform", "PATCH", { action: "subscription", companyId: company.id, operation });
  };

  return <article className={styles.companyCard}>
    <div className={styles.cardTop}><div><span className={styles.case}>{typeLabel(company.businessType)}</span><h2>{company.tradeName || company.legalName}</h2><p>{company.legalName}{company.cnpj ? ` · CNPJ ${company.cnpj}` : ""}</p></div><div className={styles.statusStack}><Status value={company.accessStatus}/><Status value={company.subscription?.status || "incomplete"}/></div></div>
    <div className={styles.companyMeta}><span>Plano <b>{company.subscription?.planName || "Sem plano"}</b></span><span>Vigência <b>{date(company.subscription?.endsAt)}</b></span><span>Empresa <b>{statusNames[company.status] || company.status}</b></span><span>Acesso <b>{statusNames[company.accessStatus] || company.accessStatus}</b></span>{company.subscription?.temporaryAccessUntil ? <span>Acesso temporário até <b>{date(company.subscription.temporaryAccessUntil)}</b></span> : null}</div>
    <form className={styles.inlineForm} onSubmit={saveSubscription}>
      <select aria-label="Plano da empresa" value={planCode} onChange={(event) => setPlanCode(event.target.value)} disabled={!eligiblePlans.length}><option value="" disabled>{eligiblePlans.length ? "Selecione o plano" : "Nenhum plano para este segmento"}</option>{eligiblePlans.map((plan) => <option value={plan.code} key={plan.code}>{plan.name} · {money(plan.amount_minor)} / {intervalNames[plan.billing_interval] || plan.billing_interval}</option>)}</select>
      <label className={styles.compactLabel}>Válido até<input aria-label="Válido até" type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)}/></label>
      <button className={styles.buttonPrimary} disabled={busy || !planCode}>{company.subscription ? "Salvar plano e vigência" : "Ativar assinatura"}</button>
      {company.subscription?.status === "paused" || company.accessStatus === "suspended" ? <button className={styles.buttonGhost} type="button" disabled={busy || !planCode} onClick={() => { if (!window.confirm(`Reativar ${company.tradeName || company.legalName} com o plano ${activePlan?.name || planCode}?`)) return; void onMutate("/api/admin/platform", "PATCH", { action: "subscription", companyId: company.id, operation: "activate", planCode, endsAt }); }}>Reativar</button> : null}
      <button className={styles.buttonGhost} type="button" disabled={busy || !company.subscription} onClick={() => changeAccess("pause")}>Suspender</button>
      <button className={styles.buttonDanger} type="button" disabled={busy || !company.subscription} onClick={() => changeAccess("cancel")}>Encerrar</button>
    </form>
    {subscriptionChanged ? <p className={styles.previewNotice}>Prévia: {activePlan?.name || "Plano selecionado"} · término {endsAt ? date(endsAt) : "calculado pela periodicidade"}. Os módulos personalizados da empresa permanecem preservados.</p> : null}
    {!eligiblePlans.length ? <small className={styles.muted}>Cadastre um plano ativo e habilite o segmento “{typeLabel(company.businessType)}” para liberar esta empresa.</small> : null}
    <section className={styles.modulePanel}>
      <div className={styles.modulePanelHead}><div><h3>Módulos e recursos</h3><p>Controle por empresa. A origem mostra se veio do plano ou de uma concessão específica.</p></div><Status value={canManageModules ? "active" : "incomplete"}/></div>
      {canManageModules ? <><div className={styles.moduleGrantOptions}><label>Origem de novos acessos<select value={source} onChange={(event) => setSource(event.target.value)}><option value="manual">Concessão manual</option><option value="additional">Adicional contratado</option></select></label><label>Observação da concessão<input value={moduleNote} maxLength={500} onChange={(event) => setModuleNote(event.target.value)} placeholder="Ex.: módulo incluído em aditivo comercial"/></label></div><div className={styles.moduleList}>{company.moduleAccess.map((module) => <div className={styles.moduleRow} key={module.key}><div><strong>{module.label}</strong><small>{module.origin}{module.note ? ` · ${module.note}` : ""}</small></div><label className={styles.toggleLabel}><input type="checkbox" checked={module.enabled} disabled={busy} onChange={(event) => updateModule(module, event.target.checked)}/><span>{module.enabled ? "Ativo" : "Desativado"}</span></label></div>)}</div></> : <p className={styles.callout}>A tabela de permissões por empresa ainda não está aplicada. Envie a migration administrativa ao Supabase para gravar concessões individuais.</p>}
    </section>
    <button className={styles.linkButton} onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? "Ocultar" : "Ver"} cadastro, uso fiscal, cobranças e equipe</button>
    {detailsOpen ? <div className={styles.advanced}>
      <h3>Resumo fiscal</h3>{fiscal ? <div className={styles.companyFiscal}><span>NF-e autorizadas <b>{Number(fiscal.nfeIssued || 0)}</b></span><span>NF-e canceladas <b>{Number(fiscal.nfeCancelled || 0)}</b></span><span>NF-e rejeitadas <b>{Number(fiscal.nfeRejected || 0)}</b></span><span>NFC-e autorizadas <b>{Number(fiscal.nfceIssued || 0)}</b></span><span>NFC-e canceladas <b>{Number(fiscal.nfceCancelled || 0)}</b></span><span>NFC-e rejeitadas <b>{Number(fiscal.nfceRejected || 0)}</b></span><span>Entradas XML <b>{Number(fiscal.inboundImported || 0)}</b></span></div> : <p>Sem documentos no período filtrado ou métricas ainda indisponíveis.</p>}
      <h3>Cobranças</h3>{company.charges.length ? company.charges.map((charge) => <p key={charge.id}>{charge.description} · {money(charge.amount_minor)} · vence {date(charge.due_at)} · {statusNames[charge.status] || charge.status}</p>) : <p>Nenhuma cobrança cadastrada.</p>}
      <h3>Usuários convidados</h3>{company.invites.length ? company.invites.map((invite) => <p key={invite.id}>{invite.display_name} · {invite.email} · {roleNames[invite.role] || invite.role} · {statusNames[invite.status] || invite.status}</p>) : <p>Nenhum convite enviado.</p>}
      <h3>Documentos do cadastro</h3>{company.documents.length ? company.documents.map((document) => <p key={document.document_code}>{document.document_code}: {statusNames[document.status] || document.status}{document.note ? ` · ${document.note}` : ""}</p>) : <p>Nenhum documento pendente nesta implantação.</p>}
      <small>Prazo de tolerância do plano: {activePlan?.grace_period_days ?? company.subscription?.gracePeriodDays ?? 15} dias.</small>
    </div> : null}
  </article>;
}

function PlanEditor({ initial, affectedCompanies, canManageModules, busy, onCancel, onSave }: { initial: Plan | null; affectedCompanies: AdminCompany[]; canManageModules: boolean; busy: boolean; onCancel: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [types, setTypes] = useState<string[]>(initial?.enabled_business_types || BUSINESS_TYPES.map((item)=>item.code));
  const [modules, setModules] = useState<Record<string, boolean>>(initial?.modules || Object.fromEntries(PLATFORM_MODULES.map((item) => [item.key, false])));
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const changedModules = PLATFORM_MODULES.filter((module) => Boolean(initial?.modules?.[module.key]) !== Boolean(modules[module.key]));
    if (initial && (initial.subscriber_count > 0 || changedModules.length > 0)) {
      const moduleAccessChanges = changedModules.map((module) => ({
        label: module.label,
        companies: affectedCompanies.filter((company) => company.moduleAccess.find((access) => access.key === module.key)?.source == null),
      })).filter((change) => change.companies.length > 0);
      const affectedNames = affectedCompanies.map((company) => `• ${company.tradeName || company.legalName} · ${company.cnpj || "CNPJ não informado"}`);
      if (affectedCompanies.length < initial.subscriber_count) affectedNames.push(`• Mais ${initial.subscriber_count - affectedCompanies.length} assinatura(s); a lista carregada é parcial.`);
      const changedModuleNames = changedModules.map((module) => `${module.label}: ${modules[module.key] ? "incluído" : "removido"}`);
      const directModuleImpact = new Map<string, { company: AdminCompany; modules: string[] }>();
      for (const change of moduleAccessChanges) for (const company of change.companies) {
        const current = directModuleImpact.get(company.id) || { company, modules: [] };
        current.modules.push(change.label);
        directModuleImpact.set(company.id, current);
      }
      const details = [
        `Empresas vinculadas ao plano (${initial.subscriber_count}):`,
        ...(affectedNames.length ? affectedNames : ["• A lista carregada não contém todas as assinaturas; confira o total antes de salvar."]),
        changedModuleNames.length ? `\nMudanças de módulos no plano:\n${changedModuleNames.map((item) => `• ${item}`).join("\n")}` : "",
        directModuleImpact.size ? `\nEmpresas cujo acesso ao módulo muda agora (sem concessão individual):\n${[...directModuleImpact.values()].map(({ company, modules: changed }) => `• ${company.tradeName || company.legalName}: ${changed.join(", ")}`).join("\n")}` : "",
        changedModules.length && !moduleAccessChanges.length ? "\nNenhuma empresa terá o acesso alterado por estes módulos porque todas têm concessões individuais que prevalecem." : "",
        "\nPreço e periodicidade são usados nas próximas cobranças; a tolerância atualizada muda a regra de acesso após o vencimento.",
      ].filter(Boolean).join("\n");
      if (!window.confirm(`Você está editando um plano usado por empresas. Revise o impacto antes de salvar:\n\n${details}\n\nDeseja continuar?`)) return;
    }
    void onSave({ ...values, amountMinor: values.amount === "" ? null : Math.round(Number(String(values.amount).replace(",", ".")) * 100), gracePeriodDays: Number(values.gracePeriodDays), maxUsers: values.maxUsers || null, maxCompanies: values.maxCompanies || 1, sortOrder: Number(values.sortOrder) || 100, isPublic: values.isPublic === "on", active: values.active === "on", enabledBusinessTypes: types, ...(canManageModules ? { modules } : {}) });
  }
  return <form className={styles.formGrid} onSubmit={save}>
    {initial && initial.subscriber_count > 0 ? <div className={`${styles.wide} ${styles.planImpact}`}><strong>Empresas vinculadas ({initial.subscriber_count})</strong>{affectedCompanies.length ? <ul>{affectedCompanies.map((company) => <li key={company.id}>{company.tradeName || company.legalName}{company.cnpj ? ` · ${company.cnpj}` : ""}</li>)}</ul> : <p>A lista de assinaturas não retornou empresas neste momento. Atualize os dados antes de editar o impacto do plano.</p>}<small>As mudanças de módulos afetam apenas recursos sem concessão específica por empresa. O preço passa a valer nas próximas cobranças; a tolerância de acesso é aplicada conforme a vigência atual.</small></div> : null}
    <label>Código único<input name="code" defaultValue={initial?.code || ""} required pattern="[a-z][a-z0-9_-]{1,39}" disabled={Boolean(initial)}/></label>
    <label>Nome do plano<input name="name" defaultValue={initial?.name || ""} required minLength={2}/></label>
    <label>Periodicidade<select name="interval" defaultValue={initial?.billing_interval || "month"}>{Object.entries(intervalNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Preço mensal ou período (R$)<input name="amount" inputMode="decimal" defaultValue={initial?.amount_minor == null ? "" : (initial.amount_minor / 100).toFixed(2)} placeholder="Deixe vazio para sob consulta"/></label>
    <label>Dias após vencimento<input name="gracePeriodDays" type="number" min="0" max="60" defaultValue={initial?.grace_period_days ?? 15}/></label>
    <label>Máximo de usuários<input name="maxUsers" type="number" min="1" defaultValue={initial?.max_users || ""} placeholder="Sem limite"/></label>
    <label>Máximo de empresas<input name="maxCompanies" type="number" min="1" defaultValue={initial?.max_companies || 1}/></label>
    <label>Ordem na página inicial<input name="sortOrder" type="number" defaultValue={initial?.sort_order || 100}/></label>
    <label className={styles.wide}>Descrição<textarea name="description" rows={3} defaultValue={initial?.description || ""}/></label>
    <fieldset className={`${styles.wide} ${styles.segmentField}`}><legend>Segmentos incluídos</legend><div>{BUSINESS_TYPES.map((item) => <label key={item.code}><input type="checkbox" checked={types.includes(item.code)} onChange={(event) => setTypes((current) => event.target.checked ? [...current, item.code] : current.filter((code) => code !== item.code))}/>{item.label}</label>)}</div></fieldset>
    <fieldset className={`${styles.wide} ${styles.planModules}`} disabled={!canManageModules}><legend>Módulos incluídos no plano</legend>{canManageModules ? <><div className={styles.moduleList}>{PLATFORM_MODULES.map((module) => <label className={styles.moduleRow} key={module.key}><span><strong>{module.label}</strong><small>{module.description}</small></span><input type="checkbox" checked={Boolean(modules[module.key])} onChange={(event) => setModules((current) => ({ ...current, [module.key]: event.target.checked }))}/></label>)}</div><small>Empresas podem receber concessões individuais adicionais ou manuais sem alterar o plano.</small></> : <p className={styles.callout}>A seleção de módulos fica temporariamente indisponível porque a migration de permissões ainda não foi aplicada. Não altere planos para conceder ou remover acesso até a migration estar ativa.</p>}</fieldset>
    <label className={styles.checkLabel}><input name="active" type="checkbox" defaultChecked={initial?.active ?? true}/> Plano ativo</label>
    <label className={styles.checkLabel}><input name="isPublic" type="checkbox" defaultChecked={initial?.is_public ?? false}/> Mostrar no site</label>
    <div className={`${styles.wide} ${styles.formActions}`}><button className={styles.buttonPrimary} disabled={busy || (!initial && !canManageModules)}>{initial ? "Salvar plano" : canManageModules ? "Criar plano" : "Aplique a migration para criar planos"}</button>{initial ? <button type="button" className={styles.buttonGhost} onClick={onCancel}>Cancelar edição</button> : null}</div>
  </form>;
}

function ContentEditor({ initial, busy, onCancel, onSave }: { initial: Content | null; busy: boolean; onCancel: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  return <form className={styles.formGrid} onSubmit={(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget).entries());void onSave({...values,status:values.publish==="on"?"published":"draft"});}}><label>Tipo<select name="contentType" defaultValue={initial?.content_type||"changelog"}><option value="changelog">Atualização do sistema</option><option value="article">Artigo / informação</option></select></label><label>Título<input name="title" required minLength={3} defaultValue={initial?.title||""}/></label><label className={styles.wide}>Endereço (slug)<input name="slug" defaultValue={initial?.slug||""} placeholder="Gerado pelo título se vazio"/></label><label className={styles.wide}>Resumo<input name="summary" maxLength={500} defaultValue={initial?.summary||""}/></label><label className={styles.wide}>Conteúdo<textarea name="body" rows={7} maxLength={30000} defaultValue={initial?.body||""}/></label><label className={styles.checkLabel}><input name="publish" type="checkbox" defaultChecked={initial?.status==="published"}/> Publicar agora</label><div className={`${styles.wide} ${styles.formActions}`}><button className={styles.buttonPrimary} disabled={busy}>{initial ? "Salvar publicação" : "Criar publicação"}</button>{initial ? <button className={styles.buttonGhost} type="button" onClick={onCancel}>Cancelar edição</button> : null}</div></form>;
}
