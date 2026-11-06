import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import { parseNfeDraftInput } from "../../../../lib/fiscal/nfe-draft";
import { isOfficialCfopCode } from "../../../../lib/fiscal/cfop";

export const dynamic = "force-dynamic";

type DbRow = Record<string, unknown>;

async function currentAccount(): Promise<SiteAccount> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const account = await getSiteAccount(user);
  if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  return account;
}

function scope(account: SiteAccount): string {
  return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`;
}

export async function GET() {
  try {
    const account = await currentAccount();
    const rows = await dbRequest<DbRow[]>(
      `/rest/v1/jvg_fiscal_documents?${scope(account)}&document_type=eq.nfe&environment=eq.homologacao&select=id,status,fiscal_payload,created_at,updated_at&order=created_at.desc&limit=50`,
    );
    return apiJson({ drafts: rows.map(row => {
      const payload = row.fiscal_payload && typeof row.fiscal_payload === "object" ? row.fiscal_payload as DbRow : {};
      const recipient = payload.recipient && typeof payload.recipient === "object" ? payload.recipient as DbRow : {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      const warnings = Array.isArray(payload.pending) ? payload.pending : [];
      return {
        id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
        recipientName: String(recipient.name || "Destinatário"), itemsCount: items.length,
        totalCents: Number(payload.totalCents || 0), pendingCount: warnings.length,
      };
    }) });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const account = await currentAccount();
    const raw = await request.text();
    if (raw.length > 32_000) throw new JvgBackendError("Rascunho muito grande.", 413);
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new JvgBackendError("Envie um JSON válido.", 400); }
    let draft;
    try { draft = parseNfeDraftInput(data); }
    catch (error) { throw new JvgBackendError(error instanceof Error ? error.message : "Rascunho inválido.", 400); }

    const company = await getCompany(account);
    if (!company) throw new JvgBackendError("Empresa não encontrada.", 404);
    if (company.tax_regime !== "simples_nacional")
      throw new JvgBackendError("Esta versão do rascunho NF-e está disponível apenas para o Simples Nacional.", 400);

    const scoped = scope(account);
    const [recipientRows, products] = await Promise.all([
      dbRequest<DbRow[]>(`/rest/v1/jvg_parties?${scoped}&id=${filterEq(draft.recipientId)}&is_customer=eq.true&active=eq.true&select=id,display_name,document_type,document_number,address&limit=1`),
      dbRequest<DbRow[]>(`/rest/v1/jvg_products?${scoped}&id=in.(${draft.items.map(i => i.productId).join(",")})&active=eq.true&select=id,sku,name,unit,ncm,cest,gtin,origin,sale_price`),
    ]);
    const recipient = recipientRows[0];
    if (!recipient) throw new JvgBackendError("Destinatário não pertence a esta empresa ou está inativo.", 400);
    const byId = new Map(products.map(product => [String(product.id), product]));
    if (draft.items.some(item => !byId.has(item.productId)))
      throw new JvgBackendError("Um ou mais produtos não pertencem à empresa ou estão inativos.", 400);

    const pending: string[] = [];
    if (company.fiscal_missing.length) pending.push("Conferir dados fiscais do emitente");
    if (!recipient.document_number) pending.push("Documento CPF/CNPJ do destinatário não informado");
    const items = draft.items.map((input, index) => {
      const product = byId.get(input.productId)!;
      if (!/^[0-9]{8}$/.test(String(product.ncm || ""))) pending.push(`Item ${index + 1}: NCM pendente`);
      if (!input.cfop) pending.push(`Item ${index + 1}: CFOP pendente`);
      else if (!isOfficialCfopCode(input.cfop)) pending.push(`Item ${index + 1}: CFOP não consta da tabela oficial`);
      if (!input.csosn) pending.push(`Item ${index + 1}: CSOSN pendente`);
      return {
        productId: product.id, sku: product.sku, description: product.name,
        unit: product.unit, ncm: product.ncm, cest: product.cest, gtin: product.gtin, origin: product.origin,
        quantity: input.quantity, unitPriceCents: input.unitPriceCents,
        subtotalCents: input.subtotalCents, cfop: input.cfop, csosn: input.csosn,
      };
    });
    pending.push("Conferência tributária com contador: ICMS, PIS/Cofins, IBS/CBS e demais totalizadores");

    const payload = {
      schemaVersion: 1, nature: draft.nature, purpose: "1",
      issuer: { companyId: account.company_id, name: company.trade_name || company.legal_name,
        cnpj: company.cnpj, stateRegistration: company.state_registration,
        taxRegime: company.tax_regime },
      recipient: { id: recipient.id, name: recipient.display_name,
        documentType: recipient.document_type, documentNumber: recipient.document_number,
        address: recipient.address },
      items, totalCents: draft.totalCents, pending, readyToTransmit: false,
    };

    const created = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_fiscal_documents", {
      method: "POST",
      body: JSON.stringify({
        tenant_id: account.tenant_id, company_id: account.company_id,
        document_type: "nfe", environment: "homologacao", status: "draft",
        fiscal_payload: payload,
      }),
    });
    if (!created[0]?.id) throw new JvgBackendError("Não foi possível salvar o rascunho.", 502);
    return apiJson({ ok: true, id: created[0].id, status: "draft",
      totalCents: draft.totalCents, pending, transmissionEnabled: false }, 201);
  } catch (error) { return safeError(error); }
}
