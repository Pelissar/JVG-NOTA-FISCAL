import { getJvgUser } from "../../../jvg-auth";
import {
  apiJson, dbRequest, filterEq, getCompany, getSiteAccount, isSameOrigin,
  JvgBackendError, safeError, type SiteAccount,
} from "../../../../lib/jvg-backend";
import { parseNfeDraftInput } from "../../../../lib/fiscal/nfe-draft";
import { isOfficialCfopCode } from "../../../../lib/fiscal/cfop";
import { reviewNfeOperation, reviewProfileConsistency } from "../../../../lib/fiscal/operation-review";

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
      dbRequest<DbRow[]>(`/rest/v1/jvg_products?${scoped}&id=in.(${draft.items.map(i => i.productId).join(",")})&active=eq.true&select=id,sku,name,unit,ncm,cest,gtin,origin,tax_profile_id,sale_price`),
    ]);
    const recipient = recipientRows[0];
    if (!recipient) throw new JvgBackendError("Destinatário não pertence a esta empresa ou está inativo.", 400);
    const byId = new Map(products.map(product => [String(product.id), product]));
    if (draft.items.some(item => !byId.has(item.productId)))
      throw new JvgBackendError("Um ou mais produtos não pertencem à empresa ou estão inativos.", 400);

    const profileIds = [...new Set(products.map(product => String(product.tax_profile_id || '')).filter(Boolean))];
    const profiles = profileIds.length ? await dbRequest<DbRow[]>(`/rest/v1/jvg_tax_profiles?${scoped}&id=in.(${profileIds.join(',')})&document_type=eq.nfe&select=id,name,rules,review_status`) : [];
    const byProfile = new Map(profiles.map(profile => [String(profile.id), profile]));
    const pending: string[] = [];
    if (company.fiscal_missing.length) pending.push("Conferir dados fiscais do emitente");
    if (!recipient.document_number) pending.push("Documento CPF/CNPJ do destinatário não informado");
    const issuerAddress = company.address && typeof company.address === "object" ? company.address as DbRow : {};
    const recipientAddress = recipient.address && typeof recipient.address === "object" ? recipient.address as DbRow : {};
    const issuerUf = issuerAddress.state;
    const recipientUf = recipientAddress.state;
    const items = draft.items.map((input, index) => {
      const product = byId.get(input.productId)!;
      if (!/^[0-9]{8}$/.test(String(product.ncm || ""))) pending.push(`Item ${index + 1}: NCM pendente`);
      if (!input.cfop) pending.push(`Item ${index + 1}: CFOP pendente`);
      else if (!isOfficialCfopCode(input.cfop)) pending.push(`Item ${index + 1}: CFOP não consta da tabela oficial`);
      if (!input.csosn) pending.push(`Item ${index + 1}: CSOSN pendente`);
      const review = reviewNfeOperation(issuerUf, recipientUf, input.cfop, index + 1);
      pending.push(...review.pending);
      const profile = product.tax_profile_id ? byProfile.get(String(product.tax_profile_id)) : undefined;
      if (!profile) pending.push(`Item ${index + 1}: perfil tributário não associado ou indisponível`);
      else {
        if (profile.review_status !== 'reviewed') pending.push(`Item ${index + 1}: perfil tributário ainda não revisado`);
        const rules = profile.rules && typeof profile.rules === "object" && !Array.isArray(profile.rules) ? profile.rules as DbRow : {};
        pending.push(...reviewProfileConsistency(rules, input.cfop, input.csosn, index + 1));
      }
      return {
        productId: product.id, sku: product.sku, description: product.name,
        unit: product.unit, ncm: product.ncm, cest: product.cest, gtin: product.gtin, origin: product.origin,
        quantity: input.quantity, unitPriceCents: input.unitPriceCents,
        subtotalCents: input.subtotalCents, cfop: input.cfop, csosn: input.csosn,
        operation: review.operation,
        taxProfile: profile ? { id: profile.id, name: profile.name, reviewStatus: profile.review_status, rules: profile.rules } : null,
      };
    });
    pending.push("Conferência tributária com contador: ICMS, PIS/Cofins, IBS/CBS e demais totalizadores");

    const payload = {
      schemaVersion: 2, nature: draft.nature, purpose: "1",
      issuer: { companyId: account.company_id, name: company.trade_name || company.legal_name,
        cnpj: company.cnpj, stateRegistration: company.state_registration,
        taxRegime: company.tax_regime, state: issuerUf },
      recipient: { id: recipient.id, name: recipient.display_name,
        documentType: recipient.document_type, documentNumber: recipient.document_number,
        address: recipient.address, state: recipientUf },
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
