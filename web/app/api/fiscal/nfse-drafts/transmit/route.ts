import { getJvgUser } from "../../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError } from "../../../../../lib/jvg-backend";
import { emitFocusNfseNationalHomologacao, FocusNfseNationalApiError } from "../../../../../lib/focus/nfse-national-client";
import { focusRuntimeEnv } from "../../../../../lib/focus/runtime-env";
import { homologationToken, licenseView } from "../../../../../lib/licensing";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function statusFromFocus(value: unknown): "authorized" | "rejected" | "processing" | "cancelled" {
  const status = String(value || "").toLowerCase();
  if (["autorizado", "autorizada"].includes(status)) return "authorized";
  if (["erro_autorizacao", "rejeitado", "rejeitada", "erro"].includes(status)) return "rejected";
  if (["cancelado", "cancelada"].includes(status)) return "cancelled";
  return "processing";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    const account = await getSiteAccount(user);
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    if (account.role === "viewer") throw new JvgBackendError("Seu perfil não transmite NFS-e.", 403);
    const body = await request.json() as { id?: string; confirmHomologation?: boolean };
    if (body.confirmHomologation !== true) throw new JvgBackendError("Confirme que este envio é somente de homologação.", 400);
    if (!body.id || !uuidPattern.test(body.id)) throw new JvgBackendError("NFS-e inválida.", 400);
    const license = await licenseView(account);
    if (license.schemaReady && license.issues.length) throw new JvgBackendError(license.issues[0], 403);
    const siteToken = focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN");
    const token = await homologationToken(account, siteToken);
    const scope = `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
    const rows = await dbRequest<Array<Record<string, unknown>>>(
      `/rest/v1/jvg_fiscal_documents?${scope}&id=${filterEq(body.id)}&document_type=eq.nfse&environment=eq.homologacao&status=eq.draft&select=id,focus_reference,fiscal_payload&limit=1`,
    );
    const document = rows[0];
    const stored = document?.fiscal_payload && typeof document.fiscal_payload === "object" ? document.fiscal_payload as { preview?: { issues?: string[]; payload?: Record<string, unknown> } } : {};
    const issues = Array.isArray(stored.preview?.issues) ? stored.preview.issues : ["Prévia ausente."];
    if (!document || issues.length || !stored.preview?.payload) throw new JvgBackendError(issues[0] || "Salve a preparação sem pendências antes de enviar.", 409);
    const reference = String(document.focus_reference || "");
    await dbRequest(`/rest/v1/jvg_fiscal_documents?${scope}&id=${filterEq(body.id)}&status=eq.draft`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "processing", updated_at: new Date().toISOString() }),
    });
    try {
      const result = await emitFocusNfseNationalHomologacao(token, reference, stored.preview.payload);
      const next = statusFromFocus(result.body.status);
      await dbRequest(`/rest/v1/jvg_fiscal_documents?${scope}&id=${filterEq(body.id)}&document_type=eq.nfse&environment=eq.homologacao`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: next, provider_response: { operation: "focus_nfse", response: result.body }, ...(next === "authorized" ? { authorized_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }),
      });
      return apiJson({ ok: true, environment: "homologacao", status: next, message: String(result.body.mensagem_sefaz || result.body.mensagem || "NFS-e enviada ao ambiente de homologação.") });
    } catch (error) {
      const provider = error instanceof FocusNfseNationalApiError ? error.body : {};
      await dbRequest(`/rest/v1/jvg_fiscal_documents?${scope}&id=${filterEq(body.id)}&document_type=eq.nfse&environment=eq.homologacao&status=eq.processing`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "rejected", provider_response: { operation: "focus_nfse", response: provider }, updated_at: new Date().toISOString() }),
      });
      throw new JvgBackendError("A Focus recusou a NFS-e de homologação. Revise o perfil e a OS antes de preparar de novo.", 502);
    }
  } catch (error) { return safeError(error); }
}
