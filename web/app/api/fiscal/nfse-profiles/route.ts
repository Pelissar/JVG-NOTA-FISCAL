import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const simpleOptions = new Set(["1", "2", "3"]);
const specialRegimes = new Set(["0", "1", "2", "3", "4", "5", "6", "9"]);
const issTaxations = new Set(["1", "2", "3", "4"]);

function scope(account: SiteAccount): string {
  return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
}

async function context() {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return { user, account };
}

function canEdit(account: SiteAccount): boolean {
  return ["owner", "admin", "manager"].includes(account.role || "");
}

function fiscalRules(input: Row) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 3 || name.length > 120) throw new JvgBackendError("Informe um nome de perfil entre 3 e 120 caracteres.", 400);
  const simpleOption = typeof input.codigoOpcaoSimplesNacional === "string" ? input.codigoOpcaoSimplesNacional.trim() : "";
  const specialRegime = typeof input.regimeEspecialTributacao === "string" ? input.regimeEspecialTributacao.trim() : "";
  const issTaxation = typeof input.tributacaoIss === "string" ? input.tributacaoIss.trim() : "";
  const simpleTaxRegime = typeof input.regimeTributarioSimplesNacional === "string" ? input.regimeTributarioSimplesNacional.trim() : "";
  if (simpleOption && !simpleOptions.has(simpleOption)) throw new JvgBackendError("Opção do Simples deve ser 1, 2 ou 3, conforme orientação contábil.", 400);
  if (specialRegime && !specialRegimes.has(specialRegime)) throw new JvgBackendError("Regime especial de tributação inválido.", 400);
  if (issTaxation && !issTaxations.has(issTaxation)) throw new JvgBackendError("Tributação do ISS deve ser de 1 a 4.", 400);
  if (simpleTaxRegime && !["1", "2", "3"].includes(simpleTaxRegime)) throw new JvgBackendError("Regime de apuração do Simples inválido.", 400);
  return {
    name,
    nfse: {
      codigoOpcaoSimplesNacional: simpleOption,
      regimeEspecialTributacao: specialRegime,
      tributacaoIss: issTaxation,
      regimeTributarioSimplesNacional: simpleTaxRegime,
      requiresAccountantReview: true,
    },
    regime: "simples_nacional",
    requiresAccountantReview: true,
    previewOnly: true,
  };
}

async function readBody(request: Request): Promise<Row> {
  const raw = await request.text();
  if (raw.length > 8000) throw new JvgBackendError("Perfil fiscal muito grande.", 413);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new JvgBackendError("Perfil fiscal inválido.", 400);
  return parsed as Row;
}

async function confirmedSimpleCompany(account: SiteAccount) {
  const company = await getCompany(account);
  if (!company) throw new JvgBackendError("Empresa emitente não encontrada.", 404);
  if (company.tax_regime_confirmation_available !== true || company.tax_regime_confirmed !== true)
    throw new JvgBackendError("Confirme o regime tributário nos dados da empresa antes de cadastrar o perfil.", 409);
  if (company.tax_regime !== "simples_nacional")
    throw new JvgBackendError("Esta etapa aceita perfil de NFS-e para o Simples Nacional confirmado.", 409);
  return company;
}

