import { getJvgUser } from "../../../jvg-auth";
import { apiJson, getSiteAccount, isConfigured, requireModuleAccess, safeError } from "../../../../lib/jvg-backend";
import { checkFocusHomologacaoToken } from "../../../../lib/focus/client";
import { focusRuntimeEnv } from "../../../../lib/focus/runtime-env";
import { homologationToken } from "../../../../lib/licensing";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getJvgUser();
  if (!user) return apiJson({ status: "sign_in_required" }, 401);
  if (!isConfigured()) return apiJson({ status: "supabase_not_configured" }, 503);

  try {
    const account = await getSiteAccount(user);
    if (!account) return apiJson({ status: "needs_company" }, 403);
    await requireModuleAccess(account, "fiscal_nfe");
    if (account.role === "viewer") return apiJson({ error: "Seu perfil não consulta a Focus." }, 403);

    const siteToken = focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN");
    const token = await homologationToken(account, siteToken).catch(() => "");
    if (!token) {
      return apiJson({ status: "waiting_focus_token", environment: "homologacao", emissionEnabled: false });
    }

    const result = await checkFocusHomologacaoToken(token);
    return apiJson({ status: result, environment: "homologacao", emissionEnabled: false });
  } catch (error) {
    return safeError(error);
  }
}
