import { getJvgUser } from "../../jvg-auth";
import { apiJson, JvgBackendError, safeError } from "../../../lib/jvg-backend";
import { validCnpj } from "../../../lib/fiscal-company";
import { focusRuntimeEnv } from "../../../lib/focus/runtime-env";
import { brasilApiCnpjFields, cnpjWsFields, focusCnpjFields, mergeCnpjFields } from "../../../lib/cnpj-lookup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProviderData = Record<string, unknown>;
const digits = (value: string) => value.replace(/\D/g, "");
const valueText = (value: unknown, length = 160) => typeof value === "string" ? value.trim().slice(0, length) : "";
const objectValue = (value: unknown): ProviderData => value && typeof value === "object" && !Array.isArray(value) ? value as ProviderData : {};
type ProviderResult = { status: number; data: ProviderData };

// Respostas 4xx/5xx de provedores externos nao sao erros do cadastro JVG.
// Retornamos o status para tentar um segundo provedor sem expor dados internos.
async function requestProvider(url: string): Promise<ProviderResult> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "JVG-Nota-Fiscal/0.8" },
      cache: "no-store",
      signal: AbortSignal.timeout(5500),
    });
    if (!response.ok) return { status: response.status, data: {} };
    const data: unknown = await response.json().catch(() => null);
    if (!data || Array.isArray(data) || typeof data !== "object") return { status: 502, data: {} };
    return { status: 200, data: data as ProviderData };
  } catch {
    return { status: 503, data: {} };
  }
}

async function lookupCep(cep: string) {
  const first = await requestProvider(`https://viacep.com.br/ws/${cep}/json/`);
  if (first.status === 200 && !first.data.erro && first.data.cep) {
    const data = first.data;
    return { source: "ViaCEP", street: valueText(data.logradouro), district: valueText(data.bairro),
      city: valueText(data.localidade, 100), state: valueText(data.uf, 2),
      postalCode: digits(valueText(data.cep, 9)), cityCode: digits(valueText(data.ibge, 7)),
      complement: valueText(data.complemento, 100) };
  }
  const second = await requestProvider(`https://brasilapi.com.br/api/cep/v1/${cep}`);
  if (second.status === 200 && second.data.cep && second.data.city) {
    const data = second.data, ibge = objectValue(data.ibge);
    return { source: "BrasilAPI", street: valueText(data.street), district: valueText(data.neighborhood),
      city: valueText(data.city, 100), state: valueText(data.state, 2),
      postalCode: digits(valueText(data.cep, 9)), cityCode: digits(String(ibge.city ?? "")),
      complement: "" };
  }
  if ((first.status === 404 || first.data.erro) && second.status === 404) {
    throw new JvgBackendError("CEP não encontrado nos serviços de consulta. Confira os 8 dígitos.", 404);
  }
  throw new JvgBackendError("Consulta de CEP indisponível no ViaCEP e na BrasilAPI. Preencha o endereço manualmente ou tente mais tarde.", 503);
}

