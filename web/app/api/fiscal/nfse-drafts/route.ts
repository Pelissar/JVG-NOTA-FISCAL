import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import { buildFocusNfseNationalPayload } from "../../../../lib/focus/nfse-national";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown, max: number, label: string): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new JvgBackendError(`${label} inválido.`, 400);
  const result = value.trim();
  if (result.length > max) throw new JvgBackendError(`${label} excede ${max} caracteres.`, 400);
  return result;
}

function uuid(value: unknown, label: string, optional = false): string {
  if (optional && (value == null || value === "")) return "";
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new JvgBackendError(`${label} inválido.`, 400);
  return value;
}

function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new JvgBackendError(`${label} ausente ou inválida.`, 400);
  return value;
}

function optionalSequence(value: unknown, label: string, maximum: number): string {
  if (value == null || value === "") return "";
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,15}$/.test(raw) || Number(raw) < 1 || Number(raw) > maximum)
    throw new JvgBackendError(`${label} inválido.`, 400);
  return raw;
}

function optionalCode(value: unknown, digits: number, label: string): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !new RegExp(`^\\d{${digits}}$`).test(value.trim()))
    throw new JvgBackendError(`${label} deve conter ${digits} dígitos.`, 400);
  return value.trim();
}

function optionalMoney(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const raw = typeof value === "number" ? value : typeof value === "string" && /^\d{1,9}(?:\.\d{1,2})?$/.test(value.trim()) ? Number(value) : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0 || raw > 999999999 || Math.abs(Math.round(raw * 100) - raw * 100) > 1e-7)
    throw new JvgBackendError("Valor do serviço inválido. Informe um valor maior que zero com até duas casas decimais.", 400);
  return raw;
}

async function accountForRequest(): Promise<SiteAccount> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return account;
}

function scope(account: SiteAccount): string {
  return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
}

async function getServiceRows(account: SiteAccount) {
  const scoped = scope(account);
  try {
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_services?${scoped}&active=eq.true&select=id,code,name,description,national_service_code,national_taxation_code,nbs,sale_price&order=name.asc&limit=500`);
    return { rows, nationalTaxationCodeColumnAvailable: true };
  } catch {
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_services?${scoped}&active=eq.true&select=id,code,name,description,national_service_code,nbs,sale_price&order=name.asc&limit=500`);
    return { rows, nationalTaxationCodeColumnAvailable: false };
  }
}

async function getDpsSequence(account: SiteAccount) {
  try {
    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_companies?tenant_id=${filterEq(account.tenant_id)}&id=${filterEq(account.company_id)}&select=nfse_series_homologacao,nfse_next_number_homologacao&limit=1`);
    return { available: true, series: rows[0]?.nfse_series_homologacao ?? "", number: rows[0]?.nfse_next_number_homologacao ?? "" };
  } catch {
    return { available: false, series: "", number: "" };
  }
}

async function scopedOrder(account: SiteAccount, id: string): Promise<Row> {
  const rows = await dbRequest<Row[]>(`/rest/v1/jvg_service_orders?${scope(account)}&id=${filterEq(id)}&select=id,os_number,customer_id,device_type,brand,model,serial_number,reported_issue,diagnosis,status,customer_approved,estimated_value,created_at,updated_at&limit=1`);
  if (!rows[0]) throw new JvgBackendError("Ordem de serviço não encontrada nesta empresa.", 404);
  return rows[0];
}

async function scopedCustomer(account: SiteAccount, customerId: unknown): Promise<Row | null> {
  if (typeof customerId !== "string" || !uuidPattern.test(customerId)) return null;
  const rows = await dbRequest<Row[]>(`/rest/v1/jvg_parties?${scope(account)}&id=${filterEq(customerId)}&is_customer=eq.true&active=eq.true&select=id,display_name,legal_name,document_type,document_number,email,phone,address&limit=1`);
  return rows[0] ?? null;
}

function taxRules(profile: Row | undefined) {
  const rules = object(profile?.rules);
  const nfse = object(rules.nfse);
  return {
    reviewStatus: String(profile?.review_status || "draft"),
    codigoOpcaoSimplesNacional: nfse.codigoOpcaoSimplesNacional as string | number | undefined,
    regimeTributarioSimplesNacional: nfse.regimeTributarioSimplesNacional as string | number | undefined,
    regimeEspecialTributacao: nfse.regimeEspecialTributacao as string | number | undefined,
    tributacaoIss: nfse.tributacaoIss as string | number | undefined,
  };
}

async function existingDraft(account: SiteAccount, serviceOrderId: string) {
  const key = `nfse-os-${serviceOrderId}`;
  const rows = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scope(account)}&document_type=eq.nfse&environment=eq.homologacao&idempotency_key=${filterEq(key)}&select=id,status,series,document_number,focus_reference,fiscal_payload,created_at,updated_at&limit=1`);
  return rows[0] ?? null;
}

