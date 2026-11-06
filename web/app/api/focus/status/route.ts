import { getJvgUser } from "../../../jvg-auth";
import { apiJson, getPlatformRole, getSiteAccount, isConfigured, safeError } from "../../../../lib/jvg-backend";
import { checkFocusHomologacaoToken } from "../../../../lib/focus/client";
import { focusRuntimeEnv } from "../../../../lib/focus/runtime-env";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getJvgUser();
  if (!user) return apiJson({ status: "sign_in_required" }, 401);
  if (!isConfigured()) return apiJson({ status: "supabase_not_configured" }, 503);

  try {
    // Diagnóstico técnico nunca é exposto a empresas clientes.
    if (await getPlatformRole(user) !== "platform_admin")
      return apiJson({ error: "Acesso restrito." }, 403);
    const account = await getSiteAccount(user);
    if (!account) return apiJson({ status: "needs_company" }, 403);

    const pilotCompany = focusRuntimeEnv("JVG_FOCUS_PILOT_COMPANY_ID");
    if (!pilotCompany) {
      return apiJson({ status: "waiting_focus_company_id", currentCompanyId: account.company_id,
        environment: "homologacao", emissionEnabled: false });
    }
    if (pilotCompany !== account.company_id) {
      // Revela apenas o id da propria empresa autenticada, nunca o id configurado
      // no segredo do servidor (que poderia pertencer a outro cliente).
      return apiJson({ status: "focus_not_enabled_for_company", currentCompanyId: account.company_id,
        environment: "homologacao", emissionEnabled: false }, 403);
    }

    const token = focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN");
    if (!token) {
      return apiJson({ status: "waiting_focus_token", environment: "homologacao", emissionEnabled: false });
    }

    const result = await checkFocusHomologacaoToken(token);
    return apiJson({ status: result, environment: "homologacao", emissionEnabled: false });
  } catch (error) {
    return safeError(error);
  }
}
