import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, getSiteAccount, isSameOrigin, JvgBackendError, safeError, str } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  const user = await getJvgUser();
  if (!user) return apiJson({ error: "Faça login para continuar." }, 401);
  try {
    const account = await getSiteAccount(user);
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para ajustar o estoque.", 403);
    const data = await request.json() as Record<string, unknown>;
    const productId = str(data.productId, 40);
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(productId)) throw new JvgBackendError("Produto inválido.", 400);
    const delta = Number(data.delta);
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 999999999) throw new JvgBackendError("Quantidade inválida.", 400);
    const reason = str(data.reason, 120);
    if (reason.length < 3) throw new JvgBackendError("Descreva o motivo do ajuste.", 400);
    const balance = await dbRequest<number>("/rest/v1/rpc/jvg_adjust_stock", {
      method: "POST", body: JSON.stringify({
        p_tenant_id: account.tenant_id,
        p_company_id: account.company_id,
        p_product_id: productId,
        p_delta: delta,
        p_reason: reason,
      }),
    });
    return apiJson({ ok: true, balance });
  } catch (error) { return safeError(error); }
}
