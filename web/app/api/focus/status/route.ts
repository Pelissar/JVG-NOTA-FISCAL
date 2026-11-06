import { getJvgUser } from "../../../jvg-auth";
import { apiJson, getSiteAccount, isConfigured, safeError } from "../../../../lib/jvg-backend";
import { checkFocusHomologacaoToken } from "../../../../lib/focus/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getJvgUser();
  if (!user) return apiJson({ status: "sign_in_required" }, 401);
  if (!isConfigured()) return apiJson({ status: "supabase_not_configured" }, 503);

  try {
    const account = await getSiteAccount(user);
    if (!account) return apiJson({ status: "needs_company" }, 403);

    const pilotCompany = process.env.JVG_FOCUS_PILOT_COMPANY_ID?.trim();
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

    const token = process.env.JVG_FOCUS_HOMOLOGACAO_TOKEN?.trim();
    if (!token) {
      return apiJson({ status: "waiting_focus_token", environment: "homologacao", emissionEnabled: false });
    }

    const result = await checkFocusHomologacaoToken(token);
    return apiJson({ status: result, environment: "homologacao", emissionEnabled: false });
  } catch (error) {
    return safeError(error);
  }
}
