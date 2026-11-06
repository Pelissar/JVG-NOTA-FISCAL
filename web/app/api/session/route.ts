import { getChatGPTUser } from "../../chatgpt-auth";
import { apiJson, getCompany, getSiteAccount, isConfigured, safeError } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return apiJson({ authenticated: false, status: "sign_in_required" }, 401);
  if (!isConfigured()) return apiJson({ authenticated: true, displayName: user.displayName, status: "waiting_secret" });
  try {
    const account = await getSiteAccount(user);
    if (!account) return apiJson({ authenticated: true, displayName: user.displayName, status: "needs_company" });
    const company = await getCompany(account);
    if (!company) return apiJson({ authenticated: true, status: "needs_company" });
    return apiJson({ authenticated: true, displayName: user.displayName, status: "ready", company });
  } catch (error) { return safeError(error); }
}
