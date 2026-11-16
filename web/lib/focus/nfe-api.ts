import "server-only";

const FOCUS_HOMOLOG = "https://homologacao.focusnfe.com.br";

export type FocusCall = {
  httpStatus: number;
  body: Record<string, unknown>;
};

function authHeader(token: string): string {
  return `Basic ${Buffer.from(`${token}:`, "utf8").toString("base64")}`;
}

/** Só homologação. A URL de produção é recusada de propósito. */
export async function focusHomolog(
  path: string,
  token: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown } = { method: "GET" },
): Promise<FocusCall> {
  if (!path.startsWith("/v2/nfe")) throw new Error("Caminho Focus inválido.");
  const url = `${FOCUS_HOMOLOG}${path}`;
  if (!url.startsWith(`${FOCUS_HOMOLOG}/v2/nfe`)) throw new Error("Ambiente Focus inválido.");
  const response = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: authHeader(token),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const raw = await response.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { httpStatus: response.status, body };
}

export function focusMessage(body: Record<string, unknown>): string {
  const mensagem = body.mensagem_sefaz || body.mensagem || body.message;
  return typeof mensagem === "string" && mensagem.trim() ? mensagem.trim().slice(0, 500) : "A Focus não devolveu uma mensagem.";
}