export async function GET(request: Request) {
  try {
    const account = await accountForRequest();
    const serviceOrderId = uuid(new URL(request.url).searchParams.get("serviceOrderId"), "Ordem de serviço");
    const [company, order, serviceCatalog, sequence, profiles] = await Promise.all([
      getCompany(account), scopedOrder(account, serviceOrderId), getServiceRows(account), getDpsSequence(account),
      dbRequest<Row[]>(`/rest/v1/jvg_tax_profiles?${scope(account)}&document_type=eq.nfse&select=id,name,rules,review_status,created_at&order=created_at.desc&limit=100`),
    ]);
    const customer = await scopedCustomer(account, order.customer_id);
    const draft = await existingDraft(account, serviceOrderId);
    const payload = object(draft?.fiscal_payload);
    const source = object(payload.source);
    const savedInput = object(payload.input);
    const companyRegimeConfirmed = company?.tax_regime_confirmation_available === true && company.tax_regime_confirmed === true;
    const companyIsSimple = company?.tax_regime === "simples_nacional";
    const serviceOrderReady = order.status === "delivered" && order.customer_approved === true && Boolean(customer);
    const setupIssues = [
      !company ? "Cadastro fiscal do emitente não encontrado." : "",
      !companyRegimeConfirmed ? "Confirmação do regime tributário indisponível ou pendente nos dados da empresa." : "",
      company && !companyIsSimple ? "Esta etapa atende somente empresa confirmada no Simples Nacional." : "",
      !sequence.available ? "A migration fiscal ainda não disponibilizou a sequência de NFS-e; informe série e número confirmados para esta preparação." : "",
      !serviceCatalog.nationalTaxationCodeColumnAvailable ? "O código nacional ISS ainda não está salvo no catálogo; o código informado abaixo ficará somente nesta preparação." : "",
      order.status !== "delivered" ? "A OS precisa estar entregue." : "",
      order.customer_approved !== true ? "A aprovação do cliente para a OS está pendente." : "",
      !customer ? "A OS precisa ter um cliente ativo com CPF/CNPJ vinculado nesta empresa." : "",
    ].filter(Boolean);
    return apiJson({
      company: company ? {
        id: company.id, legalName: company.legal_name, tradeName: company.trade_name, cnpj: company.cnpj,
        municipalRegistration: company.municipal_registration, fiscalEmail: company.fiscal_email,
        fiscalPhone: company.fiscal_phone, address: company.address, taxRegime: company.tax_regime,
        taxRegimeConfirmed: companyRegimeConfirmed,
      } : null,
      serviceOrder: order,
      customer,
      services: serviceCatalog.rows,
      profiles,
      sequence: { ...sequence, series: draft?.series ?? savedInput.series ?? sequence.series, number: draft?.document_number ?? savedInput.number ?? sequence.number },
      capabilities: { nationalTaxationCodeColumnAvailable: serviceCatalog.nationalTaxationCodeColumnAvailable, nfseSequenceColumnsAvailable: sequence.available },
      setupIssues,
      serviceOrderReady,
      canSaveDraft: Boolean(company && companyIsSimple && companyRegimeConfirmed && serviceOrderReady && account.role !== "viewer"),
      existingDraft: draft ? {
        id: draft.id, status: draft.status, focusReference: draft.focus_reference, createdAt: draft.created_at, updatedAt: draft.updated_at,
        input: savedInput,
        source,
        preview: object(payload.preview),
      } : null,
      transmissionEnabled: false,
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await accountForRequest();
    if (account.role === "viewer") throw new JvgBackendError("Seu perfil não pode preparar NFS-e.", 403);
    const raw = await request.text();
    if (raw.length > 24_000) throw new JvgBackendError("Os dados da preparação excedem o limite permitido.", 413);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    const input = object(parsed);
    const serviceOrderId = uuid(input.serviceOrderId, "Ordem de serviço");
    const serviceId = uuid(input.serviceId, "Serviço", true);
    const profileId = uuid(input.profileId, "Perfil fiscal", true);
    const company = await getCompany(account);
    if (!company) throw new JvgBackendError("Empresa emitente não encontrada.", 404);
    if (company.tax_regime_confirmation_available !== true || company.tax_regime_confirmed !== true)
      throw new JvgBackendError("A confirmação do regime tributário precisa estar salva nos dados da empresa.", 409);
    if (company.tax_regime !== "simples_nacional")
      throw new JvgBackendError("Esta etapa de preparação está limitada ao Simples Nacional confirmado.", 409);

    const order = await scopedOrder(account, serviceOrderId);
    if (order.status !== "delivered" || order.customer_approved !== true)
      throw new JvgBackendError("Somente uma OS entregue e aprovada pelo cliente pode originar NFS-e.", 409);
    const customer = await scopedCustomer(account, order.customer_id);
    if (!customer) throw new JvgBackendError("A OS precisa ter um cliente ativo com CPF/CNPJ vinculado nesta empresa.", 409);
    const serviceCatalog = await getServiceRows(account);
    const service = serviceId ? serviceCatalog.rows.find(row => String(row.id) === serviceId) : undefined;
    if (serviceId && !service) throw new JvgBackendError("O serviço não pertence a esta empresa ou está inativo.", 400);

    const profiles = await dbRequest<Row[]>(`/rest/v1/jvg_tax_profiles?${scope(account)}&document_type=eq.nfse&select=id,name,rules,review_status,reviewed_by&order=created_at.desc&limit=200`);
    const profile = profileId ? profiles.find(row => String(row.id) === profileId) : undefined;
    if (profileId && !profile) throw new JvgBackendError("O perfil de NFS-e não pertence a esta empresa.", 400);

    const sequence = await getDpsSequence(account);
    const series = optionalSequence(input.series || sequence.series, "Série da DPS", 49999);
    const number = optionalSequence(input.number || sequence.number, "Número da DPS", 999999999999999);
    const serviceValue = optionalMoney(input.serviceValue);
    if (serviceValue !== undefined && input.confirmServiceValue !== true)
      throw new JvgBackendError("Confirme que este é o valor final aprovado para faturamento desta OS.", 400);
    const codeOverride = optionalCode(input.nationalTaxationCode, 6, "Código nacional ISS");
    const serviceDescription = text(input.serviceDescription, 1000, "Descrição do serviço");
    const purpose = input.finalidadeEmissao === "0" ? "0" : "";
    const consumerFinal = input.consumidorFinal === "0" || input.consumidorFinal === "1" ? input.consumidorFinal : "";
    const recipientIndicator = input.indicadorDestinatario === "0" || input.indicadorDestinatario === "1" ? input.indicadorDestinatario : "";
    const issueAt = text(input.dataEmissao, 40, "Data e hora de emissão");
    const competence = input.dataCompetencia ? date(input.dataCompetencia, "Data de competência") : "";
    const serviceCityCode = optionalCode(input.codigoMunicipioPrestacao, 7, "Código IBGE do município de prestação");
    const dps = {
      serie: series, numero: number, finalidadeEmissao: purpose,
      consumidorFinal: consumerFinal, indicadorDestinatario: recipientIndicator,
      dataEmissao: issueAt, dataCompetencia: competence, codigoMunicipioPrestacao: serviceCityCode,
    };
    const selectedService: Row = service ?? { id: "", code: "", name: "", description: "", national_service_code: "", nbs: "" };
    const sourceService: Row = {
      ...selectedService,
      national_taxation_code: codeOverride || selectedService.national_taxation_code || "",
      lc116: selectedService.national_service_code || "",
      description: serviceDescription || selectedService.description || "",
    };
    const documentId = crypto.randomUUID();
    const mapped = buildFocusNfseNationalPayload({
      documentId,
      company: {
        cnpj: company.cnpj, legal_name: company.legal_name, trade_name: company.trade_name,
        municipal_registration: company.municipal_registration, fiscal_email: company.fiscal_email,
        fiscal_phone: company.fiscal_phone, address: company.address,
      },
      customer,
      service: sourceService,
      serviceOrder: order,
      serviceValue,
      approvedTaxRules: taxRules(profile),
      dps,
    });
    const idempotencyKey = `nfse-os-${serviceOrderId}`;
    const existing = await existingDraft(account, serviceOrderId);
    if (existing && existing.status !== "draft")
      throw new JvgBackendError("Esta OS já possui um documento fiscal transmitido. Esta tela não pode substituí-lo.", 409);
    const draftId = existing?.id && uuidPattern.test(String(existing.id)) ? String(existing.id) : documentId;
    const reference = existing?.focus_reference && /^[A-Za-z0-9]{1,50}$/.test(String(existing.focus_reference))
      ? String(existing.focus_reference) : mapped.reference;
    const payload = {
      schema: "jvg_nfse_nacional_draft_v1",
      documentType: "nfse_nacional",
      source: {
        serviceOrder: { id: order.id, number: order.os_number, status: order.status, customerApproved: order.customer_approved },
        service: { id: sourceService.id || null, code: sourceService.code || null, name: sourceService.name || null, lc116: sourceService.lc116 || null, nationalTaxationCode: sourceService.national_taxation_code || null, nbs: sourceService.nbs || null },
        customer: { id: customer.id, name: customer.legal_name || customer.display_name, documentType: customer.document_type, documentNumber: customer.document_number },
        taxProfile: profile ? { id: profile.id, name: profile.name, reviewStatus: profile.review_status } : null,
      },
      input: {
        serviceOrderId, serviceId, profileId, serviceValue: serviceValue ?? "", serviceDescription,
        nationalTaxationCode: codeOverride, series, number, finalidadeEmissao: purpose,
        consumidorFinal: consumerFinal, indicadorDestinatario: recipientIndicator,
        dataEmissao: issueAt, dataCompetencia: competence, codigoMunicipioPrestacao: serviceCityCode,
      },
      preview: { reference, payload: mapped.payload, issues: mapped.issues, warnings: mapped.warnings, ibsCbsIncluded: false },
      preparedAt: new Date().toISOString(),
      transmissionEnabled: false,
    };
    const row = {
      id: draftId, tenant_id: account.tenant_id, company_id: account.company_id,
      document_type: "nfse", environment: "homologacao", status: "draft",
      series: series || null, document_number: number ? Number(number) : null,
      focus_reference: reference, idempotency_key: idempotencyKey, fiscal_payload: payload,
      recipient_party_id: customer.id, recipient_document: customer.document_number || null,
      updated_at: new Date().toISOString(),
    };
    let saved: Row[];
    if (existing) {
      saved = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scope(account)}&id=${filterEq(String(existing.id))}&document_type=eq.nfse&environment=eq.homologacao&status=eq.draft`, {
        method: "PATCH", body: JSON.stringify({ ...row, id: undefined, tenant_id: undefined, company_id: undefined, document_type: undefined, environment: undefined, status: undefined, idempotency_key: undefined, created_at: undefined }),
      });
    } else {
      saved = await dbRequest<Row[]>("/rest/v1/jvg_fiscal_documents", {
        method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" },
      });
    }
    const persistedId = String(saved[0]?.id || existing?.id || draftId);
    return apiJson({
      ok: true, draft: { id: persistedId, status: "draft", focusReference: reference, preview: payload.preview },
      transmissionEnabled: false,
      message: mapped.issues.length ? "Preparação salva com pendências. Corrija os dados e confira as regras fiscais antes de qualquer emissão futura." : "Prévia mapeada; nenhum documento foi transmitido.",
    }, existing ? 200 : 201);
  } catch (error) { return safeError(error); }
}
