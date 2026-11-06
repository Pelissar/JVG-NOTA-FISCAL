import { getJvgUser } from "../../jvg-auth";
import { apiJson, getCompany, getPlatformRole, getSiteAccount, isConfigured, safeError } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getJvgUser();
  if (!user) return apiJson({ authenticated: false, status: "sign_in_required" }, 401);
  if (!isConfigured()) return apiJson({ authenticated: true, displayName: user.displayName, status: "waiting_secret" });
  try {
    if (await getPlatformRole(user)) {
      return apiJson({ authenticated: true, displayName: user.displayName, status: "admin_ready", role: "platform_admin" });
    }
    const account = await getSiteAccount(user);
    if (!account) return apiJson({ authenticated: true, displayName: user.displayName, status: "needs_company" });
    const company = await getCompany(account);
    if (!company) return apiJson({ authenticated: true, status: "needs_company" });
    return apiJson({ authenticated: true, displayName: user.displayName, status: "ready", company });
  } catch (error) { return safeError(error); }
}
