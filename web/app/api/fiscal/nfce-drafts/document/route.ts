import { getJvgUser } from "../../../../jvg-auth";
import { dbRequest, filterEq, getSiteAccount, JvgBackendError, safeError, type SiteAccount } from "../../../../../lib/jvg-backend";
import { downloadFocusNfceHomologacao } from "../../../../../lib/focus/client";
import { focusRuntimeEnv } from "../../../../../lib/focus/runtime-env";
import { homologationToken } from "../../../../../lib/licensing";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function obj(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function scope(account: SiteAccount): string { return `tenant_id=${filterEq(account.tenant_id)}&company_id=${filterEq(account.company_id)}`; }
function text(value: unknown, max = 200): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

export async function GET(request: Request) {
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    const account = await getSiteAccount(user, { requiredModule: "nfce" });
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    const params = new URL(request.url).searchParams;
    const id = text(params.get("id"), 80);
    const kind = text(params.get("kind"), 24);
    if (!uuidPattern.test(id)) throw new JvgBackendError("NFC-e inválida.", 400);
    if (!["danfce", "xml", "cancelamento"].includes(kind)) throw new JvgBackendError("Tipo de documento inválido.", 400);

    const rows = await dbRequest<Row[]>(`/rest/v1/jvg_fiscal_documents?${scope(account)}&id=${filterEq(id)}&document_type=eq.nfce&environment=eq.homologacao&select=id,status,document_number,provider_response,xml_storage_path,pdf_storage_path&limit=1`);
    const document = rows[0];
    if (!document) throw new JvgBackendError("NFC-e não encontrada nesta empresa e em homologação.", 404);
    if (!["authorized", "cancelled"].includes(String(document.status))) throw new JvgBackendError("Os arquivos ficam disponíveis após a autorização do cupom.", 409);
    const response = obj(obj(document.provider_response).response);
    const path = kind === "danfce"
      ? text(document.pdf_storage_path) || text(response.caminho_danfe)
      : kind === "xml"
        ? text(document.xml_storage_path) || text(response.caminho_xml_nota_fiscal)
        : String(document.status) === "cancelled" ? text(response.caminho_xml_cancelamento) : "";
    if (!path) throw new JvgBackendError(kind === "cancelamento" ? "O arquivo de cancelamento ainda não foi disponibilizado." : "Este arquivo ainda não foi disponibilizado pelo serviço fiscal.", 404);

    const token = await homologationToken(
      account,
      focusRuntimeEnv("JVG_FOCUS_HOMOLOGACAO_TOKEN") || focusRuntimeEnv("FOCUS_NFE_HOMOLOGACAO_TOKEN"),
    );
    const upstream = await downloadFocusNfceHomologacao(token, path);
    if (!upstream.ok) throw new JvgBackendError("Não foi possível baixar o arquivo do cupom. Atualize o histórico e tente novamente.", 502);
    const extension = kind === "danfce" ? "html" : "xml";
    const number = Number(document.document_number);
    const safeNumber = Number.isSafeInteger(number) && number > 0 ? String(number) : id.slice(0, 8);
    const filename = `nfce-${safeNumber}${kind === "cancelamento" ? "-cancelamento" : ""}.${extension}`;
    const upstreamType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    const allowedTypes = new Set(["application/pdf", "application/xml", "text/xml", "text/html", "application/octet-stream"]);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": allowedTypes.has(upstreamType) ? upstreamType : "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return safeError(error); }
}
