import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError,
  type SiteAccount,
} from "../../../../lib/jvg-backend";
import { isOfficialCfopCode } from "../../../../lib/fiscal/cfop";
import { parseFocusTaxFields, reviewFocusTaxRule } from "../../../../lib/fiscal/focus-tax-fields";

export const dynamic = "force-dynamic";

type Profile = { id: string; name: string; rules: Record<string, unknown>; review_status: string; created_at: string };
type Operation = "interna" | "interestadual";
const operations = new Set<Operation>(["interna", "interestadual"]);
const csosn = new Set(["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]);
const legacyRuleKeys = ["cfop", "csosn", "pisCst", "cofinsCst", "cstIbsCbs", "classTrib", "previewRates"];

async function account() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const result = await getSiteAccount(user);
  if (!result) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return { user, account: result };
}
function scope(a: SiteAccount): string {
  return `tenant_id=${filterEq(a.tenant_id)}&company_id=${filterEq(a.company_id)}`;
}
function canEdit(a: SiteAccount): boolean {
  return ["owner", "admin", "manager"].includes(a.role || "");
}
function textValue(raw: unknown, size: number): string {
  if (raw == null || raw === "") return "";
  if (typeof raw !== "string" || raw.trim().length > size) throw new JvgBackendError("Campo fiscal inválido ou muito extenso.", 400);
  return raw.trim().toUpperCase();
}
function object(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}
async function confirmedCompany(a: SiteAccount) {
  const company = await getCompany(a);
  if (company?.tax_regime_confirmation_available !== true)
    throw new JvgBackendError("A confirmação do regime precisa estar disponível nos dados fiscais da empresa.", 409);
  if (company.tax_regime_confirmed !== true)
    throw new JvgBackendError("Confirme o regime tributário com a contabilidade nos dados da empresa antes de criar perfis fiscais.", 409);
  if (company.tax_regime !== "simples_nacional")
    throw new JvgBackendError("Esta versão aceita perfis fiscais apenas para empresas confirmadas no Simples Nacional.", 409);
  return company;
}
async function readBody(request: Request, maximum = 8000): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > maximum) throw new JvgBackendError("Cadastro muito extenso.", 413);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new JvgBackendError("Cadastro inválido.", 400);
  return input as Record<string, unknown>;
}
function profileFields(input: Record<string, unknown>) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 3 || name.length > 120) throw new JvgBackendError("Nome deve ter de 3 a 120 caracteres.", 400);
  const operationValue = typeof input.operation === "string" ? input.operation.trim() : "";
  if (operationValue !== "interna" && operationValue !== "interestadual")
    throw new JvgBackendError("Escolha uma operação interna ou interestadual.", 400);
  const operation: Operation = operationValue;
  const cfop = textValue(input.cfop, 4);
  const csosnValue = textValue(input.csosn, 3);
  const pisCst = textValue(input.pisCst, 2);
  const cofinsCst = textValue(input.cofinsCst, 2);
  const cstIbsCbs = textValue(input.cstIbsCbs, 3);
  const classTrib = textValue(input.classTrib, 6);
  const ibsCbsRegularRegimeEnabled = input.ibsCbsRegularRegimeEnabled === true;
  let focusFields: Record<string, number>;
  try { focusFields = parseFocusTaxFields(input.focusFields); }
  catch (error) {
    throw new JvgBackendError(error instanceof Error ? error.message : "Campos numéricos Focus inválidos.", 400);
  }
  if (cfop && !isOfficialCfopCode(cfop)) throw new JvgBackendError("CFOP não consta do catálogo oficial.", 400);
  if (csosnValue && !csosn.has(csosnValue)) throw new JvgBackendError("CSOSN inválido.", 400);
  if (pisCst && !/^\d{2}$/.test(pisCst)) throw new JvgBackendError("CST PIS deve ter 2 dígitos.", 400);
  if (cofinsCst && !/^\d{2}$/.test(cofinsCst)) throw new JvgBackendError("CST Cofins deve ter 2 dígitos.", 400);
  if (cstIbsCbs && !/^\d{3}$/.test(cstIbsCbs)) throw new JvgBackendError("CST IBS/CBS deve ter 3 dígitos.", 400);
  if (classTrib && !/^\d{6}$/.test(classTrib)) throw new JvgBackendError("Classificação tributária IBS/CBS deve ter 6 dígitos.", 400);
  return {
    name,
    operation,
    rule: { cfop, csosn: csosnValue, pisCst, cofinsCst, cstIbsCbs, classTrib, focusFields,
      ibsCbsRegularRegimeEnabled, requiresAccountantReview: true },
  };
}
function withoutLegacyFields(rules: Record<string, unknown>) {
  const clean = { ...rules };
  for (const key of legacyRuleKeys) delete clean[key];
  delete clean.accountantReview;
  return clean;
}