export async function GET() {
  try {
    const { account } = await context();
    const [records, company] = await Promise.all([
      dbRequest<Row[]>(`/rest/v1/jvg_tax_profiles?${scope(account)}&document_type=eq.nfse&select=id,name,rules,review_status,reviewed_by,created_at,updated_at&order=created_at.desc&limit=100`),
      getCompany(account),
    ]);
    return apiJson({ records, editable: canEdit(account), taxRegime: company?.tax_regime || null,
      taxRegimeConfirmed: company?.tax_regime_confirmation_available === true && company.tax_regime_confirmed === true,
      transmissionEnabled: false });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account } = await context();
    if (!canEdit(account)) throw new JvgBackendError("Seu perfil não pode alterar perfis fiscais.", 403);
    await confirmedSimpleCompany(account);
    const input = await readBody(request);
    const rules = fiscalRules(input);
    const rows = await dbRequest<Row[]>("/rest/v1/jvg_tax_profiles", {
      method: "POST", body: JSON.stringify({ tenant_id: account.tenant_id, company_id: account.company_id,
        name: rules.name, document_type: "nfse", rules, review_status: "draft" }),
    });
    return apiJson({ ok: true, profile: rows[0] || null, transmissionEnabled: false }, 201);
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account, user } = await context();
    if (!canEdit(account)) throw new JvgBackendError("Seu perfil não pode revisar perfis fiscais.", 403);
    await confirmedSimpleCompany(account);
    const input = await readBody(request);
    const id = typeof input.id === "string" ? input.id : "";
    if (!uuidPattern.test(id)) throw new JvgBackendError("Identificador do perfil inválido.", 400);
    const selected = await dbRequest<Row[]>(`/rest/v1/jvg_tax_profiles?${scope(account)}&id=${filterEq(id)}&document_type=eq.nfse&select=id,name,rules,review_status&limit=1`);
    const profile = selected[0];
    if (!profile) throw new JvgBackendError("Perfil de NFS-e não encontrado nesta empresa.", 404);
    if (profile.review_status === "reviewed") throw new JvgBackendError("Perfil revisado não pode ser alterado. Crie outro perfil para uma nova orientação.", 409);
    const rules = fiscalRules(input);
    if (input.action === "register-accountant-review") {
      if (input.confirmed !== true) throw new JvgBackendError("Confirme que os códigos foram conferidos com a contabilidade.", 400);
      const accountantName = typeof input.accountantName === "string" ? input.accountantName.trim() : "";
      const accountantCrc = typeof input.accountantCrc === "string" ? input.accountantCrc.trim().slice(0, 30) : "";
      if (accountantName.length < 3 || accountantName.length > 120) throw new JvgBackendError("Informe o nome do contador ou escritório.", 400);
      const nfse = rules.nfse;
      if (!simpleOptions.has(String(nfse.codigoOpcaoSimplesNacional)) ||
          !specialRegimes.has(String(nfse.regimeEspecialTributacao)) ||
          !issTaxations.has(String(nfse.tributacaoIss)))
        throw new JvgBackendError("Preencha a opção do Simples, o regime especial e a tributação do ISS com os códigos informados pela contabilidade.", 409);
      const reviewedRules = {
        ...rules,
        nfse: { ...nfse, requiresAccountantReview: false },
        requiresAccountantReview: false,
        accountantReview: { name: accountantName, crc: accountantCrc, declaredBy: user.userId, declaredAt: new Date().toISOString() },
      };
      const updated = await dbRequest<Row[]>(`/rest/v1/jvg_tax_profiles?${scope(account)}&id=${filterEq(id)}&document_type=eq.nfse&review_status=eq.draft`, {
        method: "PATCH", body: JSON.stringify({ rules: reviewedRules, review_status: "reviewed", reviewed_by: user.userId, updated_at: new Date().toISOString() }),
      });
      if (!updated.length) throw new JvgBackendError("O perfil mudou; atualize a tela e tente novamente.", 409);
      return apiJson({ ok: true, profile: updated[0], transmissionEnabled: false,
        note: "A revisão é uma declaração registrada no ERP; o sistema não autentica o contador nem libera emissão." });
    }
    const updated = await dbRequest<Row[]>(`/rest/v1/jvg_tax_profiles?${scope(account)}&id=${filterEq(id)}&document_type=eq.nfse&review_status=eq.draft`, {
      method: "PATCH", body: JSON.stringify({ name: rules.name, rules, updated_at: new Date().toISOString() }),
    });
    if (!updated.length) throw new JvgBackendError("O perfil mudou; atualize a tela e tente novamente.", 409);
    return apiJson({ ok: true, profile: updated[0], transmissionEnabled: false });
  } catch (error) { return safeError(error); }
}
