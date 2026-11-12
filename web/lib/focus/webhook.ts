import { createHash } from "node:crypto";

type Json = Record<string, unknown>;

const scalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean";

const focusWebhookFields = [
  "status", "status_sefaz", "mensagem_sefaz", "ref", "chave_nfe", "chave_nfse", "chave_acesso", "chave",
  "numero", "numero_nfse", "numero_dps", "serie", "serie_nfse", "serie_dps", "protocolo", "numero_protocolo",
  "codigo_status", "erro", "mensagem", "caminho_xml_nota_fiscal", "caminho_danfe", "caminho_pdf_nota_fiscal",
  "caminho_xml", "url_xml", "url_xml_nota_fiscal", "url_pdf", "url_danfe", "data_emissao",
  "data_autorizacao", "data_hora_autorizacao", "codigo_verificacao", "eventos",
] as const;

export function safeFocusWebhookPayload(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const body = value as Json;
  const result: Json = {};
  for (const key of focusWebhookFields) {
    const item = body[key];
    if (key === "eventos" && Array.isArray(item)) {
      const events = item.slice(0, 50).flatMap(raw => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
        const event = Object.fromEntries(Object.entries(raw as Json).filter(([name, field]) =>
          /^[a-zA-Z0-9_]{1,64}$/.test(name) && scalar(field) &&
          (typeof field !== "string" || field.length <= 1000)));
        return Object.keys(event).length ? [event] : [];
      });
      if (events.length) result.eventos = events;
      continue;
    }
    if (scalar(item) && (typeof item !== "string" || item.length <= 2000)) result[key] = item;
  }
  return result;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Json).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function focusWebhookEventKey(reference: string, safePayload: Json): string {
  return `focus:${createHash("sha256").update(`${reference}\n${canonicalJson(safePayload)}`).digest("hex")}`;
}

export type FocusWebhookStatus = "authorized" | "rejected" | "cancelled" | "denied" | "processing";

export function normalizeFocusWebhookStatus(value: unknown): FocusWebhookStatus | null {
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  if (["autorizado", "autorizada", "authorized"].includes(status)) return "authorized";
  if (["erro_autorizacao", "rejeitado", "rejeitada", "rejected", "erro"].includes(status)) return "rejected";
  if (["denegado", "denegada", "denied"].includes(status)) return "denied";
  if (["cancelado", "cancelada", "cancelled", "canceled"].includes(status)) return "cancelled";
  if (["processando_autorizacao", "processando", "aguardando", "processing", "waiting"].includes(status)) return "processing";
  return null;
}