export async function GET() {
  try {
    const { account: a } = await account();
    const rows = await dbRequest<Profile[]>(
      `/rest/v1/jvg_tax_profiles?${scope(a)}&document_type=eq.nfe&select=id,name,rules,review_status,created_at&order=created_at.desc&limit=200`,
    );
    const company = await getCompany(a);
    return apiJson({ records: rows, editable: canEdit(a),
      taxRegime: company?.tax_regime_confirmed === true ? company.tax_regime : null,
      taxRegimeConfirmed: company?.tax_regime_confirmed === true,
      regimeConfirmationAvailable: company?.tax_regime_confirmation_available === true,
      transmissionEnabled: false });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account: a } = await account();
    if (!canEdit(a)) throw new JvgBackendError("Sua conta não pode alterar perfis fiscais.", 403);
    const company = await confirmedCompany(a);
    const input = await readBody(request);
    const parsed = profileFields(input);
    const rules = {
      regime: company.tax_regime,
      operations: { [parsed.operation]: parsed.rule },
      previewOnly: true,
      taxCalculationEnabled: false,
      requiresAccountantReview: true,
    };
    const result = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_tax_profiles", {
      method: "POST",
      body: JSON.stringify({ tenant_id: a.tenant_id, company_id: a.company_id,
        name: parsed.name, document_type: "nfe", rules, review_status: "draft" }),
    });
    return apiJson({ ok: true, id: result[0]?.id, reviewStatus: "draft", operation: parsed.operation, transmissionEnabled: false }, 201);
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { user, account: a } = await account();
    if (!canEdit(a)) throw new JvgBackendError("Sua conta não pode alterar perfis fiscais.", 403);
    const company = await confirmedCompany(a);
    const input = await readBody(request);
    const id = typeof input.id === "string" ? input.id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new JvgBackendError("Identificador do perfil inválido.", 400);
    const selected = await dbRequest<Profile[]>(
      `/rest/v1/jvg_tax_profiles?${scope(a)}&id=${filterEq(id)}&document_type=eq.nfe&select=id,name,rules,review_status,created_at&limit=1`,
    );
    const profile = selected[0];
    if (!profile) throw new JvgBackendError("Perfil não encontrado nesta empresa.", 404);

    if (input.action === "register-accountant-review") {
      if (input.confirmed !== true) throw new JvgBackendError("Confirme que os dados foram conferidos com a contabilidade.", 400);
      const accountantName = typeof input.accountantName === "string" ? input.accountantName.trim() : "";
      const accountantCrc = typeof input.accountantCrc === "string" ? input.accountantCrc.trim().slice(0, 30) : "";
      if (accountantName.length < 3 || accountantName.length > 120)
        throw new JvgBackendError("Informe o nome do contador ou escritório (3 a 120 caracteres).", 400);
      const rules = object(profile.rules);
      const configuredOperations = object(rules.operations);
      const configuredEntries = Object.entries(configuredOperations);
      if (!configuredEntries.length)
        throw new JvgBackendError("Cadastre ao menos uma regra por operação antes de registrar a revisão.", 409);
      const incomplete = configuredEntries.some(([key, rawRule]) => {
        if (!operations.has(key as Operation)) return true;
        const rule = object(rawRule);
        const ibsCbsRequired = company.tax_regime !== "simples_nacional" && rule.ibsCbsRegularRegimeEnabled === true;
        return !isOfficialCfopCode(String(rule.cfop || "")) || !csosn.has(String(rule.csosn || "")) ||
          !/^\d{2}$/.test(String(rule.pisCst || "")) || !/^\d{2}$/.test(String(rule.cofinsCst || "")) ||
          (ibsCbsRequired && (!/^\d{3}$/.test(String(rule.cstIbsCbs || "")) || !/^\d{6}$/.test(String(rule.classTrib || ""))));
      });
      if (incomplete)
        throw new JvgBackendError("Cada operação precisa ter CFOP, CSOSN e CST de PIS/Cofins. CST/classificação IBS-CBS só são exigidos quando a flag futura está ativa para regime regular.", 409);
      const focusIssues = configuredEntries.flatMap(([key, rawRule]) => {
        const rule = object(rawRule);
        const review = reviewFocusTaxRule(rule, {
          includeIbsCbs: company.tax_regime !== "simples_nacional" && rule.ibsCbsRegularRegimeEnabled === true,
        });
        const issues = [
          ...review.icmsMissing.map(field => `ICMS ${field}`),
          ...review.pisCofinsMissing.map(field => `PIS/Cofins ${field}`),
          ...review.ibsCbsMissing.map(field => `IBS/CBS ${field}`),
          ...review.invalidFields.map(field => `campo inválido ${field}`),
          ...review.unsupported,
        ];
        return issues.map(issue => `${key}: ${issue}`);
      });
      if (focusIssues.length)
        throw new JvgBackendError(`Há campos Focus obrigatórios pendentes ou combinações ainda não mapeadas: ${focusIssues.slice(0, 8).join("; ")}.`, 409);
      const reviewedRules = {
        ...rules,
        accountantReview: { name: accountantName, crc: accountantCrc, declaredBy: user.userId, declaredAt: new Date().toISOString() },
        requiresAccountantReview: false,
      };
      const updated = await dbRequest<Array<{ id: string; review_status: string }>>(
        `/rest/v1/jvg_tax_profiles?${scope(a)}&id=${filterEq(id)}&document_type=eq.nfe`,
        { method: "PATCH", body: JSON.stringify({ rules: reviewedRules, review_status: "reviewed", reviewed_by: user.userId }) },
      );
      return apiJson({ ok: true, id: updated[0]?.id || id, reviewStatus: "reviewed", transmissionEnabled: false,
        note: "A revisão é uma declaração registrada pelo usuário; o sistema não autentica o contador nem libera emissão." });
    }

    const parsed = profileFields(input);
    const rules = withoutLegacyFields(object(profile.rules));
    const configured = object(rules.operations);
    const mergedRules = {
      ...rules,
      regime: company.tax_regime,
      operations: { ...configured, [parsed.operation]: parsed.rule },
      previewOnly: true,
      taxCalculationEnabled: false,
      requiresAccountantReview: true,
    };
    const updated = await dbRequest<Array<{ id: string }>>(
      `/rest/v1/jvg_tax_profiles?${scope(a)}&id=${filterEq(id)}&document_type=eq.nfe`,
      { method: "PATCH", body: JSON.stringify({ name: parsed.name, rules: mergedRules, review_status: "draft", reviewed_by: null }) },
    );
    return apiJson({ ok: true, id: updated[0]?.id || id, reviewStatus: "draft", operation: parsed.operation, transmissionEnabled: false });
  } catch (error) { return safeError(error); }
}
