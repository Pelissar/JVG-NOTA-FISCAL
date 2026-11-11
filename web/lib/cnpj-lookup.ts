type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown, max = 200): string => typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "";
const digits = (value: unknown): string => text(value).replace(/\D/g, "");
const email = (value: unknown): string => {
  const address = text(value, 254).toLowerCase();
  return address.length <= 160 ? address : "";
};
const registrationStatus = (value: unknown): string => {
  const status = text(value, 80);
  const names: Record<string, string> = { "1": "Nula", "2": "Ativa", "3": "Suspensa", "4": "Inapta", "8": "Baixada" };
  return names[status] || status;
};

function streetName(kind: unknown, name: unknown): string {
  const type = text(kind, 32);
  const street = text(name, 140);
  if (!street) return "";
  return type && !street.toLocaleLowerCase("pt-BR").startsWith(type.toLocaleLowerCase("pt-BR")) ? `${type} ${street}` : street;
}

export type CnpjFields = {
  cnpj: string;
  legalName: string;
  tradeName: string;
  email: string;
  phone: string;
  cnae: string;
  cnaeDescription: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  cityCode: string;
  postalCode: string;
  registrationStatus: string;
  simplesNational: boolean | null;
  mei: boolean | null;
};

export function emptyCnpjFields(cnpj: string): CnpjFields {
  return {
    cnpj, legalName: "", tradeName: "", email: "", phone: "", cnae: "", cnaeDescription: "",
    street: "", number: "", complement: "", district: "", city: "", state: "", cityCode: "",
    postalCode: "", registrationStatus: "", simplesNational: null, mei: null,
  };
}

export function focusCnpjFields(payload: unknown, cnpj: string): CnpjFields {
  const data = record(payload);
  const address = record(data.endereco);
  return {
    ...emptyCnpjFields(cnpj),
    cnpj: digits(data.cnpj) || cnpj,
    legalName: text(data.razao_social),
    cnae: digits(data.cnae_principal),
    street: streetName(address.tipo_logradouro, address.logradouro),
    number: text(address.numero, 20),
    complement: text(address.complemento, 100),
    district: text(address.bairro, 100),
    city: text(address.nome_municipio, 100),
    state: text(address.uf, 2).toUpperCase(),
    cityCode: digits(address.codigo_ibge),
    postalCode: digits(address.cep).slice(0, 8),
    registrationStatus: text(data.situacao_cadastral, 80),
    simplesNational: typeof data.optante_simples_nacional === "boolean" ? data.optante_simples_nacional : null,
    mei: typeof data.optante_mei === "boolean" ? data.optante_mei : null,
  };
}

export function brasilApiCnpjFields(payload: unknown, cnpj: string): CnpjFields {
  const data = record(payload);
  return {
    ...emptyCnpjFields(cnpj),
    cnpj: digits(data.cnpj) || cnpj,
    legalName: text(data.razao_social),
    tradeName: text(data.nome_fantasia),
    email: email(data.email),
    phone: digits(data.ddd_telefone_1) || digits(data.ddd_telefone_2),
    cnae: digits(data.cnae_fiscal),
    cnaeDescription: text(data.cnae_fiscal_descricao, 240),
    street: text(data.logradouro, 160),
    number: text(data.numero, 20),
    complement: text(data.complemento, 100),
    district: text(data.bairro, 100),
    city: text(data.municipio, 100),
    state: text(data.uf, 2).toUpperCase(),
    cityCode: digits(data.codigo_municipio_ibge),
    postalCode: digits(data.cep).slice(0, 8),
    registrationStatus: registrationStatus(data.situacao_cadastral ?? data.descricao_situacao_cadastral),
    simplesNational: typeof data.opcao_pelo_simples === "boolean" ? data.opcao_pelo_simples : null,
    mei: typeof data.opcao_pelo_mei === "boolean" ? data.opcao_pelo_mei : null,
  };
}

export function cnpjWsFields(payload: unknown, cnpj: string): CnpjFields {
  const data = record(payload);
  const establishment = record(data.estabelecimento);
  const city = record(establishment.cidade);
  const state = record(establishment.estado);
  const activity = record(establishment.atividade_principal);
  return {
    ...emptyCnpjFields(cnpj),
    cnpj: digits(establishment.cnpj) || cnpj,
    legalName: text(data.razao_social),
    tradeName: text(establishment.nome_fantasia),
    email: email(establishment.email),
    phone: digits(establishment.ddd1) + digits(establishment.telefone1),
    cnae: digits(activity.id),
    cnaeDescription: text(activity.descricao, 240),
    street: streetName(establishment.tipo_logradouro, establishment.logradouro),
    number: text(establishment.numero, 20),
    complement: text(establishment.complemento, 100),
    district: text(establishment.bairro, 100),
    city: text(city.nome, 100),
    state: text(state.sigla, 2).toUpperCase(),
    cityCode: digits(city.ibge_id),
    postalCode: digits(establishment.cep).slice(0, 8),
    registrationStatus: text(establishment.situacao_cadastral, 80),
    simplesNational: null,
    mei: null,
  };
}

export function mergeCnpjFields(cnpj: string, ...sources: CnpjFields[]): CnpjFields {
  const merged = emptyCnpjFields(cnpj);
  for (const source of sources) {
    for (const key of Object.keys(merged) as (keyof CnpjFields)[]) {
      if (key === "simplesNational" || key === "mei") {
        if (merged[key] === null && source[key] !== null) merged[key] = source[key] as never;
      } else if (!merged[key] && source[key]) {
        merged[key] = source[key] as never;
      }
    }
  }
  return merged;
}
