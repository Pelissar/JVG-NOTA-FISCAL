import { redirect } from "next/navigation";
import { getJvgUser } from "../jvg-auth";
import { BillingPortal } from "./portal";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await getJvgUser();
  if (!user) redirect("/login");
  return <BillingPortal />;
}
