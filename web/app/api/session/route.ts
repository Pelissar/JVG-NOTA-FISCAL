import { getJvgUser } from "../../jvg-auth";
import { apiJson, getCompany, getDashboardSummary, getPlatformRole, getSiteAccount, isConfigured, safeError } from "../../../lib/jvg-backend";

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
    const [company, dashboard] = await Promise.all([
      getCompany(account),
      getDashboardSummary(account).catch(() => null),
    ]);
    if (!company) return apiJson({ authenticated: true, status: "needs_company" });
    return apiJson({ authenticated: true, displayName: user.displayName, status: "ready", company,
      dashboardAvailable: Boolean(dashboard), ...(dashboard ? { dashboard } : {}) });
  } catch (error) { return safeError(error); }
}
