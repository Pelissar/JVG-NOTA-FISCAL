import { getJvgUser } from "../../jvg-auth";
import { apiJson, JvgBackendError, safeError } from "../../../lib/jvg-backend";
import { validCnpj } from "../../../lib/fiscal-company";

export const dynamic = "force-dynamic";

type ProviderData = Record<string, unknown>;
const digits = (value: string) => value.replace(/\D/g, "");
const valueText = (value: unknown, length = 160) => typeof value === "string" ? value.trim().slice(0, length) : "";

async function requestProvider(url: string): Promise<ProviderData> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new JvgBackendError("Consulta temporariamente indisponível. Preencha os dados manualmente.", 503);
  }
  if (response.status === 404) throw new JvgBackendError("Cadastro não encontrado. Confira o número informado.", 404);
  if (response.status === 429) throw new JvgBackendError("Muitas consultas no momento. Aguarde e tente novamente.", 429);
  if (!response.ok) throw new JvgBackendError("Serviço de consulta indisponível. Tente novamente mais tarde.", 503);
  const data: unknown = await response.json().catch(() => null);
  if (!data || Array.isArray(data) || typeof data !== "object") throw new JvgBackendError("Resposta inválida do serviço de consulta.", 502);
  return data as ProviderData;
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
      const data = await requestProvider(`https://viacep.com.br/ws/${cep}/json/`);
      if (data.erro) throw new JvgBackendError("CEP não encontrado. Confira os 8 dígitos.", 404);
      return apiJson({ source: "ViaCEP", street: valueText(data.logradouro), district: valueText(data.bairro),
        city: valueText(data.localidade, 100), state: valueText(data.uf, 2),
        postalCode: digits(valueText(data.cep, 9)), cityCode: digits(valueText(data.ibge, 7)),
        complement: valueText(data.complemento, 100) });
    }
    if (kind === "cnpj") {
      const cnpj = raw.replace(/[^A-Z0-9]/g, "");
      if (!validCnpj(cnpj)) throw new JvgBackendError("CNPJ inválido. Confira o número e os dígitos verificadores.", 400);
      const data = await requestProvider(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      return apiJson({ source: "BrasilAPI", cnpj, legalName: valueText(data.razao_social),
        tradeName: valueText(data.nome_fantasia), email: valueText(data.email, 160),
        phone: valueText(data.ddd_telefone_1, 25), cnae: digits(String(data.cnae_fiscal ?? "")),
        street: valueText(data.logradouro), number: valueText(data.numero, 20),
        complement: valueText(data.complemento, 100), district: valueText(data.bairro, 100),
        city: valueText(data.municipio, 100), state: valueText(data.uf, 2),
        postalCode: digits(valueText(data.cep, 10)) });
    }
    throw new JvgBackendError("Selecione consulta por CEP ou CNPJ.", 400);
  } catch (error) {
    return safeError(error);
  }
}