async function requestFocusCnpj(cnpj: string, token: string): Promise<ProviderResult> {
  try {
    const authorization = Buffer.from(token + ":", "utf8").toString("base64");
    const response = await fetch("https://api.focusnfe.com.br/v2/cnpjs/" + cnpj, {
      headers: { Accept: "application/json", Authorization: "Basic " + authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) return { status: response.status, data: {} };
    const data: unknown = await response.json().catch(() => null);
    if (!data || Array.isArray(data) || typeof data !== "object") return { status: 502, data: {} };
    return { status: 200, data: data as ProviderData };
  } catch {
    return { status: 503, data: {} };
  }
}

async function lookupCnpj(cnpj: string) {
  const isNumericCnpj = /^\d{14}$/.test(cnpj);
  const masterToken = focusRuntimeEnv("JVG_FOCUS_MASTER_TOKEN");
  const [focus, brasil] = await Promise.all([
    isNumericCnpj && masterToken ? requestFocusCnpj(cnpj, masterToken) : Promise.resolve({ status: masterToken ? 501 : 0, data: {} as ProviderData }),
    requestProvider("https://brasilapi.com.br/api/cnpj/v1/" + encodeURIComponent(cnpj)),
  ]);

  const sources: string[] = [];
  const mapped: ReturnType<typeof focusCnpjFields>[] = [];
  if (focus.status === 200 && focus.data.razao_social) {
    sources.push("Focus NFe");
    mapped.push(focusCnpjFields(focus.data, cnpj));
  }
  if (brasil.status === 200 && brasil.data.razao_social) {
    sources.push("BrasilAPI");
    mapped.push(brasilApiCnpjFields(brasil.data, cnpj));
  }

  // CNPJ.ws public API has a strict 3 requests/minute limit; use it only when both main sources fail.
  let cnpjWsStatus = 501;
  if (!mapped.length && isNumericCnpj) {
    const fallback = await requestProvider("https://publica.cnpj.ws/cnpj/" + cnpj);
    cnpjWsStatus = fallback.status;
    const establishment = objectValue(fallback.data.estabelecimento);
    if (fallback.status === 200 && fallback.data.razao_social && establishment.cnpj) {
      sources.push("CNPJ.ws");
      mapped.push(cnpjWsFields(fallback.data, cnpj));
    }
  }

  if (!mapped.length) {
    if (focus.status === 429 || brasil.status === 429 || cnpjWsStatus === 429)
      throw new JvgBackendError("Limite de consultas de CNPJ atingido. Aguarde alguns minutos ou preencha manualmente.", 429);
    const notFound = focus.status === 404 || brasil.status === 404 || cnpjWsStatus === 404;
    if (notFound && (focus.status === 404 || brasil.status === 404))
      throw new JvgBackendError("CNPJ n\u00e3o encontrado nas fontes consultadas. Confira os 14 caracteres.", 404);
    throw new JvgBackendError("Consulta de CNPJ indispon\u00edvel. Tente novamente ou preencha os dados manualmente.", 503);
  }

  const data = mergeCnpjFields(cnpj, ...mapped);
  const focusConfigured = Boolean(masterToken);
  const focusConsulted = isNumericCnpj && focusConfigured;
  const focusNote = !isNumericCnpj
    ? "A consulta de CNPJ da Focus aceita somente 14 dígitos; para este CNPJ alfanumérico foram usadas fontes complementares."
    : !focusConfigured
    ? "A consulta Focus ainda n\u00e3o est\u00e1 configurada neste servidor. Os dados dispon\u00edveis vieram das fontes complementares."
    : focus.status === 200 && focus.data.razao_social
      ? ""
      : focus.status === 401 || focus.status === 403
        ? "A Focus recusou o Token Master configurado; confira o segredo do servidor. Foram usadas fontes complementares."
        : "A Focus n\u00e3o retornou dados; foram usadas fontes complementares.";
  return {
    source: sources.join(" + "),
    ...data,
    focusConfigured,
    focusConsulted,
    focusNote,
    notices: [
      "Confira os dados com a empresa antes de salvar; as bases cadastrais s\u00e3o atualizadas periodicamente.",
      "A consulta Focus n\u00e3o fornece Inscri\u00e7\u00e3o Estadual nem Inscri\u00e7\u00e3o Municipal; confirme esses campos separadamente.",
      data.simplesNational !== null ? "A informa\u00e7\u00e3o de op\u00e7\u00e3o pelo Simples \u00e9 apenas cadastral e n\u00e3o confirma o regime fiscal para emiss\u00e3o." : "",
    ].filter(Boolean),
  };
}

export async function GET(request: Request) {
  const user = await getJvgUser();
  if (!user) return apiJson({ error: "Faça login para consultar CEP ou CNPJ." }, 401);

  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get("type");
    const raw = (url.searchParams.get("value") || "").trim().toUpperCase();
    if (kind === "cep") {
      const cep = digits(raw);
      if (!/^\d{8}$/.test(cep)) throw new JvgBackendError("Informe um CEP válido com 8 dígitos.", 400);
      return apiJson(await lookupCep(cep));
    }
    if (kind === "cnpj") {
      const cnpj = raw.replace(/[^A-Z0-9]/g, "");
      if (!validCnpj(cnpj)) throw new JvgBackendError("CNPJ inválido. Confira o número e os dígitos verificadores.", 400);
      return apiJson(await lookupCnpj(cnpj));
    }
    throw new JvgBackendError("Selecione consulta por CEP ou CNPJ.", 400);
  } catch (error) {
    return safeError(error);
  }
}
