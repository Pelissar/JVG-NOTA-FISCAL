import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import {
  cfopMetadata, cfopRecords, isOfficialCfopCode, validCfopLabel,
} from "../../../../lib/fiscal/cfop";

export const dynamic = "force-dynamic";

type CfopOverride = { code: string; custom_label: string };

async function current(): Promise<{ account: SiteAccount; userId: string }> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para acessar o catálogo fiscal.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return { account, userId: user.userId };
}

function scoped(account: SiteAccount): string {
  return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
}

function canEdit(account: SiteAccount): boolean {
  return ["owner", "admin", "manager", "operator"].includes(account.role || "");
}

export async function GET() {
  try {
    const { account } = await current();
    let overrides: CfopOverride[] = [];
    let customizationAvailable = true;
    try {
      overrides = await dbRequest<CfopOverride[]>(
        `/rest/v1/jvg_cfop_overrides?${scoped(account)}&select=code,custom_label&order=code.asc`,
      );
    } catch {
      // A tabela pode ainda não existir. Os CFOPs oficiais continuam disponíveis
      // para consulta, mas a tela não deve fingir que é possível salvar alterações.
      customizationAvailable = false;
    }
    const byCode = new Map(overrides.map(row => [row.code, row.custom_label]));
    return apiJson({
      metadata: cfopMetadata,
      customizable: customizationAvailable && canEdit(account),
      customizationAvailable,
      records: cfopRecords.map(record => ({
        ...record,
        customLabel: byCode.get(record.code) || null,
      })),
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account, userId } = await current();
    if (!canEdit(account)) throw new JvgBackendError("Sem permissão para personalizar os CFOPs.", 403);
    const raw = await request.text();
    if (raw.length > 2_000) throw new JvgBackendError("Dados muito extensos.", 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { throw new JvgBackendError("Dados inválidos.", 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new JvgBackendError("Dados inválidos.", 400);
    const code = input.code;
    const customLabel = validCfopLabel(input.customLabel);
    if (typeof code !== "string" || !isOfficialCfopCode(code)) throw new JvgBackendError("Código CFOP não consta da tabela oficial.", 400);
    if (!customLabel) throw new JvgBackendError("Nome personalizado deve ter entre 2 e 140 caracteres.", 400);
    await dbRequest("/rest/v1/jvg_cfop_overrides?on_conflict=tenant_id,company_id,code", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        tenant_id: account.tenant_id, company_id: account.company_id,
        code, custom_label: customLabel, updated_by: userId,
        updated_at: new Date().toISOString(),
      }),
    });
    return apiJson({ ok: true, code, customLabel });
  } catch (error) { return safeError(error); }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account } = await current();
    if (!canEdit(account)) throw new JvgBackendError("Sem permissão para alterar os CFOPs.", 403);
    const code = new URL(request.url).searchParams.get("code") || "";
    if (!isOfficialCfopCode(code)) throw new JvgBackendError("Código CFOP inválido.", 400);
    await dbRequest(`/rest/v1/jvg_cfop_overrides?${scoped(account)}&code=${filterEq(code)}`, { method: "DELETE" });
    return apiJson({ ok: true, code });
  } catch (error) { return safeError(error); }
}
