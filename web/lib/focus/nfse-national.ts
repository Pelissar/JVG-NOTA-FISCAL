const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digits = (value: unknown) => typeof value === "string" ? value.replace(/\D/g, "") : "";
const str = (value: unknown, max = 255) => typeof value === "string" ? value.trim().slice(0, max) : "";
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export type NfseNationalSources = {
  documentId: string;
  company: Record<string, unknown>;
  customer: Record<string, unknown>;
  service: Record<string, unknown>;
  serviceOrder: Record<string, unknown>;
  /** Confirmed commercial amount for this invoice; OS estimates are not reused implicitly. */
  serviceValue?: number | string;
  approvedTaxRules: {
    reviewStatus: string;
    codigoOpcaoSimplesNacional?: string | number;
    regimeTributarioSimplesNacional?: string | number;
    regimeEspecialTributacao?: string | number;
    tributacaoIss?: string | number;
  };
  dps: {
    serie?: string | number;
    numero?: string | number;
    finalidadeEmissao?: string | number;
    consumidorFinal?: string | number | boolean;
    indicadorDestinatario?: string | number;
    dataEmissao?: string;
    dataCompetencia?: string;
    codigoMunicipioPrestacao?: string;
  };
};

export type FocusNfseNationalBuild = {
  payload: Record<string, unknown>;
  reference: string;
  issues: string[];
  warnings: string[];
};

function optionalNumber(value: string | number | undefined): string {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return "";
}

function validDpsDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function addressFields(payload: Record<string, unknown>, address: Record<string, unknown>, suffix: "prestador" | "tomador") {
  const pairs: Array<[string, string, number]> = [
    ["logradouro", "street", 255], ["numero", "number", 60], ["complemento", "complement", 156],
    ["bairro", "district", 60],
  ];
  for (const [target, source, max] of pairs) {
    const value = str(address[source], max);
    if (value) payload[`${target}_${suffix}`] = value;
  }
  const cityCode = digits(address.cityCode);
  if (/^\d{7}$/.test(cityCode)) payload[`codigo_municipio_${suffix}`] = Number(cityCode);
  const postalCode = digits(address.postalCode);
  if (/^\d{8}$/.test(postalCode)) payload[`cep_${suffix}`] = postalCode;
}

/**
 * Maps only supplied company, customer, service, OS and reviewed profile data.
 * No ISS or Simples classification is inferred; no IBS/CBS keys are emitted.
 */
