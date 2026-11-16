import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError, type SiteAccount } from "../../../../lib/jvg-backend";
import { buildNfceHomologacaoPayload, type NfceItemInput } from "../../../../lib/fiscal/nfce-payload";
import { focusReferenceForFiscalDocument } from "../../../../lib/focus/client";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function account(): Promise<SiteAccount> {
  const user = await getJvgUser();
  if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
  const site = await getSiteAccount(user);
  if (!site) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
  if (site.role === "viewer") throw new JvgBackendError("Seu perfil não prepara NFC-e.", 403);
  return site;
}

function scope(site: SiteAccount): string {
  return `tenant_id=${filterEq(site.tenant_id)}&company_id=${filterEq(site.company_id)}`;
}

export async function GET() {
  try {
    const site = await account();
    const rows = await dbRequest<Array<Record<string, unknown>>>(
      `/rest/v1/jvg_fiscal_documents?${scope(site)}&document_type=eq.nfce&environment=eq.homologacao&select=id,status,document_number,series,access_key,created_at,updated_at&order=created_at.desc&limit=20`,
    );
    return apiJson({ environment: "homologacao", documents: rows });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const site = await account();
    const body = await request.json() as Record<string, unknown>;
    const company = await getCompany(site);
    if (!company) throw new JvgBackendError("Empresa emitente não encontrada.", 404);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const productIds = rawItems.map((item) => (item && typeof item === "object" ? String((item as { productId?: string }).productId || "") : "")).filter((id) => uuidPattern.test(id));
    if (!productIds.length) throw new JvgBackendError("Selecione ao menos um produto.", 400);
    const products = await dbRequest<Array<Record<string, unknown>>>(
      `/rest/v1/jvg_products?${scope(site)}&id=in.(${productIds.join(",")})&active=eq.true&select=id,sku,name,ncm,unit,origin,default_cfop,sale_price&limit=20`,
    );
    const byId = new Map(products.map((product) => [String(product.id), product]));
    const items: NfceItemInput[] = rawItems.map((raw) => {
      const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const product = byId.get(String(item.productId || ""));
      const cfop = typeof item.cfop === "string" && item.cfop.trim() ? item.cfop.trim() : String(product?.default_cfop || "");
      return {
        sku: String(product?.sku || ""),
        name: String(product?.name || ""),
        ncm: String(product?.ncm || ""),
        cfop,
        unit: String(product?.unit || "UN"),
        origin: String(product?.origin || ""),
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice ?? product?.sale_price),
      };
    });
    const built = buildNfceHomologacaoPayload({
      company,
      items,
      cpf: typeof body.cpf === "string" ? body.cpf : "",
      paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod : "",
      naturezaOperacao: typeof body.naturezaOperacao === "string" ? body.naturezaOperacao : "",
    });
    if (built.issues.length) throw new JvgBackendError(built.issues[0], 400);
    const id = crypto.randomUUID();
    const saved = await dbRequest<Array<{ id: string }>>("/rest/v1/jvg_fiscal_documents", {
      method: "POST",
      body: JSON.stringify({
        id, tenant_id: site.tenant_id, company_id: site.company_id,
        document_type: "nfce", environment: "homologacao", status: "draft",
        focus_reference: focusReferenceForFiscalDocument(id),
        idempotency_key: `nfce-${id}`,
        fiscal_payload: { schema: "jvg_nfce_homologacao_v1", payload: built.payload, totalCents: built.totalCents },
      }),
    });
    return apiJson({ ok: true, id: saved[0]?.id || id, environment: "homologacao", totalCents: built.totalCents }, 201);
  } catch (error) { return safeError(error); }
}
