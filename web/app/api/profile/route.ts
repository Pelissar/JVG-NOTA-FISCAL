import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { apiJson, isSameOrigin, JvgBackendError, safeError, str } from "../../../lib/jvg-backend";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return apiJson({ error: "Autenticação indisponível neste ambiente." }, 503);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return apiJson({ error: "Faça login para continuar." }, 401);
  const displayName = typeof data.user.user_metadata?.display_name === "string"
    ? data.user.user_metadata.display_name.trim().slice(0, 80)
    : data.user.email.split("@")[0];
  return apiJson({ email: data.user.email, displayName });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return apiJson({ error: "Origem não autorizada." }, 403);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return apiJson({ error: "Autenticação indisponível neste ambiente." }, 503);

  try {
    const { data: current, error: currentError } = await supabase.auth.getUser();
    if (currentError || !current.user?.email) throw new JvgBackendError("Faça login novamente para editar sua conta.", 401);

    const raw = await request.text();
    if (raw.length > 5_000) throw new JvgBackendError("Dados de perfil muito grandes.", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new JvgBackendError("Envie dados válidos.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new JvgBackendError("Envie dados válidos.", 400);
    const input = body as Record<string, unknown>;
    const attributes: { email?: string; password?: string; current_password?: string; data?: Record<string, unknown> } = {};
    let displayName = current.user.user_metadata?.display_name;

    if ("displayName" in input) {
      const nextName = str(input.displayName, 80);
      if (nextName.length < 2) throw new JvgBackendError("Informe seu nome com pelo menos 2 caracteres.", 400);
      attributes.data = { ...current.user.user_metadata, display_name: nextName };
      displayName = nextName;
    }
    if ("email" in input) {
      const email = str(input.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new JvgBackendError("Informe um e-mail válido.", 400);
      if (email !== current.user.email.toLowerCase()) attributes.email = email;
    }
    if ("password" in input) {
      const password = typeof input.password === "string" ? input.password : "";
      if (password.length < 12 || password.length > 128) throw new JvgBackendError("A nova senha deve ter entre 12 e 128 caracteres.", 400);
      const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
      if (currentPassword.length < 1 || currentPassword.length > 128) throw new JvgBackendError("Informe sua senha atual para confirmar a alteração.", 400);
      attributes.password = password;
      attributes.current_password = currentPassword;
    }
    if (!Object.keys(attributes).length) throw new JvgBackendError("Nenhuma alteração foi informada.", 400);

    const { data, error } = await supabase.auth.updateUser(attributes);
    if (error || !data.user) {
      const message = error?.message.toLowerCase() ?? "";
      if (message.includes("already") || message.includes("registered"))
        throw new JvgBackendError("Este e-mail já está em uso.", 409);
      if (message.includes("password") || message.includes("weak"))
        throw new JvgBackendError("A senha não atende aos requisitos do provedor de autenticação.", 400);
      throw new JvgBackendError("Não foi possível atualizar os dados da conta. Confira a sessão e tente novamente.", 400);
    }

    const emailChangePending = Boolean(attributes.email && data.user.email?.toLowerCase() !== attributes.email);
    const savedName = typeof data.user.user_metadata?.display_name === "string"
      ? data.user.user_metadata.display_name.trim().slice(0, 80)
      : typeof displayName === "string" ? displayName : data.user.email?.split("@")[0] ?? "Usuário";
    return apiJson({ ok: true, email: data.user.email, displayName: savedName, emailChangePending });
  } catch (error) { return safeError(error); }
}
