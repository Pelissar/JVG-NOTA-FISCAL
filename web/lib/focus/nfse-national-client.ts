import "server-only";

const FOCUS_HOMOLOGACAO = "https://homologacao.focusnfe.com.br";
const focusReferencePattern = /^[A-Za-z0-9]{1,50}$/;
const responseFields = new Set([
  "status", "status_sefaz", "mensagem_sefaz", "ref", "chave_nfse", "chave_acesso", "numero_nfse", "numero",
  "serie_nfse", "serie", "serie_dps", "numero_dps", "protocolo", "numero_protocolo", "codigo_status",
  "erro", "mensagem", "caminho_xml_nota_fiscal", "caminho_danfe", "caminho_pdf_nota_fiscal", "caminho_xml",
  "url_xml", "url_xml_nota_fiscal", "url_pdf", "url_danfe", "data_emissao", "data_autorizacao",
  "data_hora_autorizacao", "codigo_verificacao", "eventos",
]);

export type FocusNfseNationalResult = { httpStatus: number; body: Record<string, unknown> };

export class FocusNfseNationalApiError extends Error {
  constructor(readonly httpStatus: number, readonly body: Record<string, unknown>) {
    super("A Focus não aceitou a operação de NFS-e Nacional.");
    this.name = "FocusNfseNationalApiError";
  }
}

function focusAuthorization(token: string): string {
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error("Token Focus não configurado.");
  return `Basic ${Buffer.from(`${normalizedToken}:`, "utf8").toString("base64")}`;
}

function safeResponse(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (!responseFields.has(key)) continue;
    if (key === "eventos" && Array.isArray(item)) {
      const events = item.slice(0, 50).flatMap(raw => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
        const event = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([name, field]) =>
          /^[a-zA-Z0-9_]{1,64}$/.test(name) &&
          ((typeof field === "string" && field.length <= 1000) ||
            (typeof field === "number" && Number.isFinite(field)) || typeof field === "boolean")));
        return Object.keys(event).length ? [event] : [];
      });
      if (events.length) result.eventos = events;
      continue;
    }
    if ((typeof item === "string" && item.length <= 2000) ||
        (typeof item === "number" && Number.isFinite(item)) || typeof item === "boolean") result[key] = item;
  }
  return result;
}

async function focusNfseNationalRequest(
  token: string,
  reference: string,
  method: "POST" | "GET",
  payload?: Record<string, unknown>,
): Promise<FocusNfseNationalResult> {
  if (!focusReferencePattern.test(reference)) throw new Error("Referência Focus inválida.");
  const url = method === "POST"
    ? `${FOCUS_HOMOLOGACAO}/v2/nfsen?ref=${encodeURIComponent(reference)}`
    : `${FOCUS_HOMOLOGACAO}/v2/nfsen/${encodeURIComponent(reference)}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: focusAuthorization(token), Accept: "application/json",
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let parsed: unknown = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { /* Ignore arbitrary provider text. */ }
  const body = safeResponse(parsed);
  if (!response.ok) throw new FocusNfseNationalApiError(response.status, body);
  return { httpStatus: response.status, body };
}

/** Sends a National DPS only to the fixed Focus homologation endpoint. */
export function emitFocusNfseNationalHomologacao(
  token: string,
  reference: string,
  payload: Record<string, unknown>,
): Promise<FocusNfseNationalResult> {
  return focusNfseNationalRequest(token, reference, "POST", payload);
}

/** Queries a previously submitted National DPS in homologation for reconciliation. */
export function queryFocusNfseNationalHomologacao(
  token: string,
  reference: string,
): Promise<FocusNfseNationalResult> {
  return focusNfseNationalRequest(token, reference, "GET");
}
