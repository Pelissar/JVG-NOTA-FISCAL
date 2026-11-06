import "server-only";

const FOCUS_HOMOLOGACAO = "https://homologacao.focusnfe.com.br";

export type FocusConnection =
  | "token_valid"
  | "invalid_token"
  | "forbidden"
  | "rate_limited"
  | "provider_unavailable"
  | "unexpected_response";

/**
 * Verifica um token de homologacao sem emitir ou alterar documentos fiscais.
 * Segundo a Focus, GET /v2/nfe/{ref} retorna 401 sem autenticacao e 404 se
 * a referencia nao existe. Uma referencia aleatoria torna a consulta inocua.
 */
export async function checkFocusHomologacaoToken(token: string): Promise<FocusConnection> {
  const reference = `jvg-probe-${crypto.randomUUID()}`;
  try {
    const response = await fetch(`${FOCUS_HOMOLOGACAO}/v2/nfe/${reference}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${token}:`, "utf8").toString("base64")}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    // Nao expor cabecalhos, erros detalhados ou informacoes da credencial.
    if (response.status === 404 || response.status === 200) return "token_valid";
    if (response.status === 401) return "invalid_token";
    if (response.status === 403) return "forbidden";
    if (response.status === 429) return "rate_limited";
    if (response.status >= 500) return "provider_unavailable";
    return "unexpected_response";
  } catch {
    return "provider_unavailable";
  }
}
