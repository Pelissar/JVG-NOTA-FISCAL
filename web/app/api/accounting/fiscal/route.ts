import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError, str, type SiteAccount } from "../../../../lib/jvg-backend";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGIMES = new Set(["mei", "simples_nacional", "lucro_presumido", "lucro_real", "outro"]);
const RTC_PRODUCT_FIELDS = ["rtc_cst", "rtc_class_trib", "rtc_simple_activity"] as const;
const PRODUCT_FIELDS = new Set(["ncm", "cest", "origin", "default_cfop", "default_csosn", "default_pis_cst", "default_cofins_cst", ...RTC_PRODUCT_FIELDS]);

async function current() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  const role = account.member_role || account.role || "viewer";
  if (!["owner", "admin", "manager", "accounting"].includes(role))
    throw new JvgBackendError("Acesso fiscal não autorizado para este perfil.", 403);
  return { user, account, role };
}
function scope(account: SiteAccount) { return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`; }
function missingSchema(error: unknown) {
  return error instanceof JvgBackendError && ["PGRST204", "PGRST205", "42703", "42P01"].includes(error.databaseCode || "");
}
async function audit(account: SiteAccount, actor: string, action: string, entityType: string, entityId: string, before: Row, after: Row) {
  await dbRequest("/rest/v1/jvg_company_fiscal_audit", { method: "POST", body: JSON.stringify({
    tenant_id: account.tenant_id, company_id: account.company_id, actor_user_id: actor,
    action, entity_type: entityType, entity_id: entityId, before_values: before, after_values: after,
  }) });
}

export async function GET() {
  try {
    const { account, role } = await current();
    const company = await getCompany(account);
    if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
    const scopeQuery = scope(account);
    let products: Row[] = [];
    let migrationReady = true;
    try {
      products = await dbRequest<Row[]>(`/rest/v1/jvg_products?${scopeQuery}&active=eq.true&select=id,sku,name,unit,ncm,cest,origin,default_cfop,default_csosn,default_pis_cst,default_cofins_cst,rtc_cst,rtc_class_trib,rtc_simple_activity&order=name.asc&limit=500`);
      await dbRequest<Row[]>(`/rest/v1/jvg_company_fiscal_audit?${scopeQuery}&select=id&limit=1`);
    } catch (error) {
      if (!missingSchema(error)) throw error;
      migrationReady = false;
      products = await dbRequest<Row[]>(`/rest/v1/jvg_products?${scopeQuery}&active=eq.true&select=id,sku,name,unit,ncm,cest,origin&order=name.asc&limit=500`);
    }
    const drafts = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scopeQuery}&document_type=eq.nfe&environment=eq.homologacao&status=eq.draft&select=id,status,fiscal_payload,created_at,updated_at&order=created_at.desc&limit=100`);
    let calculations: Row[] = [];
    let auditRecords: Row[] = [];
    if (migrationReady) {
      try {
        [calculations, auditRecords] = await Promise.all([
          dbRequest<Row[]>(`/rest/v1/jvg_fiscal_rtc_calculations?${scopeQuery}&select=id,fiscal_document_id,regime,calculator_endpoint,calculator_version,request_version,simulated_data_warning,created_at,result_snapshot&order=created_at.desc&limit=100`),
          dbRequest<Row[]>(`/rest/v1/jvg_company_fiscal_audit?${scopeQuery}&select=id,actor_user_id,action,entity_type,entity_id,before_values,after_values,created_at&order=created_at.desc&limit=100`),
        ]);
      } catch (error) { if (missingSchema(error)) migrationReady = false; else throw error; }
    }
    const safeCompany = {
      id: company.id, legalName: company.legal_name, tradeName: company.trade_name,
      cnpj: company.cnpj, stateRegistration: company.state_registration,
      municipalRegistration: company.municipal_registration, cnae: company.cnae,
      taxRegime: company.tax_regime, taxRegimeConfirmed: company.tax_regime_confirmed === true,
      regimeConfirmationAvailable: company.tax_regime_confirmation_available === true,
      crt: company.crt ?? null, tpRegimeIbsCbs: company.tp_regime_ibs_cbs ?? null,
      address: company.address,
    };
    const safeDrafts = drafts.map((row) => {
      const payload = row.fiscal_payload && typeof row.fiscal_payload === "object" ? row.fiscal_payload as Row : {};
      const recipient = payload.recipient && typeof payload.recipient === "object" ? payload.recipient as Row : {};
      const items = Array.isArray(payload.items) ? payload.items as Row[] : [];
      return {
        id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
        recipientName: str(recipient.name, 160) || "Destinatário", issueAt: str(payload.issueAt, 40),
        totalCents: Number(payload.commercialTotalCents ?? payload.totalCents ?? 0),
        items: items.map((item, index) => ({
          number: index + 1, productId: str(item.productId, 40), description: str(item.description, 180),
          ncm: str(item.ncm, 8), quantity: item.quantity, unit: str(item.unit, 6), subtotalCents: Number(item.subtotalCents || 0),
        })),
      };
    });
    return apiJson({ company: safeCompany, products, drafts: safeDrafts, calculations, auditRecords, migrationReady,
      rtcEnabled: process.env.JVG_RTC_ENABLED === "true", canManageInvites: ["owner", "admin"].includes(role),
      configurationAudit: migrationReady ? undefined : "Aplique a migration 20261118_jvg_accountant_rtc.sql para salvar classificações RTC, cálculos e histórico." });
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { user, account } = await current();
    const raw = await request.text();
    if (raw.length > 12000) throw new JvgBackendError("Cadastro muito extenso.", 413);
    let body: Row;
    try { body = JSON.parse(raw) as Row; } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    const target = str(body.target, 20);
    const fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? body.fields as Row : null;
    if (!fields) throw new JvgBackendError("Informe os campos fiscais para salvar.", 400);
    // Do not mutate fiscal data without a durable audit trail.
    try {
      await dbRequest<Row[]>(`/rest/v1/jvg_company_fiscal_audit?${scope(account)}&select=id&limit=1`);
    } catch (error) {
      if (missingSchema(error)) throw new JvgBackendError("A migration 20261118_jvg_accountant_rtc.sql precisa ser aplicada antes de alterar dados fiscais, para que as mudanças fiquem auditadas.", 409);
      throw error;
    }

    if (target === "company") {
      const allowed: Row = {};
      if ("taxRegime" in fields) {
        if (typeof fields.taxRegime !== "string" || !REGIMES.has(fields.taxRegime)) throw new JvgBackendError("Selecione um regime tributário válido.", 400);
        allowed.tax_regime = fields.taxRegime;
      }
      if ("taxRegimeConfirmed" in fields) {
        if (typeof fields.taxRegimeConfirmed !== "boolean") throw new JvgBackendError("Confirmação fiscal inválida.", 400);
        allowed.tax_regime_confirmed = fields.taxRegimeConfirmed;
      }
      if ("crt" in fields) {
        if (fields.crt === null || fields.crt === "") allowed.crt = null;
        else if (![1, 2, 3, 4].includes(Number(fields.crt))) throw new JvgBackendError("Informe um CRT oficial de 1 a 4 ou deixe em branco.", 400);
        else allowed.crt = Number(fields.crt);
      }
      if ("tpRegimeIbsCbs" in fields) {
        if (fields.tpRegimeIbsCbs === null || fields.tpRegimeIbsCbs === "") allowed.tp_regime_ibs_cbs = null;
        else if (fields.tpRegimeIbsCbs !== "1" && fields.tpRegimeIbsCbs !== "2") throw new JvgBackendError("Tipo de regime IBS/CBS inválido.", 400);
        else allowed.tp_regime_ibs_cbs = fields.tpRegimeIbsCbs;
      }
      if (!Object.keys(allowed).length) throw new JvgBackendError("Não há campos fiscais da empresa para salvar.", 400);
      allowed.updated_at = new Date().toISOString();
      const before = await getCompany(account);
      if (!before) throw new JvgBackendError("Empresa não encontrada.", 404);
      try {
        await dbRequest(`/rest/v1/jvg_companies?tenant_id=${filterEq(account.tenant_id)}&id=${filterEq(account.company_id)}`, { method: "PATCH", body: JSON.stringify(allowed) });
      } catch (error) {
        if (missingSchema(error)) throw new JvgBackendError("A migration do acesso fiscal/RTC ainda não foi aplicada no banco.", 409);
        throw error;
      }
      const beforeValues: Row = {};
      const afterValues: Row = {};
      for (const column of ["tax_regime", "tax_regime_confirmed", "crt", "tp_regime_ibs_cbs"]) {
        if (column in allowed) { beforeValues[column] = (before as Row)[column] ?? null; afterValues[column] = allowed[column]; }
      }
      await audit(account, user.userId, "company_fiscal_update", "company", account.company_id, beforeValues, afterValues);
      return apiJson({ ok: true, target, savedFields: Object.keys(allowed).filter((key) => key !== "updated_at") });
    }

    if (target === "product") {
      const productId = str(body.productId, 40);
      if (!UUID.test(productId)) throw new JvgBackendError("Produto inválido.", 400);
      const rtcRequested = Object.keys(fields).some((key) => (RTC_PRODUCT_FIELDS as readonly string[]).includes(key));
      const productColumns = "id,ncm,cest,origin,default_cfop,default_csosn,default_pis_cst,default_cofins_cst" + (rtcRequested ? ",rtc_cst,rtc_class_trib,rtc_simple_activity" : "");
      let currentRows: Row[];
      try {
        currentRows = await dbRequest<Row[]>(`/rest/v1/jvg_products?${scope(account)}&id=${filterEq(productId)}&select=${productColumns}&limit=1`);
      } catch (error) {
        if (rtcRequested && missingSchema(error)) throw new JvgBackendError("A migration 20261118_jvg_accountant_rtc.sql ainda não está aplicada; os campos da Reforma Tributária continuam indisponíveis.", 409);
        throw error;
      }
      const currentProduct = currentRows[0];
      if (!currentProduct) throw new JvgBackendError("Produto não encontrado nesta empresa.", 404);
      const allowed: Row = {};
      const mappings: Record<string, [RegExp, string]> = {
        ncm: [/^\d{8}$/, "NCM"], cest: [/^\d{7}$/, "CEST"], origin: [/^[0-8]$/, "Origem"],
        default_cfop: [/^\d{4}$/, "CFOP"], default_csosn: [/^\d{3}$/, "CSOSN"],
        default_pis_cst: [/^\d{2}$/, "CST do PIS"], default_cofins_cst: [/^\d{2}$/, "CST da Cofins"],
        rtc_cst: [/^\d{3}$/, "CST IBS/CBS"], rtc_class_trib: [/^\d{6}$/, "cClassTrib"], rtc_simple_activity: [/^\d{2}$/, "cAtivSN"],
      };
      for (const key of Object.keys(fields)) {
        if (!PRODUCT_FIELDS.has(key)) throw new JvgBackendError(`Campo de produto não permitido: ${key}.`, 400);
        const rawValue = fields[key];
        if (rawValue === null || rawValue === "") { allowed[key] = null; continue; }
        if (typeof rawValue !== "string") throw new JvgBackendError(`${mappings[key][1]} inválido.`, 400);
        const clean = rawValue.trim();
        if (!mappings[key][0].test(clean)) throw new JvgBackendError(`${mappings[key][1]} inválido.`, 400);
        allowed[key] = clean;
      }
      if (!Object.keys(allowed).length) throw new JvgBackendError("Não há campos de produto para salvar.", 400);
      allowed.updated_at = new Date().toISOString();
      await dbRequest(`/rest/v1/jvg_products?${scope(account)}&id=${filterEq(productId)}`, { method: "PATCH", body: JSON.stringify(allowed) });
      const beforeValues: Row = {}; const afterValues: Row = {};
      for (const key of Object.keys(allowed)) if (key !== "updated_at") { beforeValues[key] = currentProduct[key] ?? null; afterValues[key] = allowed[key]; }
      try { await audit(account, user.userId, "product_fiscal_update", "product", productId, beforeValues, afterValues); }
      catch (error) { if (missingSchema(error)) throw new JvgBackendError("Alteração salva, mas o histórico fiscal depende da migration pendente.", 409); throw error; }
      return apiJson({ ok: true, target, productId, savedFields: Object.keys(allowed).filter((key) => key !== "updated_at") });
    }
    throw new JvgBackendError("Tipo de cadastro inválido.", 400);
  } catch (error) { return safeError(error); }
}
