import { randomUUID } from "node:crypto";
import { getJvgUser } from "../../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError } from "../../../../lib/jvg-backend";
import { jvgRuntime } from "../../../../lib/jvg-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bucket = "jvg-company-logos";
const maxBytes = 2 * 1024 * 1024;
const allowedTypes = new Map([
  ["image/png", { ext: "png", signature: [137, 80, 78, 71, 13, 10, 26, 10] }],
  ["image/jpeg", { ext: "jpg", signature: [255, 216, 255] }],
  ["image/webp", { ext: "webp", signature: [] }],
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storagePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function validImage(bytes: Uint8Array, mime: string) {
  const spec = allowedTypes.get(mime);
  if (!spec) return false;
  if (mime === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return bytes.length >= spec.signature.length && spec.signature.every((value, index) => bytes[index] === value);
}

async function storageRequest(path: string, method: "POST" | "DELETE", bytes?: Uint8Array, mime?: string) {
  const runtimeConfig = jvgRuntime();
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseSecretKey) throw new JvgBackendError("Armazenamento de imagens não configurado neste ambiente.", 503);
  const headers = new Headers({ apikey: runtimeConfig.supabaseSecretKey });
  if (runtimeConfig.supabaseSecretKey.split(".").length === 3) headers.set("Authorization", `Bearer ${runtimeConfig.supabaseSecretKey}`);
  if (method === "POST") {
    headers.set("Content-Type", mime || "application/octet-stream");
    headers.set("Cache-Control", "3600");
    headers.set("x-upsert", "false");
  }
  const url = `${runtimeConfig.supabaseUrl}/storage/v1/object/${bucket}/${storagePath(path)}`;
  const body = method === "POST" && bytes
    ? new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
    : undefined;
  return fetch(url, { method, headers, body, cache: "no-store", signal: AbortSignal.timeout(15000) });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  let uploadedPath = "";
  try {
    const user = await getJvgUser();
    if (!user) throw new JvgBackendError("Faça login para continuar.", 401);
    const scope = await getSiteAccount(user, { requiredModule: "restaurante" });
    if (!scope) throw new JvgBackendError("Não encontramos uma empresa ativa para este usuário.", 409);
    if (scope.role === "viewer") throw new JvgBackendError("Seu acesso permite consulta, mas não alterar o cardápio.", 403);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > maxBytes + 64_000) throw new JvgBackendError("A imagem deve ter até 2 MB.", 413);
    const form = await request.formData();
    const file = form.get("file");
    const purpose = form.get("purpose");
    const productId = form.get("productId");
    if (!(file instanceof File)) throw new JvgBackendError("Escolha uma imagem para enviar.", 400);
    if (file.size < 1 || file.size > maxBytes) throw new JvgBackendError("A imagem deve ter até 2 MB.", 413);
    if (!allowedTypes.has(file.type)) throw new JvgBackendError("Use uma imagem PNG, JPEG ou WebP.", 400);
    if (purpose !== "logo" && purpose !== "cover" && purpose !== "item") throw new JvgBackendError("Tipo de imagem inválido.", 400);
    if (purpose === "item" && (typeof productId !== "string" || !UUID.test(productId))) throw new JvgBackendError("Selecione um produto válido para a foto.", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validImage(bytes, file.type)) throw new JvgBackendError("O conteúdo do arquivo não corresponde a uma imagem válida.", 400);

    if (purpose === "item") {
      const products = await dbRequest<Array<{ id: string }>>(`/rest/v1/jvg_products?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=${filterEq(String(productId))}&select=id&limit=1`);
      if (!products[0]) throw new JvgBackendError("Produto não encontrado nesta empresa.", 404);
    }

    const spec = allowedTypes.get(file.type)!;
    uploadedPath = `${encodeURIComponent(scope.tenant_id)}/${encodeURIComponent(scope.company_id)}/restaurant/${purpose}/${purpose === "item" ? `${productId}/` : ""}${randomUUID()}.${spec.ext}`;
    const uploaded = await storageRequest(uploadedPath, "POST", bytes, file.type);
    if (!uploaded.ok) throw new JvgBackendError("O armazenamento recusou a imagem. Confira se o bucket jvg-company-logos está disponível.", 502);

    if (purpose === "item") {
      await dbRequest("/rest/v1/jvg_restaurant_menu_items?on_conflict=tenant_id,company_id,product_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ tenant_id: scope.tenant_id, company_id: scope.company_id, product_id: productId, image_path: uploadedPath, updated_at: new Date().toISOString() }),
      });
    } else {
      await dbRequest("/rest/v1/jvg_restaurant_settings?on_conflict=tenant_id,company_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ tenant_id: scope.tenant_id, company_id: scope.company_id, [`${purpose}_path`]: uploadedPath, updated_at: new Date().toISOString() }),
      });
    }
    const runtimeConfig = jvgRuntime();
    const imageUrl = runtimeConfig.supabaseUrl ? `${runtimeConfig.supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath(uploadedPath)}` : null;
    return apiJson({ ok: true, path: uploadedPath, imageUrl });
  } catch (error) {
    if (uploadedPath) {
      try { await storageRequest(uploadedPath, "DELETE"); } catch { /* Preserve the original upload or database error. */ }
    }
    return safeError(error);
  }
}
