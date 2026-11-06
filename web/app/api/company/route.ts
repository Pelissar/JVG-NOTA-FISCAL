import { getChatGPTUser } from "../../chatgpt-auth";
import { apiJson, dbRequest, ensureSiteAccount, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError, str } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
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
  const user = await getChatGPTUser();
  if (!user) return apiJson({ error: "Faça login para continuar." }, 401);
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await getSiteAccount(user);
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    const data = await request.json() as Record<string, unknown>;
    const legalName = str(data.legalName, 160);
    if (legalName.length < 3) throw new JvgBackendError("Informe o nome da empresa.", 400);
    const cnpj = str(data.cnpj, 18).replace(/\D/g, "");
    if (cnpj && cnpj.length !== 14) throw new JvgBackendError("CNPJ deve ter 14 dígitos.", 400);
    const allowed = {
      legal_name: legalName,
      trade_name: str(data.tradeName, 160) || null,
      cnpj: cnpj || null,
      state_registration: str(data.stateRegistration, 40) || null,
      municipal_registration: str(data.municipalRegistration, 40) || null,
      tax_regime: "simples_nacional",
      updated_at: new Date().toISOString(),
    };
    await dbRequest(
      `/rest/v1/jvg_companies?tenant_id=${filterEq(account.tenant_id)}&id=${filterEq(account.company_id)}`,
      { method: "PATCH", body: JSON.stringify(allowed) },
    );
    return apiJson({ status: "ready", company: await getCompany(account) });
  } catch (error) { return safeError(error); }
}
