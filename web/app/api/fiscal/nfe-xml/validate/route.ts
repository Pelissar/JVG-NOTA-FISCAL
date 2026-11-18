import { getJvgUser } from "../../../../jvg-auth";
import { apiJson, getCompany, getSiteAccount, isSameOrigin, JvgBackendError, safeError } from "../../../../../lib/jvg-backend";
import { checkNfeXml } from "../../../../../lib/fiscal/nfe-xml-check";

export const dynamic = "force-dynamic";

function decodeXml(bytes: Uint8Array): string {
  const header = new TextDecoder("windows-1252").decode(bytes.slice(0, 300));
  const declaration = header.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i);
  const declared = (declaration?.[1] || "UTF-8").toLowerCase();
  const encodings: Record<string, string> = {
    "utf-8": "utf-8", utf8: "utf-8", "iso-8859-1": "windows-1252",
    latin1: "windows-1252", "windows-1252": "windows-1252",
  };
  const encoding = encodings[declared];
  if (!encoding) throw new JvgBackendError("Codificação do XML não suportada.", 400);
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new JvgBackendError("Não foi possível ler o XML. Salve o arquivo em UTF-8 e tente novamente.", 400); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    const account = await getSiteAccount(user, { requiredModule: "fiscal_nfe" });
    if (!account) throw new JvgBackendError("Cadastre sua empresa primeiro.", 409);
    if (!(request.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data"))
      throw new JvgBackendError("Envie o arquivo XML pelo formulário.", 400);
    const form = await request.formData();
    const uploaded = form.get("xml");
    if (!(uploaded instanceof File)) throw new JvgBackendError("Selecione o XML da NF-e.", 400);
    if (uploaded.size < 1 || uploaded.size > 2_000_000) throw new JvgBackendError("O XML deve ter até 2 MB.", 413);
    const company = await getCompany(account);
    const report = checkNfeXml(decodeXml(new Uint8Array(await uploaded.arrayBuffer())), String(company?.cnpj || ""));
    return apiJson({ ok: report.ok, report, stored: false });
  } catch (error) { return safeError(error); }
}
