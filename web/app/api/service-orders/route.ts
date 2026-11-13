import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError, type SiteAccount } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = ["open", "diagnosis", "awaiting_approval", "awaiting_parts", "in_progress", "ready", "delivered", "cancelled"] as const;
const priorities = ["low", "normal", "high", "urgent"] as const;
type Status = typeof statuses[number];
type Priority = typeof priorities[number];

async function accountForRequest(): Promise<{ account: SiteAccount; userId: string }> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return { account, userId: user.userId };
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JvgBackendError("Dados da ordem de serviço inválidos.", 400);
  return value as Record<string, unknown>;
}

function uuid(value: unknown, label = "Identificador"): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new JvgBackendError(`${label} inválido.`, 400);
  return value;
}

function text(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== "string") throw new JvgBackendError(`${label} inválido.`, 400);
  const result = value.trim();
  if (result.length > max || result.length < min) throw new JvgBackendError(`${label} deve ter entre ${min} e ${max} caracteres.`, 400);
  return result;
}

function date(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    throw new JvgBackendError(`${label} inválida.`, 400);
  return value;
}

function money(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 999999999 || Math.abs(Math.round(value * 100) - value * 100) > 1e-7)
    throw new JvgBackendError("Valor estimado inválido.", 400);
  return value;
}

const transitions: Record<Status, readonly Status[]> = {
  open: ["diagnosis", "cancelled"],
  diagnosis: ["awaiting_approval", "awaiting_parts", "in_progress", "cancelled"],
  awaiting_approval: ["in_progress", "cancelled"],
  awaiting_parts: ["in_progress", "cancelled"],
  in_progress: ["awaiting_parts", "ready", "cancelled"],
  ready: ["in_progress", "delivered"],
  delivered: [],
  cancelled: [],
};

export async function GET(request: Request) {
  try {
    const { account } = await accountForRequest();
    const params = new URL(request.url).searchParams;
    const pageRaw = params.get("page") ?? "1";
    if (!/^[1-9]\d{0,4}$/.test(pageRaw)) throw new JvgBackendError("Página inválida.", 400);
    const page = Number(pageRaw), pageSize = 30;
    const status = params.get("status") ?? "";
    if (status && !statuses.includes(status as Status)) throw new JvgBackendError("Situação de OS inválida.", 400);
    const scope = `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
    const statusFilter = status ? `&status=${filterEq(status)}` : "";
    const [rows, summary] = await Promise.all([
      dbRequest<Array<Record<string, unknown>>>(
        `/rest/v1/jvg_service_orders?${scope}${statusFilter}&select=id,os_number,customer_id,created_by,device_type,brand,model,serial_number,reported_issue,diagnosis,technician_name,status,priority,customer_approved,estimated_value,promised_at,internal_notes,created_at,updated_at&order=created_at.desc,id.desc&limit=${pageSize + 1}&offset=${(page - 1) * pageSize}`,
      ),
      dbRequest<Record<string, number>>("/rest/v1/rpc/jvg_service_order_summary", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id }),
      }),
    ]);
    return apiJson({ serviceOrders: rows.slice(0, pageSize), summary, page, pageSize, hasMore: rows.length > pageSize });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account, userId } = await accountForRequest();
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para abrir ordens de serviço.", 403);
    const data = objectBody(await request.json());
    const customerId = data.customerId == null || data.customerId === "" ? null : uuid(data.customerId, "Cliente");
    if (customerId) {
      const allowed = await dbRequest<Array<{ id: string }>>(
        `/rest/v1/jvg_parties?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(customerId)}&is_customer=eq.true&active=eq.true&select=id&limit=1`,
      );
      if (!allowed.length) throw new JvgBackendError("Cliente indisponível nesta empresa.", 400);
    }
    const priority = data.priority == null ? "normal" : data.priority;
    if (typeof priority !== "string" || !priorities.includes(priority as Priority)) throw new JvgBackendError("Prioridade inválida.", 400);
    const created = await dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_service_orders", {
      method: "POST",
      body: JSON.stringify({
        tenant_id: account.tenant_id, company_id: account.company_id, customer_id: customerId, created_by: userId,
        device_type: text(data.deviceType, "Equipamento", 80, 2), brand: text(data.brand ?? "", "Marca", 80),
        model: text(data.model ?? "", "Modelo", 120), serial_number: text(data.serialNumber ?? "", "Número de série", 120),
        reported_issue: text(data.reportedIssue, "Defeito relatado", 5000, 3), technician_name: text(data.technicianName ?? "", "Técnico", 120),
        status: "open", priority, estimated_value: money(data.estimatedValue), promised_at: date(data.promisedAt, "Previsão de entrega"),
        internal_notes: text(data.internalNotes ?? "", "Observações internas", 3000),
      }),
    });
    if (!created[0]) throw new JvgBackendError("A ordem de serviço não foi salva.", 502);
    return apiJson({ ok: true, serviceOrder: created[0] }, 201);
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account } = await accountForRequest();
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para atualizar ordens de serviço.", 403);
    const data = objectBody(await request.json());
    const id = uuid(data.id, "Ordem de serviço");
    const fromStatus = data.fromStatus;
    if (typeof fromStatus !== "string" || !statuses.includes(fromStatus as Status)) throw new JvgBackendError("Situação atual da OS inválida. Atualize a ficha.", 400);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status !== undefined) {
      if (typeof data.status !== "string" || !statuses.includes(data.status as Status)) throw new JvgBackendError("Nova situação inválida.", 400);
      const next = data.status as Status, current = fromStatus as Status;
      if (next !== current && !transitions[current].includes(next)) throw new JvgBackendError("Essa mudança de situação não é permitida.", 400);
      patch.status = next;
    }
    if (data.diagnosis !== undefined) patch.diagnosis = text(data.diagnosis, "Diagnóstico", 5000);
    if (data.technicianName !== undefined) patch.technician_name = text(data.technicianName, "Técnico", 120);
    if (data.priority !== undefined) {
      if (typeof data.priority !== "string" || !priorities.includes(data.priority as Priority)) throw new JvgBackendError("Prioridade inválida.", 400);
      patch.priority = data.priority;
    }
    if (data.customerApproved !== undefined) {
      if (data.customerApproved !== null && typeof data.customerApproved !== "boolean") throw new JvgBackendError("Resposta do cliente inválida.", 400);
      patch.customer_approved = data.customerApproved;
    }
    if (data.estimatedValue !== undefined) patch.estimated_value = money(data.estimatedValue);
    if (data.promisedAt !== undefined) patch.promised_at = date(data.promisedAt, "Previsão de entrega");
    if (data.internalNotes !== undefined) patch.internal_notes = text(data.internalNotes, "Observações internas", 3000);
    if (Object.keys(patch).length === 1) throw new JvgBackendError("Nenhuma alteração informada.", 400);
    const updated = await dbRequest<Array<Record<string, unknown>>>(
      `/rest/v1/jvg_service_orders?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(id)}&status=${filterEq(fromStatus)}&select=id,os_number,status,updated_at`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
    if (!updated.length) throw new JvgBackendError("OS não encontrada ou atualizada por outra pessoa. Atualize a lista.", 409);
    return apiJson({ ok: true, serviceOrder: updated[0] });
  } catch (error) { return safeError(error); }
}
