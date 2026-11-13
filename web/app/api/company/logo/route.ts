import { getJvgUser } from "../../../jvg-auth";
import { apiJson, getSiteAccount, isSameOrigin, JvgBackendError, safeError } from "../../../../lib/jvg-backend";
import { jvgRuntime } from "../../../../lib/jvg-runtime";

export const dynamic = "force-dynamic";

const bucket = "jvg-company-logos";
const maxBytes = 2 * 1024 * 1024;
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function logoPath(tenantId: string, companyId: string): string {
  return `${encodeURIComponent(tenantId)}/${encodeURIComponent(companyId)}/brand`;
}

function validImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function GET() {
  try {
    const user = await getJvgUser();
    if (!user) return apiJson({ error: "Faça login para continuar." }, 401);
    const account = await getSiteAccount(user);
    if (!account) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const runtime = jvgRuntime();
    if (!runtime.supabaseUrl) return apiJson({ error: "Armazenamento indisponível." }, 503);
    const url = `${runtime.supabaseUrl}/storage/v1/object/public/${bucket}/${logoPath(account.tenant_id, account.company_id)}`;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (response.status === 404) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    if (!response.ok || !response.body) throw new JvgBackendError("Não foi possível carregar a logo da empresa.", 502);
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!allowedTypes.has(mime)) throw new JvgBackendError("A imagem armazenada não tem um formato permitido.", 502);
    return new Response(response.body, { status: 200, headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=120",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return safeError(error); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    const account = await getSiteAccount(user);
    if (!account) throw new JvgBackendError("Cadastre sua empresa antes de enviar a logo.", 409);
    if (!(["owner", "admin"].includes(account.role ?? ""))) throw new JvgBackendError("Somente proprietários e administradores podem alterar a logo.", 403);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes + 64_000) throw new JvgBackendError("A imagem deve ter até 2 MB.", 413);
    const form = await request.formData();
    const file = form.get("logo");
    if (!(file instanceof File)) throw new JvgBackendError("Escolha uma imagem para enviar.", 400);
    if (file.size < 1 || file.size > maxBytes) throw new JvgBackendError("A imagem deve ter até 2 MB.", 413);
    if (!allowedTypes.has(file.type)) throw new JvgBackendError("Use uma imagem PNG, JPEG ou WebP.", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validImage(bytes, file.type)) throw new JvgBackendError("O conteúdo do arquivo não corresponde a uma imagem válida.", 400);

    const runtime = jvgRuntime();
    if (!runtime.supabaseUrl || !runtime.supabaseSecretKey) throw new JvgBackendError("Armazenamento não configurado neste ambiente.", 503);
    const headers = new Headers({
      apikey: runtime.supabaseSecretKey,
      "Content-Type": file.type,
      "Cache-Control": "3600",
      "x-upsert": "true",
    });
    if (runtime.supabaseSecretKey.split(".").length === 3)
      headers.set("Authorization", `Bearer ${runtime.supabaseSecretKey}`);
    const url = `${runtime.supabaseUrl}/storage/v1/object/${bucket}/${logoPath(account.tenant_id, account.company_id)}`;
    const uploaded = await fetch(url, { method: "POST", headers, body: bytes, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!uploaded.ok) throw new JvgBackendError("O armazenamento recusou a imagem. Confira se a migration da logo foi aplicada.", 502);
    return apiJson({ ok: true });
  } catch (error) { return safeError(error); }
}
