import "server-only";

const FOCUS_HOMOLOGACAO = "https://homologacao.focusnfe.com.br";

export type FocusConnection =
  | "token_valid"
  | "invalid_token"
  | "forbidden"
  | "rate_limited"
  | "provider_unavailable"
  | "unexpected_response";

export type FocusNfeApiResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export class FocusNfeApiError extends Error {
  constructor(readonly httpStatus: number, readonly body: Record<string, unknown>) {
    super("A Focus não aceitou a operação de NF-e.");
    this.name = "FocusNfeApiError";
  }
}

const focusReferencePattern = /^[A-Za-z0-9]{1,50}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function focusReferenceForFiscalDocument(documentId: string): string {
  if (!uuidPattern.test(documentId)) throw new Error("Identificador fiscal inválido.");
  return `JVG${documentId.replace(/-/g, "").toUpperCase()}`;
}

function focusAuthorization(token: string): string {
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error("Token Focus não configurado.");
  return `Basic ${Buffer.from(`${normalizedToken}:`, "utf8").toString("base64")}`;
}

async function focusNfeRequest(
  token: string,
  reference: string,
  init: RequestInit,
  query = "",
): Promise<FocusNfeApiResult> {
  if (!focusReferencePattern.test(reference)) throw new Error("Referência Focus inválida.");
  const url = init.method === "POST"
    ? `${FOCUS_HOMOLOGACAO}/v2/nfe?ref=${encodeURIComponent(reference)}`
    : `${FOCUS_HOMOLOGACAO}/v2/nfe/${encodeURIComponent(reference)}${query}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", focusAuthorization(token));
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch { /* Não expor texto arbitrário do provedor ao cliente. */ }
  if (!response.ok) throw new FocusNfeApiError(response.status, body);
  return { httpStatus: response.status, body };
}

/** Envia JSON somente ao ambiente Focus de homologação. Sem retentativa automática. */
export function emitFocusNfeHomologacao(
  token: string,
  reference: string,
  fiscalPayload: Record<string, unknown>,
): Promise<FocusNfeApiResult> {
  return focusNfeRequest(token, reference, {
    method: "POST",
    body: JSON.stringify(fiscalPayload),
  });
}

/** Consulta o estado da referência no ambiente Focus de homologação. */
export function queryFocusNfeHomologacao(
  token: string,
  reference: string,
  complete = false,
): Promise<FocusNfeApiResult> {
  return focusNfeRequest(token, reference, {
    method: "GET",
    headers: { Accept: "application/json" },
  }, complete ? "?completa=1" : "");
}

/** Inutiliza numeração somente no endpoint fixo de homologação da Focus. */
export async function inutilizeFocusNfeNumberHomologacao(
  token: string,
  payload: { cnpj: string; serie: string; numero_inicial: number; numero_final: number; justificativa: string },
): Promise<FocusNfeApiResult> {
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error("Token Focus não configurado.");
  const response = await fetch(FOCUS_HOMOLOGACAO + "/v2/nfe/inutilizacao", {
    method: "POST",
    headers: {
      Authorization: focusAuthorization(normalizedToken),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch { /* Não expor resposta HTML ou texto arbitrário do provedor. */ }
  if (!response.ok) throw new FocusNfeApiError(response.status, body);
  return { httpStatus: response.status, body };
}

/**
 * Verifica um token de homologacao sem emitir ou alterar documentos fiscais.
 * Segundo a Focus, GET /v2/nfe/{ref} retorna 401 sem autenticacao e 404 se
 * a referencia nao existe. Uma referencia aleatoria torna a consulta inocua.
 */
export async function checkFocusHomologacaoToken(token: string): Promise<FocusConnection> {
  const reference = `JVGPROBE${crypto.randomUUID().replace(/-/g, "")}`;
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

