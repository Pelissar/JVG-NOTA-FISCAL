import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError, type SiteAccount } from "../../../../lib/jvg-backend";
import { whatsappLink } from "../../../../lib/whatsapp-link";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const labels: Record<string, string> = {
  open: "Aberta", diagnosis: "Em diagnóstico", awaiting_approval: "Aguardando aprovação",
  awaiting_parts: "Aguardando peça", in_progress: "Em manutenção", ready: "Pronta para entrega",
  delivered: "Entregue", cancelled: "Cancelada",
};

async function account(): Promise<{ site: SiteAccount; userId: string; displayName: string }> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const site = await getSiteAccount(user, { requiredModule: "assistencia" });
  if (!site) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return { site, userId: user.userId, displayName: user.displayName };
}

export async function GET(request: Request) {
  try {
    const { site } = await account();
    const params = new URL(request.url).searchParams;
    const serviceOrderId = params.get("serviceOrderId") || "";
    if (serviceOrderId && !uuidPattern.test(serviceOrderId)) throw new JvgBackendError("Ordem de serviço inválida.", 400);
    const filter = serviceOrderId ? `&service_order_id=${filterEq(serviceOrderId)}` : "";
    const rows = await dbRequest<Array<Record<string, unknown>>>(
      `/rest/v1/jvg_service_order_events?tenant_id=${filterEq(site.tenant_id)}&company_id=${filterEq(site.company_id)}${filter}&select=id,service_order_id,os_number,event_type,actor_name,detail,created_at&order=created_at.desc&limit=40`,
    );
    return apiJson({ events: rows });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { site, userId, displayName } = await account();
    if (site.role === "viewer") throw new JvgBackendError("Seu perfil não envia mensagens.", 403);
    const body = await request.json() as { id?: string };
    if (!body.id || !uuidPattern.test(body.id)) throw new JvgBackendError("Ordem de serviço inválida.", 400);
    const orders = await dbRequest<Array<Record<string, unknown>>>(
      `/rest/v1/jvg_service_orders?tenant_id=${filterEq(site.tenant_id)}&company_id=${filterEq(site.company_id)}&id=${filterEq(body.id)}&select=id,os_number,customer_id,device_type,brand,model,status,technician_name,claimed_by&limit=1`,
    );
    const order = orders[0];
    if (!order) throw new JvgBackendError("Ordem de serviço não encontrada.", 404);
    if (site.role === "technician" && order.claimed_by && order.claimed_by !== userId) {
      throw new JvgBackendError("Esta OS está com outro técnico.", 409);
    }
    let phone = "";
    if (typeof order.customer_id === "string") {
      const parties = await dbRequest<Array<{ phone: string | null }>>(
        `/rest/v1/jvg_parties?tenant_id=${filterEq(site.tenant_id)}&company_id=${filterEq(site.company_id)}&id=${filterEq(order.customer_id)}&select=phone&limit=1`,
      );
      phone = parties[0]?.phone || "";
    }
    const number = String(order.os_number).padStart(5, "0");
    const message = [
      `Olá! Aqui está a atualização da OS-${number}.`,
      `Equipamento: ${[order.brand, order.model, order.device_type].filter(Boolean).join(" ") || "não informado"}.`,
      `Situação: ${labels[String(order.status)] || order.status}.`,
      order.technician_name ? `Técnico: ${order.technician_name}.` : "Ainda aguardando um técnico confirmar.",
    ].join(" ");
    const url = whatsappLink(phone, message);
    if (!url) throw new JvgBackendError("Cadastre o WhatsApp do cliente com DDD para enviar a OS.", 409);
    await dbRequest("/rest/v1/jvg_service_order_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        tenant_id: site.tenant_id, company_id: site.company_id, service_order_id: order.id,
        os_number: order.os_number, event_type: "whatsapp", actor_user_id: userId,
        actor_name: displayName.slice(0, 80), detail: "Mensagem preparada no WhatsApp.",
      }),
    });
    return apiJson({ ok: true, url });
  } catch (error) { return safeError(error); }
}
