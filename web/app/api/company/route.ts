import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, ensureSiteAccount, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError, str } from "../../../lib/jvg-backend";
import { fiscalAddress, fiscalInteger, validCnpj } from "../../../lib/fiscal-company";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getJvgUser();
    if (!user) return apiJson({ error: "Faça login para continuar." }, 401);
    const account = await getSiteAccount(user);
    if (!account) return apiJson({ status: "needs_company", company: null });
    const stored = await getCompany(account);
    const company = stored ? {
      legalName: String(stored.legal_name || ""),
      tradeName: String(stored.trade_name || ""),
    } : null;
    return apiJson({ status: company ? "ready" : "needs_company", company });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  const user = await getJvgUser();
  if (!user) return apiJson({ error: "Faça login para continuar." }, 401);
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const data = await request.json() as Record<string, unknown>;
    const legalName = str(data.legalName, 160);
    if (legalName.length < 3) throw new JvgBackendError("Informe o nome da empresa.", 400);
    const account = await ensureSiteAccount(user, legalName);
    const company = await getCompany(account);
    return apiJson({ status: "ready", company }, 201);
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  const user = await getJvgUser();
  if (!user) return apiJson({ error: "Faça login para continuar." }, 401);
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await getSiteAccount(user);
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    if (!['owner', 'admin'].includes(account.role ?? '')) throw new JvgBackendError("Seu perfil não pode editar os dados fiscais da empresa.", 403);
    const data = await request.json() as Record<string, unknown>;
    const legalName = str(data.legalName, 160);
    if (legalName.length < 3) throw new JvgBackendError("Informe o nome da empresa.", 400);
    const cnpj = str(data.cnpj, 18).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cnpj && !validCnpj(cnpj)) throw new JvgBackendError("CNPJ inválido: confira os 14 caracteres e os dígitos verificadores.", 400);
    const cnae = str(data.cnae, 12).replace(/\D/g, "");
    if (cnae && cnae.length !== 7) throw new JvgBackendError("CNAE deve ter 7 dígitos.", 400);
    const fiscalEmail = str(data.fiscalEmail, 254).toLowerCase();
    if (fiscalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fiscalEmail)) throw new JvgBackendError("E-mail fiscal inválido.", 400);
    const fiscalPhone = str(data.fiscalPhone, 24).replace(/\D/g, "");
    if (fiscalPhone && (fiscalPhone.length < 10 || fiscalPhone.length > 13)) throw new JvgBackendError("Telefone deve ter DDD e entre 10 e 13 dígitos.", 400);
    const supportedRegimes = new Set(["mei", "simples_nacional", "lucro_presumido", "lucro_real", "outro"]);
    const taxRegime = str(data.taxRegime, 40);
    if (taxRegime && !supportedRegimes.has(taxRegime)) throw new JvgBackendError("Selecione um regime tributário válido.", 400);
    const currentCompany = await getCompany(account);
    const confirmsTaxRegime = data.taxRegimeConfirmed === true;
    if (data.taxRegimeConfirmed !== undefined && typeof data.taxRegimeConfirmed !== "boolean")
      throw new JvgBackendError("Confirmação do regime tributário inválida.", 400);
    if (confirmsTaxRegime && !taxRegime)
      throw new JvgBackendError("Selecione o regime informado pela contabilidade antes de confirmar.", 400);
    if (confirmsTaxRegime && currentCompany?.tax_regime_confirmation_available !== true)
      throw new JvgBackendError("A confirmação do regime depende da migration fiscal pendente no Supabase.", 409);
    const allowed: Record<string, unknown> = {
      legal_name: legalName,
      trade_name: str(data.tradeName, 160) || null,
      cnpj: cnpj || null,
      state_registration: str(data.stateRegistration, 40) || null,
      municipal_registration: str(data.municipalRegistration, 40) || null,
      cnae: cnae || null,
      fiscal_email: fiscalEmail || null,
      fiscal_phone: fiscalPhone || null,
      updated_at: new Date().toISOString(),
    };
    if (taxRegime && confirmsTaxRegime) allowed.tax_regime = taxRegime;
    if (currentCompany?.tax_regime_confirmation_available === true && data.taxRegimeConfirmed !== undefined)
      allowed.tax_regime_confirmed = confirmsTaxRegime;
    if ('street' in data) allowed.address = fiscalAddress(data);
    if ('nfeSeries' in data) allowed.nfe_series_homologacao = fiscalInteger(data.nfeSeries, "Série de NF-e", 1, 999);
    if ('nfeNextNumber' in data) allowed.nfe_next_number_homologacao = fiscalInteger(data.nfeNextNumber, "Próximo número de NF-e", 1, 999999999);
    await dbRequest(
      `/rest/v1/jvg_companies?tenant_id=${filterEq(account.tenant_id)}&id=${filterEq(account.company_id)}`,
      { method: "PATCH", body: JSON.stringify(allowed) },
    );
    return apiJson({ status: "ready", company: await getCompany(account) });
  } catch (error) { return safeError(error); }
}
