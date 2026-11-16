import { redirect } from "next/navigation";
import { getJvgUser } from "../jvg-auth";
import { getPlatformRole } from "../../lib/jvg-backend";
import { AdminConsole } from "./console";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getJvgUser();
  if (!user) redirect("/login");
  const role = await getPlatformRole(user);
  if (role !== "platform_admin") redirect("/erp/index.html");
  return <AdminConsole name={user.displayName} />;
}