export function buildFocusNfseNationalPayload(source: NfseNationalSources): FocusNfseNationalBuild {
  const issues: string[] = [];
  const warnings: string[] = [];
  const addMissing = (condition: boolean, message: string) => { if (condition) issues.push(message); };
  const company = source.company;
  const customer = source.customer;
  const service = source.service;
  const serviceOrder = source.serviceOrder;
  const companyAddress = obj(company.address);
  const customerAddress = obj(customer.address);
  const reference = uuidPattern.test(source.documentId)
    ? `JVG${source.documentId.replace(/-/g, "").toUpperCase()}` : "";
  addMissing(!reference, "Identificador do documento fiscal inválido.");

  const series = optionalNumber(source.dps.serie);
  const number = optionalNumber(source.dps.numero);
  const finalidadeEmissao = optionalNumber(source.dps.finalidadeEmissao);
  const consumidorFinal = typeof source.dps.consumidorFinal === "boolean"
    ? (source.dps.consumidorFinal ? "1" : "0") : optionalNumber(source.dps.consumidorFinal);
  const indicadorDestinatario = optionalNumber(source.dps.indicadorDestinatario);
  const issueDate = str(source.dps.dataEmissao, 40);
  const competencyDate = str(source.dps.dataCompetencia, 10);
  const issuerCityCode = digits(companyAddress.cityCode);
  const serviceCityCode = digits(source.dps.codigoMunicipioPrestacao);
  const issuerCnpj = digits(company.cnpj);
  const customerDocument = digits(customer.document_number);
  const customerType = str(customer.document_type, 12);
  const customerName = str(customer.legal_name || customer.display_name, 150);
  const serviceName = str(service.name, 160);
  const serviceDescription = str(service.description, 255);
  const serviceValue = source.serviceValue === undefined || source.serviceValue === null || source.serviceValue === ""
    ? Number.NaN : Number(source.serviceValue);
  const codeIss = digits(service.national_taxation_code);
  const nbs = digits(service.nbs);
  const reviewed = source.approvedTaxRules.reviewStatus === "reviewed";
  const approved = source.approvedTaxRules;
  const simpleOption = reviewed ? optionalNumber(approved.codigoOpcaoSimplesNacional) : "";
  const specialRegime = reviewed ? optionalNumber(approved.regimeEspecialTributacao) : "";
  const issTaxation = reviewed ? optionalNumber(approved.tributacaoIss) : "";

  addMissing(!series || Number(series) < 1 || Number(series) > 49999, "Série da DPS não configurada para homologação.");
  addMissing(!number || Number(number) < 1, "Número da DPS não configurado; falta a sequência fiscal de NFS-e.");
  addMissing(finalidadeEmissao !== "0", "Finalidade da emissão precisa ser confirmada como NFS-e regular (código 0).");
  addMissing(!["0", "1"].includes(consumidorFinal), "Informe explicitamente se o serviço é para uso ou consumo pessoal (consumidor final).");
  addMissing(!["0", "1"].includes(indicadorDestinatario), "Informe explicitamente se o destinatário é o próprio tomador.");
  addMissing(indicadorDestinatario === "1", "Esta etapa só prepara NFS-e quando o destinatário é o próprio tomador; cadastre os dados do destinatário diferente antes de usar essa situação.");
  addMissing(!validDpsDateTime(issueDate), "Data e hora de emissão da DPS ausentes ou inválidas.");
  addMissing(!validDateOnly(competencyDate), "Data de competência do serviço ausente ou inválida.");
  addMissing(!/^\d{7}$/.test(issuerCityCode), "Código IBGE de 7 dígitos do município emissor ausente no endereço da empresa.");
  addMissing(!/^\d{14}$/.test(issuerCnpj), "CNPJ do prestador ausente ou inválido.");
  addMissing(!reviewed, "Perfil de NFS-e ainda não foi revisado pela contabilidade.");
  addMissing(!["1", "2", "3"].includes(simpleOption), "Código da opção do Simples Nacional precisa vir do perfil fiscal revisado.");
  addMissing(!specialRegime, "Regime especial de tributação municipal precisa ser confirmado no perfil fiscal.");
  addMissing(!["1", "2", "3", "4"].includes(issTaxation), "Tributação do ISS precisa ser confirmada no perfil fiscal revisado.");
  addMissing(!/^\d{11}$/.test(customerDocument) && !/^\d{14}$/.test(customerDocument), "CPF/CNPJ do tomador ausente ou inválido.");
  addMissing(customerType !== "cpf" && customerType !== "cnpj", "O tomador precisa estar cadastrado como pessoa física ou jurídica no Brasil.");
  addMissing(!/^\d{7}$/.test(serviceCityCode), "Código IBGE do local da prestação precisa ser informado; a OS não presume o município do serviço.");
  addMissing(!/^\d{6}$/.test(codeIss), "Código nacional ISS de 6 dígitos ausente no serviço; o subitem LC 116 não é convertido automaticamente.");
  addMissing(!serviceName, "Serviço do catálogo não foi informado.");
  addMissing(!Number.isFinite(serviceValue) || serviceValue <= 0, "Informe o valor final do serviço aprovado para faturamento.");
  addMissing(serviceOrder.status !== "delivered", "A OS precisa estar entregue antes de preparar a NFS-e.");
  addMissing(serviceOrder.customer_approved !== true, "A aprovação do cliente para a OS está pendente.");
  addMissing(Boolean(serviceOrder.customer_id) && String(serviceOrder.customer_id) !== String(customer.id), "O tomador informado não corresponde ao cliente da OS.");
  addMissing(!customerName, "Nome/Razão social do tomador ausente.");

  const payload: Record<string, unknown> = {};
  const set = (key: string, value: string | number) => { if (String(value).trim()) payload[key] = value; };
  if (series && Number(series) >= 1 && Number(series) <= 49999) set("serie_dps", Number(series));
  if (number && Number(number) >= 1) set("numero_dps", Number(number));
  if (finalidadeEmissao === "0") set("finalidade_emissao", Number(finalidadeEmissao));
  if (["0", "1"].includes(consumidorFinal)) set("consumidor_final", Number(consumidorFinal));
  if (indicadorDestinatario === "0") set("indicador_destinatario", 0);
  set("data_emissao", issueDate);
  set("data_competencia", competencyDate);
  set("emitente_dps", "1"); // Focus documents 1 as the default: service provider.
  if (/^\d{7}$/.test(issuerCityCode)) set("codigo_municipio_emissora", Number(issuerCityCode));
  set("cnpj_prestador", issuerCnpj);
  set("inscricao_municipal_prestador", str(company.municipal_registration, 15));
  set("razao_social_prestador", str(company.legal_name || company.trade_name, 150));
  set("codigo_municipio_prestador", issuerCityCode);
  set("telefone_prestador", digits(company.fiscal_phone));
  set("email_prestador", str(company.fiscal_email, 80));
  addressFields(payload, companyAddress, "prestador");
  set("codigo_opcao_simples_nacional", simpleOption);
  set("regime_especial_tributacao", specialRegime);
  set("tributacao_iss", issTaxation);
  const simpleTaxRegime = reviewed ? optionalNumber(approved.regimeTributarioSimplesNacional) : "";
  if (["1", "2", "3"].includes(simpleTaxRegime)) set("regime_tributario_simples_nacional", simpleTaxRegime);

  if (customerType === "cpf" && /^\d{11}$/.test(customerDocument)) set("cpf_tomador", customerDocument);
  if (customerType === "cnpj" && /^\d{14}$/.test(customerDocument)) set("cnpj_tomador", customerDocument);
  set("razao_social_tomador", customerName);
  set("telefone_tomador", digits(customer.phone));
  set("email_tomador", str(customer.email, 80));
  addressFields(payload, customerAddress, "tomador");
  set("codigo_municipio_prestacao", serviceCityCode);
  set("codigo_tributacao_nacional_iss", codeIss);
  set("codigo_nbs", /^\d{9}$/.test(nbs) ? nbs : "");
  const description = [serviceName, serviceDescription]
    .filter(Boolean).join(" — ").slice(0, 1000);
  set("descricao_servico", description);
  set("valor_servico", Number.isFinite(serviceValue) && serviceValue > 0 ? Number(serviceValue.toFixed(2)) : "");
  if (service.lc116) warnings.push("O subitem LC 116 fica registrado como referência e não substitui o código nacional ISS de 6 dígitos.");
  if (!nbs) warnings.push("NBS não informado no cadastro do serviço; confirme se deve constar para esta atividade.");
  else if (!/^\d{9}$/.test(nbs)) warnings.push("NBS não tem 9 dígitos e foi omitido do payload até ser corrigido no cadastro do serviço.");
  if (!simpleTaxRegime) warnings.push("Regime de apuração do Simples não foi enviado porque não consta no perfil revisado.");

  return { payload, reference, issues, warnings };
}
