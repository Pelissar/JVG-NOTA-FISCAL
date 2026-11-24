import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError, type SiteAccount } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = ["open", "diagnosis", "awaiting_approval", "awaiting_parts", "in_progress", "ready", "delivered", "cancelled"] as const;
const priorities = ["low", "normal", "high", "urgent"] as const;
type Status = typeof statuses[number];
type Priority = typeof priorities[number];

async function accountForRequest(): Promise<{ account: SiteAccount; userId: string; displayName: string }> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user, { requiredModule: "assistencia" });
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return { account, userId: user.userId, displayName: user.displayName };
}

function isCommercial(role?: string) {
  return role !== "technician" && role !== "viewer";
}

async function recordEvent(account: SiteAccount, userId: string, actorName: string, order: { id?: unknown; os_number?: unknown }, eventType: string, detail: string) {
  const osNumber = Number(order.os_number);
  if (!Number.isInteger(osNumber) || osNumber < 0) return;
  try {
    await dbRequest("/rest/v1/jvg_service_order_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        tenant_id: account.tenant_id, company_id: account.company_id,
        service_order_id: typeof order.id === "string" ? order.id : null,
        os_number: osNumber, event_type: eventType, actor_user_id: userId,
        actor_name: actorName.slice(0, 80) || "Usuário", detail: detail.slice(0, 500),
      }),
    });
  } catch { /* O histórico aparece depois da migration. A OS continua sendo salva. */ }
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
  diagnosis: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["in_progress", "cancelled"],
  awaiting_parts: ["in_progress", "cancelled"],
  in_progress: ["awaiting_parts", "ready", "cancelled"],
  ready: ["in_progress", "delivered"],
  delivered: [],
  cancelled: [],
};

