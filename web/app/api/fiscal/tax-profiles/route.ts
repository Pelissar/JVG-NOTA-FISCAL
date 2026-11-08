import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError,
  type SiteAccount,
} from "../../../../lib/jvg-backend";
import { isOfficialCfopCode } from "../../../../lib/fiscal/cfop";
import { parsePreviewRate, PREVIEW_TAXES, type PreviewRates } from "../../../../lib/fiscal/tax-preview";

export const dynamic = "force-dynamic";

type Profile = { id: string; name: string; rules: Record<string, unknown>; review_status: string; created_at: string };
const csosn = new Set(["101","102","103","201","202","203","300","400","500","900"]);

async function account(): Promise<SiteAccount> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const result = await getSiteAccount(user);
  if (!result) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return result;
}
function scope(a: SiteAccount): string {
  return `tenant_id=${filterEq(a.tenant_id)}&company_id=${filterEq(a.company_id)}`;
}
function canEdit(a: SiteAccount): boolean {
  return ["owner","admin","manager"].includes(a.role || "");
}
function value(raw: unknown, size: number): string {
  if (raw == null || raw === "") return "";
  if (typeof raw !== "string" || raw.trim().length > size) throw new JvgBackendError("Campo fiscal inválido ou muito extenso.", 400);
  return raw.trim().toUpperCase();
}
export async function GET() {
  try {
    const a = await account();
    const rows = await dbRequest<Profile[]>(
      `/rest/v1/jvg_tax_profiles?${scope(a)}&document_type=eq.nfe&select=id,name,rules,review_status,created_at&order=created_at.desc&limit=200`,
    );
    return apiJson({ records: rows, editable: canEdit(a), transmissionEnabled: false });
  } catch (error) { return safeError(error); }
}
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const a = await account();
    if (!canEdit(a)) throw new JvgBackendError("Sua conta não pode alterar perfis fiscais.", 403);
    const raw = await request.text();
    if (raw.length > 5000) throw new JvgBackendError("Cadastro muito extenso.", 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new JvgBackendError("Cadastro inválido.", 400);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 3 || name.length > 120) throw new JvgBackendError("Nome deve ter de 3 a 120 caracteres.", 400);
    const cfop = value(input.cfop, 4);
    const taxSituation = value(input.csosn, 3);
    const pisCst = value(input.pisCst, 2);
    const cofinsCst = value(input.cofinsCst, 2);
    const cstIbsCbs = value(input.cstIbsCbs, 3);
    const classTrib = value(input.classTrib, 6);
    if (cfop && !isOfficialCfopCode(cfop)) throw new JvgBackendError("CFOP não consta do catálogo oficial.", 400);
    if (taxSituation && !csosn.has(taxSituation)) throw new JvgBackendError("CSOSN inválido.", 400);
    if (pisCst && !/^\d{2}$/.test(pisCst)) throw new JvgBackendError("CST PIS deve ter 2 dígitos.", 400);
    if (cofinsCst && !/^\d{2}$/.test(cofinsCst)) throw new JvgBackendError("CST Cofins deve ter 2 dígitos.", 400);
    if (cstIbsCbs && !/^\d{3}$/.test(cstIbsCbs)) throw new JvgBackendError("CST IBS/CBS deve ter 3 dígitos.", 400);
    if (classTrib && !/^\d{6}$/.test(classTrib)) throw new JvgBackendError("Classificação tributária IBS/CBS deve ter 6 dígitos.", 400);
    const previewRates: PreviewRates = {};
    for (const tax of PREVIEW_TAXES) {
      const rawRate = input[`${tax}Rate`];
      let value: string | null;
      try { value = parsePreviewRate(rawRate); }
      catch (error) { throw new JvgBackendError(`${tax.toUpperCase()}: ${error instanceof Error ? error.message : "Alíquota inválida."}`, 400); }
      if (value !== null) previewRates[tax] = value;
    }
    const rules = { regime: "simples_nacional", cfop, csosn: taxSituation, pisCst, cofinsCst,
      cstIbsCbs, classTrib, previewRates, previewOnly: true, taxCalculationEnabled: false, requiresAccountantReview: true };
    const result = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_tax_profiles", {
      method: "POST",
      body: JSON.stringify({ tenant_id: a.tenant_id, company_id: a.company_id,
        name, document_type: "nfe", rules, review_status: "draft" }),
    });
    return apiJson({ ok: true, id: result[0]?.id, reviewStatus: "draft", transmissionEnabled: false }, 201);
  } catch (error) { return safeError(error); }
}
