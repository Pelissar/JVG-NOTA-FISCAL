import { getJvgUser } from "../../jvg-auth";
import { apiJson, JvgBackendError, safeError } from "../../../lib/jvg-backend";
import { validCnpj } from "../../../lib/fiscal-company";

export const dynamic = "force-dynamic";

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

async function lookupCnpj(cnpj: string) {
  const first = await requestProvider(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (first.status === 200 && first.data.razao_social) {
    const data = first.data;
    return { source: "BrasilAPI", cnpj, legalName: valueText(data.razao_social),
      tradeName: valueText(data.nome_fantasia), email: valueText(data.email, 160),
      phone: valueText(data.ddd_telefone_1, 25), cnae: digits(String(data.cnae_fiscal ?? "")),
      street: valueText(data.logradouro), number: valueText(data.numero, 20),
      complement: valueText(data.complemento, 100), district: valueText(data.bairro, 100),
      city: valueText(data.municipio, 100), state: valueText(data.uf, 2),
      cityCode: digits(String(data.codigo_municipio_ibge ?? "")),
      postalCode: digits(valueText(data.cep, 10)) };
  }
  // O endpoint publico alternativo tem limite de 3 consultas/minuto.
  // So e usado se o principal falhar, e apenas para CNPJ numerico.
  const second: ProviderResult = /^\d{14}$/.test(cnpj)
    ? await requestProvider(`https://publica.cnpj.ws/cnpj/${cnpj}`)
    : { status: 501, data: {} };
  const establishment = objectValue(second.data.estabelecimento);
  if (second.status === 200 && second.data.razao_social && establishment.cnpj) {
    const city = objectValue(establishment.cidade);
    const state = objectValue(establishment.estado);
    const activity = objectValue(establishment.atividade_principal);
    return { source: "CNPJ.ws", cnpj, legalName: valueText(second.data.razao_social),
      tradeName: valueText(establishment.nome_fantasia), email: valueText(establishment.email, 160),
      phone: digits(valueText(establishment.ddd1, 3) + valueText(establishment.telefone1, 20)),
      cnae: digits(String(activity.id ?? "")),
      street: valueText(establishment.logradouro), number: valueText(establishment.numero, 20),
      complement: valueText(establishment.complemento, 100), district: valueText(establishment.bairro, 100),
      city: valueText(city.nome, 100), state: valueText(state.sigla, 2),
      cityCode: digits(String(city.ibge_id ?? "")),
      postalCode: digits(valueText(establishment.cep, 10)) };
  }
  if (first.status === 404 && (second.status === 404 || second.status === 501)) {
    throw new JvgBackendError("CNPJ não encontrado nas fontes públicas. Confira os 14 caracteres.", 404);
  }
  if (first.status === 429 || second.status === 429) {
    throw new JvgBackendError("Limite de consultas de CNPJ atingido. Aguarde alguns minutos ou preencha manualmente.", 429);
  }
  throw new JvgBackendError("Consulta de CNPJ indisponível nas fontes públicas. Preencha manualmente e tente novamente depois.", 503);
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