export async function GET(request: Request) {
  try {
    const { account, userId, displayName } = await accountForRequest();
    const params = new URL(request.url).searchParams;
    const requestedId = params.get("id");
    if (requestedId) {
      if (!uuidPattern.test(requestedId)) throw new JvgBackendError("Identificador de OS inválido.", 400);
      const selected = await dbRequest<Array<Record<string, unknown>>>(
        `/rest/v1/jvg_service_orders?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(requestedId)}&select=id,os_number,customer_id,device_type,brand,model,serial_number,status,estimated_value,created_at&limit=1`,
      );
      if (!selected[0]) throw new JvgBackendError("Ordem de serviço não encontrada nesta empresa.", 404);
      return apiJson({ serviceOrder: selected[0] });
    }
    const pageRaw = params.get("page") ?? "1";
    if (!/^[1-9]\d{0,4}$/.test(pageRaw)) throw new JvgBackendError("Página inválida.", 400);
    const page = Number(pageRaw), pageSize = 30;
    const status = params.get("status") ?? "";
    if (status && status !== "invoiceable" && !statuses.includes(status as Status)) throw new JvgBackendError("Situação de OS inválida.", 400);
    const scope = `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
    const statusFilter = status === "invoiceable" ? "&status=neq.cancelled" : status ? `&status=${filterEq(status)}` : "";
    const baseSelect = "id,os_number,customer_id,created_by,device_type,brand,model,serial_number,reported_issue,diagnosis,technician_name,status,priority,customer_approved,estimated_value,promised_at,internal_notes,created_at,updated_at";
    const listPath = (columns: string) => `/rest/v1/jvg_service_orders?${scope}${statusFilter}&select=${columns}&order=os_number.desc&limit=${pageSize + 1}&offset=${(page - 1) * pageSize}`;
    const summaryPromise = dbRequest<Record<string, number>>("/rest/v1/rpc/jvg_service_order_summary", {
      method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id }),
    });
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await dbRequest<Array<Record<string, unknown>>>(listPath(`${baseSelect},claimed_by,claimed_at`));
    } catch {
      rows = await dbRequest<Array<Record<string, unknown>>>(listPath(baseSelect));
    }
    const summary = await summaryPromise;
    return apiJson({
      serviceOrders: rows.slice(0, pageSize), summary, page, pageSize, hasMore: rows.length > pageSize,
      access: { role: account.role || "", userId, displayName, canManage: isCommercial(account.role), canClaim: account.role === "technician" },
    });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account, userId, displayName } = await accountForRequest();
    if (!isCommercial(account.role)) throw new JvgBackendError("Somente o comercial abre e libera uma ordem de serviço.", 403);
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
    let osNumber: number | undefined;
    try {
      const allocated = await dbRequest<number>("/rest/v1/rpc/jvg_allocate_service_order_number", {
        method: "POST", body: JSON.stringify({ p_tenant_id: account.tenant_id, p_company_id: account.company_id }),
      });
      if (!Number.isInteger(allocated) || allocated < 0 || allocated > 10000) throw new Error("numero");
      osNumber = allocated;
    } catch (error) {
      if (error instanceof JvgBackendError && /esgotada|10000/i.test(error.message)) throw new JvgBackendError("Esta empresa já usou a OS 10000.", 409);
      osNumber = undefined;
    }
    const created = await dbRequest<Array<Record<string, unknown>>>("/rest/v1/jvg_service_orders", {
      method: "POST",
      body: JSON.stringify({
        ...(osNumber === undefined ? {} : { os_number: osNumber }),
        tenant_id: account.tenant_id, company_id: account.company_id, customer_id: customerId, created_by: userId,
        device_type: text(data.deviceType, "Equipamento", 80, 2), brand: text(data.brand ?? "", "Marca", 80),
        model: text(data.model ?? "", "Modelo", 120), serial_number: text(data.serialNumber ?? "", "Número de série", 120),
        reported_issue: text(data.reportedIssue, "Defeito relatado", 5000, 3), technician_name: "",
        status: "open", priority, estimated_value: money(data.estimatedValue), promised_at: date(data.promisedAt, "Previsão de entrega"),
        internal_notes: text(data.internalNotes ?? "", "Observações internas", 3000),
      }),
    });
    if (!created[0]) throw new JvgBackendError("A ordem de serviço não foi salva.", 502);
    await recordEvent(account, userId, displayName, created[0], "opened", "OS aberta e liberada para os técnicos.");
    return apiJson({ ok: true, serviceOrder: created[0] }, 201);
  } catch (error) { return safeError(error); }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account, userId, displayName } = await accountForRequest();
    if (account.role === "viewer") throw new JvgBackendError("Sem permissão para atualizar ordens de serviço.", 403);
    const data = objectBody(await request.json());
    const id = uuid(data.id, "Ordem de serviço");
    if (data.action === "claim") {
      if (account.role !== "technician") throw new JvgBackendError("Somente o técnico confirma a ordem de serviço.", 403);
      const current = await dbRequest<Array<Record<string, unknown>>>(
        `/rest/v1/jvg_service_orders?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(id)}&select=id,os_number,claimed_by,technician_name&limit=1`,
      );
      const order = current[0];
      if (!order) throw new JvgBackendError("Ordem de serviço não encontrada.", 404);
      if (order.claimed_by && order.claimed_by !== userId) {
        throw new JvgBackendError(`OS-${String(order.os_number).padStart(5, "0")} já foi confirmada por ${order.technician_name || "outro técnico"}. Ela não pode ser alterada.`, 409);
      }
      if (order.claimed_by === userId) return apiJson({ ok: true, serviceOrder: order });
      const claimed = await dbRequest<Array<Record<string, unknown>>>(
        `/rest/v1/jvg_service_orders?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(id)}&claimed_by=is.null&select=id,os_number,technician_name,claimed_by`,
        { method: "PATCH", body: JSON.stringify({ claimed_by: userId, claimed_at: new Date().toISOString(), technician_name: displayName.slice(0, 120), updated_at: new Date().toISOString() }) },
      );
      if (!claimed.length) throw new JvgBackendError("Outro técnico confirmou esta OS agora. Atualize a lista.", 409);
      await recordEvent(account, userId, displayName, claimed[0], "claimed", "Técnico confirmou a OS.");
      return apiJson({ ok: true, serviceOrder: claimed[0] });
    }
    if (account.role === "technician") {
      const own = await dbRequest<Array<{ claimed_by: string | null; technician_name: string; os_number: number }>>(
        `/rest/v1/jvg_service_orders?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(id)}&select=claimed_by,technician_name,os_number&limit=1`,
      );
      if (!own[0]) throw new JvgBackendError("Ordem de serviço não encontrada.", 404);
      if (own[0].claimed_by !== userId) throw new JvgBackendError(`OS-${String(own[0].os_number).padStart(5, "0")} está com ${own[0].technician_name || "outro técnico"}. Ela não pode ser alterada.`, 409);
      if (data.status === "cancelled") throw new JvgBackendError("O técnico não remove a ordem. Peça ao comercial.", 403);
      delete data.technicianName;
    }
    const fromStatus = data.fromStatus;
    if (typeof fromStatus !== "string" || !statuses.includes(fromStatus as Status)) throw new JvgBackendError("Situação atual da OS inválida. Atualize a ficha.", 400);
    const currentRows = await dbRequest<Array<{ id: string; status: string; customer_approved: boolean | null; os_number: number; updated_at: string }>>(
      `/rest/v1/jvg_service_orders?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(id)}&status=${filterEq(fromStatus)}&select=id,status,customer_approved,os_number,updated_at&limit=1`,
    );
    const current = currentRows[0];
    if (!current) throw new JvgBackendError("OS alterada por outra pessoa. Atualize a ficha e tente novamente.", 409);
    if (data.customerApproved !== undefined && !isCommercial(account.role) && data.customerApproved !== current.customer_approved)
      throw new JvgBackendError("Somente o comercial pode registrar ou alterar a aprovação do cliente.", 403);
    if (data.customerApproved === false && current.customer_approved === true && current.status !== "awaiting_approval")
      throw new JvgBackendError("A aprovação já foi usada para iniciar o serviço e não pode ser retirada nesta etapa.", 409);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status !== undefined) {
      if (typeof data.status !== "string" || !statuses.includes(data.status as Status)) throw new JvgBackendError("Nova situação inválida.", 400);
      const next = data.status as Status, current = fromStatus as Status;
      if (next !== current && !transitions[current].includes(next)) throw new JvgBackendError("Essa mudança de situação não é permitida.", 400);
      const approved = data.customerApproved === true || (data.customerApproved === undefined && currentRows[0].customer_approved === true);
      if (next === "in_progress" && next !== current && !approved) throw new JvgBackendError("A manutenção só pode começar depois que o comercial registrar a aprovação do cliente.", 409);
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
      `/rest/v1/jvg_service_orders?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(id)}&status=${filterEq(fromStatus)}&updated_at=${filterEq(current.updated_at)}&select=id,os_number,status,updated_at`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
    if (!updated.length) throw new JvgBackendError("OS não encontrada ou atualizada por outra pessoa. Atualize a lista.", 409);
    const approvalChanged = data.customerApproved !== undefined && data.customerApproved !== current.customer_approved;
    const eventDetail = approvalChanged && data.customerApproved === true
      ? "Aprovação do cliente registrada pelo comercial."
      : approvalChanged && data.customerApproved === false
        ? "Cliente não aprovou o serviço."
        : data.status ? `Situação da OS alterada para ${String(data.status)}.` : "Ficha da OS atualizada.";
    await recordEvent(account, userId, displayName, updated[0], "updated", eventDetail);
    return apiJson({ ok: true, serviceOrder: updated[0] });
  } catch (error) { return safeError(error); }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const { account, userId, displayName } = await accountForRequest();
    if (!isCommercial(account.role)) throw new JvgBackendError("Somente o comercial pode remover uma ordem de serviço.", 403);
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!uuidPattern.test(id)) throw new JvgBackendError("Ordem de serviço inválida.", 400);
    const existing = await dbRequest<Array<{ id: string; os_number: number }>>(
      `/rest/v1/jvg_service_orders?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(id)}&select=id,os_number&limit=1`,
    );
    if (!existing[0]) throw new JvgBackendError("Ordem de serviço não encontrada.", 404);
    await recordEvent(account, userId, displayName, existing[0], "removed", "OS removida pelo comercial.");
    const removed = await dbRequest<Array<{ id: string }>>(
      `/rest/v1/jvg_service_orders?tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}&id=${filterEq(id)}&select=id`,
      { method: "DELETE" },
    );
    if (!removed.length) throw new JvgBackendError("Ordem de serviço não encontrada.", 404);
    return apiJson({ ok: true });
  } catch (error) { return safeError(error); }
}
