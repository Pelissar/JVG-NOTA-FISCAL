/**
 * Checklist interno de preparação de NF-e. NÃO é leiaute XML, DANFE, nem
 * validação de schema, regras fiscais ou autorização da SEFAZ.
 * Não assume que um rascunho sem pendências está apto a emitir.
 */
import { isIbsCbsEnabledForNfe, reviewFocusTaxRule } from "./focus-tax-fields.ts";

type Json = Record<string, unknown>;
export type ReviewCheck = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};
export type NfeDocumentReview = {
  schema: "jvg-nfe-preparation-v1";
  environment: "homologacao";
  documentModel: "55";
  stage: "draft";
  checks: ReviewCheck[];
  commercialTotalCents: number | null;
  fiscalApproved: false;
  transmissionEnabled: false;
  canGenerateFiscalXml: false;
};

const obj = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
const integerCents = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

function validFiscalDateTime(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && month >= 1 && month <= 12 && day >= 1 &&
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day &&
    Number(parts[4]) <= 23 && Number(parts[5]) <= 59 && Number(parts[6]) <= 59 && Number(parts[10] || 0) <= 59 &&
    (Number(parts[9] || 0) < 14 || (Number(parts[9] || 0) === 14 && Number(parts[10] || 0) === 0));
}

export function reviewNfeDocument(value: unknown): NfeDocumentReview {
  const payload = obj(value), issuer = obj(payload.issuer), recipient = obj(payload.recipient);
  const preflight = obj(payload.preflight), preview = obj(payload.taxPreview);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  const checks: ReviewCheck[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string) =>
    checks.push({ key, label, ok, detail });
  const total = integerCents(payload.totalCents);
  const additionalTotals = obj(payload.additionalTotals);
  const freight = additionalTotals.freightCents == null ? 0 : integerCents(additionalTotals.freightCents);
  const insurance = additionalTotals.insuranceCents == null ? 0 : integerCents(additionalTotals.insuranceCents);
  const discount = additionalTotals.discountCents == null ? 0 : integerCents(additionalTotals.discountCents);
  const expenses = additionalTotals.expensesCents == null ? 0 : integerCents(additionalTotals.expensesCents);
  const commercialTotal = total === null || freight === null || insurance === null || discount === null || expenses === null
    ? null : total + freight + insurance + expenses - discount;

  const supportedSchema = payload.schemaVersion === 3 || payload.schemaVersion === 4 || payload.schemaVersion === 5 || payload.schemaVersion === 6 || payload.schemaVersion === 7;
  add("version", "Versão do rascunho", supportedSchema,
      payload.schemaVersion === 7 ? "Estrutura interna atual" :
      payload.schemaVersion === 6 ? "Estrutura anterior compatível" :
      payload.schemaVersion === 5 ? "Estrutura anterior compatível" :
      payload.schemaVersion === 4 ? "Estrutura anterior compatível" :
      payload.schemaVersion === 3 ? "Estrutura anterior compatível" : "Rascunho legado: refaça a preparação");
  add("issuer", "Dados do emitente",
      Boolean(text(issuer.cnpj) && text(issuer.stateRegistration) && issuer.taxRegime === "simples_nacional" && issuer.taxRegimeConfirmed === true),
      "CNPJ, inscrição estadual e regime Simples Nacional confirmado pela contabilidade devem estar informados");
  add("recipient", "Identificação do destinatário",
      Boolean(text(recipient.name) && text(recipient.documentNumber) && text(recipient.documentType)),
      "Destinatário identificado no cadastro da empresa");
  add("preflight", "Pré-conferência cadastral",
      preflight.dataComplete === true && Array.isArray(preflight.issues) && preflight.issues.length === 0,
      "Valida CPF e campos cadastrais; não valida autorização fiscal");

  let subtotal = 0;
  let validItems = items.length > 0 && items.length <= 20;
  let completeClassifications = validItems;
  for (const row of items) {
    const item = obj(row);
    const cents = integerCents(item.subtotalCents);
    if (cents === null || subtotal + cents > Number.MAX_SAFE_INTEGER) validItems = false;
    else subtotal += cents;
    if (!/^\d{8}$/.test(text(item.ncm)) || !/^\d{4}$/.test(text(item.cfop)) ||
        !/^\d{3}$/.test(text(item.csosn))) completeClassifications = false;
  }
  add("items", "Itens e valor comercial", validItems && total !== null && subtotal === total,
      "Conferência aritmética dos subtotais e do total comercial em centavos");
  add("classifications", "Classificações dos produtos", completeClassifications,
      "NCM, CFOP e CSOSN informados; compatibilidade fiscal exige revisão");
  add("profiles", "Perfis tributários", true,
      "Configuração interna opcional; CFOP e demais dados fiscais são conferidos diretamente em cada item.");
  add("taxPreview", "Cálculo dos tributos",
      preview.validForEmission === true && preview.calculationMethod === "approved_rule_engine",
      "O ERP não calcula tributos. Os valores fiscais informados em cada item são mapeados sem completar bases, alíquotas ou impostos.");
  add("pending", "Pendências fiscais", pending.length === 0,
      pending.length ? pending.length + " pendência(s) aguardando conferência" :
      "Nenhuma pendência cadastrada; isso não representa autorização");
  add("transmission", "Homologação fiscal", false,
      "XML, certificado digital, regras fiscais e autorização SEFAZ ainda não certificados");
  return {
    schema: "jvg-nfe-preparation-v1",
    environment: "homologacao",
    documentModel: "55",
    stage: "draft",
    checks,
    commercialTotalCents: commercialTotal,
    fiscalApproved: false,
    transmissionEnabled: false,
    canGenerateFiscalXml: false,
  };
}


export type FocusNfePayloadReview = {
  environment: "homologacao";
  endpoint: "POST /v2/nfe?ref";
  requestPreview: Json;
  checks: ReviewCheck[];
  missingCount: number;
  autoAssignedFields: string[];
  transmissionEnabled: false;
  canSend: false;
};

const requiredIcmsFieldsForCsosn: Record<string, string[]> = {
  "101": ["icms_aliquota_credito_simples", "icms_valor_credito_simples"],
  "201": ["icms_modalidade_base_calculo_st", "icms_margem_valor_adicionado_st", "icms_reducao_base_calculo_st", "icms_base_calculo_st", "icms_aliquota_st", "icms_valor_st", "icms_aliquota_credito_simples", "icms_valor_credito_simples"],
  "202": ["icms_modalidade_base_calculo_st", "icms_margem_valor_adicionado_st", "icms_reducao_base_calculo_st", "icms_base_calculo_st", "icms_aliquota_st", "icms_valor_st"],
  "203": ["icms_modalidade_base_calculo_st", "icms_margem_valor_adicionado_st", "icms_reducao_base_calculo_st", "icms_base_calculo_st", "icms_aliquota_st", "icms_valor_st"],
};

// Somente campos tributários de item aceitos pela Focus. Campos calculados
// pela API, como ibs_valor_total, não entram no payload preparado pelo ERP.
const focusTaxFieldNames = new Set([
  "icms_modalidade_base_calculo", "icms_reducao_base_calculo", "icms_base_calculo", "icms_aliquota", "icms_valor",
  "icms_modalidade_base_calculo_st", "icms_margem_valor_adicionado_st", "icms_reducao_base_calculo_st",
  "icms_base_calculo_st", "icms_aliquota_st", "icms_valor_st", "icms_aliquota_credito_simples", "icms_valor_credito_simples",
  "icms_base_calculo_retido_st", "icms_valor_retido_st", "icms_valor_substituto", "icms_aliquota_final",
  "pis_base_calculo", "pis_aliquota_porcentual", "pis_quantidade_vendida", "pis_aliquota_valor", "pis_valor",
  "pis_base_calculo_st", "pis_aliquota_porcentual_st", "pis_quantidade_vendida_st", "pis_aliquota_valor_st", "pis_valor_st",
  "cofins_base_calculo", "cofins_aliquota_porcentual", "cofins_quantidade_vendida", "cofins_aliquota_valor", "cofins_valor",
  "cofins_base_calculo_st", "cofins_aliquota_porcentual_st", "cofins_quantidade_vendida_st", "cofins_aliquota_valor_st", "cofins_valor_st",
  "ibs_cbs_base_calculo", "ibs_uf_aliquota", "ibs_uf_valor", "ibs_mun_aliquota", "ibs_mun_valor", "cbs_aliquota", "cbs_valor",
]);
const focusFieldLabels: Record<string, string> = {
  icms_modalidade_base_calculo: "modalidade da base do ICMS", icms_reducao_base_calculo: "redução da base do ICMS",
  icms_base_calculo: "base de cálculo do ICMS", icms_aliquota: "alíquota do ICMS", icms_valor: "valor do ICMS",
  icms_modalidade_base_calculo_st: "modalidade da base do ICMS-ST", icms_margem_valor_adicionado_st: "MVA do ICMS-ST",
  icms_reducao_base_calculo_st: "redução da base do ICMS-ST", icms_base_calculo_st: "base de cálculo do ICMS-ST",
  icms_aliquota_st: "alíquota do ICMS-ST", icms_valor_st: "valor do ICMS-ST",
  icms_aliquota_credito_simples: "alíquota de crédito do Simples", icms_valor_credito_simples: "valor de crédito do Simples",
  icms_base_calculo_retido_st: "base do ICMS-ST retido", icms_valor_retido_st: "valor do ICMS-ST retido",
  icms_valor_substituto: "valor do ICMS do substituto", icms_aliquota_final: "alíquota final do ICMS",
  pis_base_calculo: "base de cálculo do PIS", pis_aliquota_porcentual: "alíquota percentual do PIS",
  pis_quantidade_vendida: "quantidade tributável do PIS", pis_aliquota_valor: "alíquota do PIS por unidade",
  pis_valor: "valor do PIS", pis_base_calculo_st: "base do PIS-ST", pis_aliquota_porcentual_st: "alíquota do PIS-ST",
  pis_quantidade_vendida_st: "quantidade tributável do PIS-ST", pis_aliquota_valor_st: "alíquota do PIS-ST por unidade",
  pis_valor_st: "valor do PIS-ST", cofins_base_calculo: "base de cálculo da Cofins",
  cofins_aliquota_porcentual: "alíquota percentual da Cofins", cofins_quantidade_vendida: "quantidade tributável da Cofins",
  cofins_aliquota_valor: "alíquota da Cofins por unidade", cofins_valor: "valor da Cofins",
  cofins_base_calculo_st: "base da Cofins-ST", cofins_aliquota_porcentual_st: "alíquota da Cofins-ST",
  cofins_quantidade_vendida_st: "quantidade tributável da Cofins-ST", cofins_aliquota_valor_st: "alíquota da Cofins-ST por unidade",
  cofins_valor_st: "valor da Cofins-ST", ibs_cbs_base_calculo: "base de cálculo IBS/CBS",
  ibs_uf_aliquota: "alíquota do IBS estadual", ibs_uf_valor: "valor do IBS estadual",
  ibs_mun_aliquota: "alíquota do IBS municipal", ibs_mun_valor: "valor do IBS municipal",
  cbs_aliquota: "alíquota da CBS", cbs_valor: "valor da CBS",
};
const focusFieldLabel = (field: string): string => focusFieldLabels[field] || field;
const focusFieldList = (fields: string[]): string => fields.map(focusFieldLabel).join(", ");
const supportedCsosn = new Set(["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]);

function missingTaxFields(fields: string[], focusFields: Json): string[] {
  return fields.filter(field => focusFields[field] === undefined || focusFields[field] === null || focusFields[field] === "");
}

function conditionalIcmsMissing(csosn: string, focusFields: Json): string[] {
  const required = requiredIcmsFieldsForCsosn[csosn];
  if (required) return missingTaxFields(required, focusFields);
  if (csosn === "900") {
    const basic = ["icms_modalidade_base_calculo", "icms_base_calculo", "icms_reducao_base_calculo", "icms_aliquota", "icms_valor"];
    const substitution = ["icms_modalidade_base_calculo_st", "icms_margem_valor_adicionado_st", "icms_reducao_base_calculo_st", "icms_base_calculo_st", "icms_aliquota_st", "icms_valor_st"];
    const basicPresent = basic.some(field => focusFields[field] !== undefined && focusFields[field] !== "");
    const substitutionPresent = substitution.some(field => focusFields[field] !== undefined && focusFields[field] !== "");
    const missing = [
      ...(basicPresent ? missingTaxFields(basic, focusFields) : []),
      ...(substitutionPresent ? missingTaxFields(substitution, focusFields) : []),
    ];
    return missing;
  }
  return [];
}

function conditionalPisCofinsFields(cst: string, prefix: "pis" | "cofins"): string[] {
  if (cst === "01" || cst === "02") return [`${prefix}_base_calculo`, `${prefix}_aliquota_porcentual`, `${prefix}_valor`];
  if (cst === "03") return [`${prefix}_quantidade_vendida`, `${prefix}_aliquota_valor`, `${prefix}_valor`];
  if (cst === "05") return [`${prefix}_base_calculo_st`, `${prefix}_aliquota_porcentual_st`, `${prefix}_valor_st`];
  return [];
}

/** Prévia estrutural parcial; nunca habilita ou chama a transmissão Focus. */
export function reviewFocusNfePayload(value: unknown): FocusNfePayloadReview {
  const payload = obj(value), issuer = obj(payload.issuer), recipient = obj(payload.recipient);
  const issuerAddress = obj(issuer.address), recipientAddress = obj(recipient.address);
  const sourceItems = Array.isArray(payload.items) ? payload.items : [];
  const requestPreview: Json = {};
  const checks: ReviewCheck[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string, mappedValue?: unknown) => {
    checks.push({ key, label, ok, detail });
    if (ok && mappedValue !== undefined) requestPreview[key] = mappedValue;
  };
  const textDigits = (raw: unknown) => text(raw).replace(/\D/g, "");
const cpfDocumentIsValid = (digits: string): boolean => {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let index = 0; index < length; index++) sum += Number(digits[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    if (Number(digits[length]) !== (remainder === 10 ? 0 : remainder)) return false;
  }
  return true;
};
const cnpjDocumentIsValid = (digits: string): boolean => {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const checkDigit = (base: string, weights: number[]) => {
    const remainder = base.split("").reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0) % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return Number(digits[12]) === checkDigit(digits.slice(0, 12), firstWeights) &&
    Number(digits[13]) === checkDigit(digits.slice(0, 13), secondWeights);
};
  const nature = text(payload.nature);
  add("natureza_operacao", "Natureza da operação", nature.length >= 1 && nature.length <= 60,
      "A Focus aceita até 60 caracteres.", nature.length >= 1 && nature.length <= 60 ? nature : undefined);
  add("tipo_documento", "Tipo da NF-e", true, "Fluxo de NF-e de saída.", 1);
  const purpose = payload.purpose === "" || payload.purpose == null ? NaN : Number(payload.purpose);
  const purposeDetail = purpose === 1 ? "NF-e normal; as demais finalidades exigem dados de referência ainda não capturados por este fluxo." :
    Number.isInteger(purpose) && [2, 3, 4].includes(purpose) ? "Esta versão só prepara NF-e normal; a finalidade selecionada exige dados de referência ainda não capturados." :
    "Selecione explicitamente a finalidade da emissão; ela não é presumida pelo ERP.";
  add("finalidade_emissao", "Finalidade da emissão",
      purpose === 1,
      purposeDetail, purpose === 1 ? 1 : undefined);
  const issuerUf = text(issuer.state).toUpperCase(), recipientUf = text(recipient.state).toUpperCase();
  const validUfs = /^[A-Z]{2}$/.test(issuerUf) && /^[A-Z]{2}$/.test(recipientUf);
  add("local_destino", "Local de destino", validUfs,
      "Derivado das UFs do emitente e destinatário.", validUfs ? (issuerUf === recipientUf ? 1 : 2) : undefined);
  const issueAt = text(payload.issueAt);
  const issueAtValid = validFiscalDateTime(issueAt);
  add("data_emissao", "Data/hora de emissão", issueAtValid,
      "Informe data e hora explicitamente, com fuso horário.", issueAtValid ? issueAt : undefined);
  const exitAt = text(payload.exitAt);
  const exitAtValid = !exitAt || validFiscalDateTime(exitAt);
  if (exitAt && exitAtValid) requestPreview.data_entrada_saida = exitAt;
  add("data_entrada_saida", "Data/hora de saída", exitAtValid,
      exitAt ? "Data/hora informada convertida para data_entrada_saida." : "Opcional; informe quando a operação tiver data/hora de saída definida.");
  const finalConsumer = payload.consumerFinal;
  const finalConsumerValid = typeof finalConsumer === "boolean";
  add("consumidor_final", "Consumidor final", finalConsumerValid,
      "Precisa ser indicado por operação; não é inferido pelo tipo de pessoa.",
      finalConsumerValid ? (finalConsumer ? 1 : 0) : undefined);
  const presence = payload.buyerPresence === "" || payload.buyerPresence == null ? NaN : Number(payload.buyerPresence);
  const presenceValid = Number.isInteger(presence) && [0,1,2,3,4,5,9].includes(presence);
  add("presenca_comprador", "Presença do comprador", presenceValid,
      "Informe a condição real da operação; o ERP não infere presença ou canal de venda.", presenceValid ? presence : undefined);

  const normalizeCnpj = (value: unknown) => text(value).toUpperCase().replace(/[.\-/\s]/g, "");
  const cnpj = normalizeCnpj(issuer.cnpj), issuerName = text(issuer.legalName || issuer.name);
  const ie = text(issuer.stateRegistration);
  const regime = issuer.taxRegime === "simples_nacional" ? 1 :
    issuer.taxRegime === "lucro_presumido" || issuer.taxRegime === "lucro_real" ? 3 : null;
  const alphaIssuerCnpj = /^[A-Z0-9]{12}\d{2}$/.test(cnpj) && /[A-Z]/.test(cnpj);
  const validIssuerCnpj = /^\d{14}$/.test(cnpj) && cnpjDocumentIsValid(cnpj);
  add("cnpj_emitente", "CNPJ do emitente", validIssuerCnpj,
      alphaIssuerCnpj ? "CNPJ alfanumérico preservado, mas a referência Focus de homologação ainda define cnpj_emitente como Integer[14]; confirme o suporte antes de transmitir." :
      "Informe um CNPJ numérico válido, com 14 dígitos verificadores corretos.", validIssuerCnpj ? cnpj : undefined);
  add("nome_emitente", "Razão social do emitente", issuerName.length >= 2 && issuerName.length <= 60,
      "Razão social deve ter de 2 a 60 caracteres.", issuerName.length >= 2 && issuerName.length <= 60 ? issuerName : undefined);
  add("inscricao_estadual_emitente", "Inscrição estadual do emitente", ie.length >= 2 && ie.length <= 14,
      "A Focus exige a inscrição estadual do emitente.", ie.length >= 2 && ie.length <= 14 ? ie : undefined);
  add("regime_tributario_emitente", "Regime do emitente", regime !== null && issuer.taxRegimeConfirmed === true,
      "Conversão somente após confirmação contábil.", regime !== null && issuer.taxRegimeConfirmed === true ? regime : undefined);

  const mapAddress = (address: Json, pairs: Array<[string,string,string]>) => {
    pairs.forEach(([focusField, source, label]) => {
      const raw = text(address[source]);
      const mapped = source === "postalCode" || source === "cityCode" ? textDigits(raw) :
        source === "state" ? raw.toUpperCase() : raw;
      const pattern = source === "cityCode" ? /^\d{7}$/ : source === "postalCode" ? /^\d{8}$/ : null;
      const ok = pattern ? pattern.test(mapped) : mapped.length > 0;
      add(focusField, label, ok, "Conferir endereço fiscal cadastrado.", ok ? mapped : undefined);
    });
  };
  mapAddress(issuerAddress, [
    ["logradouro_emitente","street","Logradouro do emitente"],
    ["numero_emitente","number","Número do emitente"],
    ["bairro_emitente","district","Bairro do emitente"],
    ["codigo_municipio_emitente","cityCode","Código IBGE do emitente"],
    ["municipio_emitente","city","Município do emitente"],
    ["uf_emitente","state","UF do emitente"],
    ["cep_emitente","postalCode","CEP do emitente"],
  ]);
  if (text(issuer.tradeName)) requestPreview.nome_fantasia_emitente = text(issuer.tradeName);
  if (text(issuerAddress.complement)) requestPreview.complemento_emitente = text(issuerAddress.complement);
  if (textDigits(issuer.fiscalPhone)) requestPreview.telefone_emitente = textDigits(issuer.fiscalPhone);
  if (text(issuer.municipalRegistration) && text(issuer.cnae)) {
    requestPreview.inscricao_municipal_emitente = text(issuer.municipalRegistration);
    requestPreview.cnae_fiscal_emitente = textDigits(issuer.cnae);
  }

  const recipientType = text(recipient.documentType).toLowerCase();
  const rawRecipientDocument = text(recipient.documentNumber);
  const recipientDocument = recipientType === "cnpj" ? normalizeCnpj(rawRecipientDocument) : textDigits(rawRecipientDocument);
  const alphaRecipientCnpj = recipientType === "cnpj" && /^[A-Z0-9]{12}\d{2}$/.test(recipientDocument) && /[A-Z]/.test(recipientDocument);
  const validCpf = recipientType === "cpf" && cpfDocumentIsValid(recipientDocument);
  const validCnpj = recipientType === "cnpj" && /^\d{14}$/.test(recipientDocument) && cnpjDocumentIsValid(recipientDocument);
  const docOk = validCpf || validCnpj;
  add("documento_destinatario", "CPF/CNPJ do destinatário", docOk,
      alphaRecipientCnpj ? "CNPJ alfanumérico preservado, mas a referência Focus de homologação ainda define cnpj_destinatario como Integer[14]; confirme o suporte antes de transmitir." :
      "Informe CPF/CNPJ com formato e dígitos verificadores válidos; documento estrangeiro ainda não está mapeado.");
  if (validCpf) requestPreview.cpf_destinatario = recipientDocument;
  if (validCnpj) requestPreview.cnpj_destinatario = recipientDocument;
  const recipientName = text(recipient.legalName || recipient.name);
  add("nome_destinatario", "Nome/razão social do destinatário",
      recipientName.length >= 2 && recipientName.length <= 60,
      "Nome deve ter de 2 a 60 caracteres.",
      recipientName.length >= 2 && recipientName.length <= 60 ? recipientName : undefined);
  mapAddress(recipientAddress, [
    ["logradouro_destinatario","street","Logradouro do destinatário"],
    ["numero_destinatario","number","Número do destinatário"],
    ["bairro_destinatario","district","Bairro do destinatário"],
    ["codigo_municipio_destinatario","cityCode","Código IBGE do destinatário"],
    ["municipio_destinatario","city","Município do destinatário"],
    ["uf_destinatario","state","UF do destinatário"],
  ]);
  const recipientPostal = textDigits(recipientAddress.postalCode);
  if (/^\d{8}$/.test(recipientPostal)) requestPreview.cep_destinatario = recipientPostal;
  if (text(recipient.email)) requestPreview.email_destinatario = text(recipient.email);
  if (textDigits(recipient.phone)) requestPreview.telefone_destinatario = textDigits(recipient.phone);
  if (text(recipient.stateRegistration)) requestPreview.inscricao_estadual_destinatario = text(recipient.stateRegistration);
  const ieIndicator = Number(payload.recipientIeIndicator);
  const ieIndicatorValid = Number.isInteger(ieIndicator) && [1,2,9].includes(ieIndicator);
  add("indicador_inscricao_estadual_destinatario", "Indicador de IE do destinatário", ieIndicatorValid,
      "Escolher contribuinte, isento ou não contribuinte para esta operação.",
      ieIndicatorValid ? ieIndicator : undefined);

  const intermediary = obj(payload.intermediary);
  const intermediaryWasProvided = intermediary.indicator != null && intermediary.indicator !== "";
  const intermediaryInput = intermediaryWasProvided ? Number(intermediary.indicator) : 0;
  const intermediaryValid = Number.isInteger(intermediaryInput) && [0, 1].includes(intermediaryInput);
  const intermediaryIndicator = intermediaryValid ? intermediaryInput : NaN;
  const intermediaryMapped: Json = {};
  if (intermediaryValid) intermediaryMapped.indicador_intermediario = intermediaryIndicator;
  const intermediaryProblems: string[] = [];
  if (!intermediaryValid) intermediaryProblems.push("informe 0 (sem intermediador) ou 1 (plataforma de terceiros)");
  if (intermediaryIndicator === 1) {
    const intermediaryCnpj = textDigits(intermediary.cnpj);
    const intermediaryId = text(intermediary.id);
    if (/^\d{14}$/.test(intermediaryCnpj) && cnpjDocumentIsValid(intermediaryCnpj)) intermediaryMapped.cnpj_intermediario = intermediaryCnpj;
    else intermediaryProblems.push("informe um CNPJ válido do intermediador");
    if (intermediaryId.length >= 2 && intermediaryId.length <= 60) intermediaryMapped.id_intermediario = intermediaryId;
    else intermediaryProblems.push("informe o identificador de cadastro na plataforma (2 a 60 caracteres)");
  }
  const intermediaryCheckOk = intermediaryValid && intermediaryProblems.length === 0;
  if (intermediaryCheckOk) Object.assign(requestPreview, intermediaryMapped);
  add("intermediario", "Intermediador/marketplace", intermediaryCheckOk,
      intermediaryProblems.length ? intermediaryProblems.join("; ") :
      intermediaryWasProvided ? "Indicador e dados correspondentes enviados à Focus." :
      "O campo foi omitido no cadastro; a prévia usa o valor padrão 0 documentado pela Focus para operação sem intermediador.");

  const mappedItems: Json[] = [];
  const itemBasicMissing: string[] = [], itemCodeMissing: string[] = [], itemIbsMissing: string[] = [], itemCestIssues: string[] = [];
  const itemIcmsMissing: string[] = [], itemPisCofinsMissing: string[] = [], itemIbsDetailsMissing: string[] = [], itemFocusFieldIssues: string[] = [];
  let ibsCbsEnabledCount = 0;
  sourceItems.forEach((raw, index) => {
    const item = obj(raw), row: Json = { numero_item: index + 1 };
    const itemName = text(item.description) || text(item.sku) || "produto";
    const itemLabel = `Item ${index + 1} (${itemName})`;
    const put = (key: string, valid: boolean, mapped: unknown) => {
      if (valid && mapped !== undefined && mapped !== null && mapped !== "") row[key] = mapped;
      else itemBasicMissing.push(`${itemLabel}: campo ${key === "codigo_ncm" ? "NCM" : key === "cfop" ? "CFOP" : key.replaceAll("_", " ")} ausente ou inválido; corrija este campo na etapa Produtos da nota.`);
    };
    const productCode = text(item.sku), description = text(item.description);
    const ncm = text(item.ncm), cfop = text(item.cfop), unit = text(item.unit);
    const quantity = Number(item.quantity), unitPrice = Number(item.unitPriceCents) / 100;
    const gross = Number(item.subtotalCents) / 100;
    const originText = text(item.origin), origin = Number(originText), originValid = /^[0-8]$/.test(originText);
    put("codigo_produto", productCode.length > 0, productCode);
    put("descricao", description.length > 0, description);
    put("codigo_ncm", /^\d{8}$/.test(ncm), ncm);
    put("cfop", /^\d{4}$/.test(cfop), cfop);
    put("unidade_comercial", unit.length > 0, unit);
    put("quantidade_comercial", Number.isFinite(quantity) && quantity > 0, quantity);
    put("valor_unitario_comercial", Number.isFinite(unitPrice) && unitPrice >= 0, unitPrice);
    put("valor_bruto", Number.isFinite(gross) && gross >= 0, gross);
    put("icms_origem", originValid, origin);
    const rules = obj(item.taxRules);
    const csosn = text(item.csosn), pis = text(rules.pisCst), cofins = text(rules.cofinsCst);
    const ibsCbsEnabled = isIbsCbsEnabledForNfe(issuer, rules, payload.issueAt);
    if (ibsCbsEnabled) ibsCbsEnabledCount++;
    const taxRuleReview = reviewFocusTaxRule({ ...rules, csosn }, { includeIbsCbs: ibsCbsEnabled });
    const focusFields = taxRuleReview.focusFields;
    if (/^\d{3}$/.test(csosn) && supportedCsosn.has(csosn)) row.icms_situacao_tributaria = csosn;
    else itemCodeMissing.push(`${itemLabel}: informe um CSOSN compatível com o CRT no campo CSOSN do ICMS deste item.`);
    if (/^\d{2}$/.test(pis)) row.pis_situacao_tributaria = pis;
    else itemCodeMissing.push(`${itemLabel}: informe o CST do PIS no próprio item da nota.`);
    if (/^\d{2}$/.test(cofins)) row.cofins_situacao_tributaria = cofins;
    else itemCodeMissing.push(`${itemLabel}: informe o CST da Cofins no próprio item da nota.`);
    const cstIbs = text(rules.cstIbsCbs), classTrib = text(rules.classTrib);
    if (ibsCbsEnabled) {
      if (/^\d{3}$/.test(cstIbs) && /^\d{6}$/.test(classTrib)) {
        row.ibs_cbs_situacao_tributaria = cstIbs;
        row.ibs_cbs_classificacao_tributaria = classTrib;
      } else itemIbsMissing.push("Item " + (index + 1));
    }
    for (const [field, rawValue] of Object.entries(focusFields)) {
      if (!focusTaxFieldNames.has(field)) continue;
      const numericValue = rawValue;
      if (Number.isFinite(numericValue) && numericValue >= 0) row[field] = numericValue;
    }
    const missingIcms = [...new Set([...conditionalIcmsMissing(csosn, focusFields), ...taxRuleReview.icmsMissing])];
    if (!supportedCsosn.has(csosn)) missingIcms.push("CSOSN válido para o regime confirmado");
    for (const issue of taxRuleReview.unsupported) {
      if (issue.startsWith("CSOSN")) missingIcms.push(issue);
      else if (issue.startsWith("CST PIS") || issue.startsWith("CST COFINS")) itemPisCofinsMissing.push(`Item ${index + 1}: ${issue}`);
      else itemIbsDetailsMissing.push(`Item ${index + 1}: ${issue}`);
    }
    if (missingIcms.length) itemIcmsMissing.push(`${itemLabel}: faltam ${focusFieldList(missingIcms)}. Abra “Valores tributários numéricos (avançado)” neste item e informe os valores orientados para o CSOSN selecionado.`);
    if (taxRuleReview.invalidFields.length)
      itemFocusFieldIssues.push(`${itemLabel}: valores inválidos em ${focusFieldList(taxRuleReview.invalidFields)}. Corrija esses campos avançados neste item.`);
    for (const [prefix, cst] of [["pis", pis], ["cofins", cofins]] as const) {
      const expectedFields = conditionalPisCofinsFields(cst, prefix);
      const missing = missingTaxFields(expectedFields, focusFields);
      if (missing.length) itemPisCofinsMissing.push(`${itemLabel}: CST ${cst} de ${prefix.toUpperCase()} requer ${focusFieldList(missing)}. Preencha esses campos na seção avançada deste item.`);
      if (cst && !expectedFields.length && !["04", "06", "07", "08", "09"].includes(cst))
        itemPisCofinsMissing.push(`Item ${index + 1}: revisar o grupo condicional do ${prefix.toUpperCase()} para CST ${cst} com a tabela Focus e a contabilidade`);
    }
    if (taxRuleReview.ibsCbsMissing.length)
      itemIbsDetailsMissing.push(`Item ${index + 1}: ${taxRuleReview.ibsCbsMissing.join(", ")}`);
    const cestValue = item.cest;
    const rawCest = cestValue == null ? "" : String(cestValue).trim();
    const cest = rawCest.replace(/\D/g, "");
    const cestRequired = ["201", "202", "203", "500"].includes(csosn);
    if (rawCest && /^\d{7}$/.test(cest)) row.cest = cest;
    else if (rawCest) itemCestIssues.push(`${itemLabel}: CEST deve conter exatamente 7 dígitos; corrija o campo CEST deste item.`);
    if (cestRequired && !rawCest) itemCestIssues.push(`${itemLabel}: CEST obrigatório para CSOSN ${csosn} (Substituição Tributária). Preencha o campo CEST deste item.`);
    const gtin = textDigits(item.gtin);
    if (/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) row.codigo_barras_comercial = gtin;
    mappedItems.push(row);
  });
  const ibsCbsActive = ibsCbsEnabledCount > 0;
  const itemsComplete = sourceItems.length > 0 && itemBasicMissing.length === 0;
  requestPreview.items = mappedItems;
  add("itens", "Dados básicos dos itens", itemsComplete,
      itemBasicMissing.length ? itemBasicMissing.slice(0,8).join("; ") : "Código, descrição, NCM, CFOP, unidade, quantidade e valores mapeados.");
  add("codigos_tributarios", "CSOSN e CST de PIS/COFINS", itemCodeMissing.length === 0 && sourceItems.length > 0,
      itemCodeMissing.length ? itemCodeMissing.slice(0,8).join("; ") : "Códigos disponíveis no rascunho.");
  add("cest", "CEST dos itens com ICMS-ST", itemCestIssues.length === 0 && sourceItems.length > 0,
      itemCestIssues.length ? itemCestIssues.slice(0,8).join("; ") : "CEST de 7 dígitos informado quando aplicável; nenhum código foi presumido.");
  add("ibs_cbs", "CST/classificação IBS-CBS", !ibsCbsActive || (itemIbsMissing.length === 0 && sourceItems.length > 0),
      !ibsCbsActive ? "Não aplicável: IBS/CBS permanece fora do payload para Simples Nacional ou enquanto a flag de regime regular e a vigência futura não estiverem ativas." :
      itemIbsMissing.length ? itemIbsMissing.slice(0,8).join("; ") : "Códigos disponíveis; ainda precisam de conferência.");
  add("icms_campos_condicionais", "Campos de ICMS exigidos pelo CSOSN", itemIcmsMissing.length === 0 && sourceItems.length > 0,
      itemIcmsMissing.length ? itemIcmsMissing.slice(0,8).join("; ") : "A combinação exige apenas origem e CSOSN, ou não pede grupo numérico adicional.");
  add("pis_cofins_campos_condicionais", "Campos condicionais de PIS/Cofins", itemCodeMissing.length === 0 && itemPisCofinsMissing.length === 0 && sourceItems.length > 0,
      itemPisCofinsMissing.length ? itemPisCofinsMissing.slice(0,8).join("; ") : "Confira se os grupos numéricos exigidos para cada CST foram informados e revisados.");
  add("focus_campos_numericos", "Campos numéricos Focus", itemFocusFieldIssues.length === 0 && sourceItems.length > 0,
      itemFocusFieldIssues.length ? itemFocusFieldIssues.slice(0,8).join("; ") : "Campos numéricos permitidos e informados foram mapeados sem cálculo automático.");
  add("ibs_cbs_campos_condicionais", "Campos condicionais de IBS/CBS", !ibsCbsActive || (itemIbsMissing.length === 0 && itemIbsDetailsMissing.length === 0 && sourceItems.length > 0),
      !ibsCbsActive ? "Campos omitidos: Simples Nacional não envia IBS/CBS neste fluxo; a ativação futura exige flag explícita e vigência aplicável." :
      itemIbsDetailsMissing.length ? itemIbsDetailsMissing.slice(0,8).join("; ") :
      itemIbsMissing.length ? "Informe CST e cClassTrib orientados pela contabilidade." : "Grupo numérico ainda não cadastrado para as classificações deste item.");

  const transport = obj(payload.transport);
  const freightMode = transport.mode === "" || transport.mode == null ? NaN : Number(transport.mode);
  const freightValid = Number.isInteger(freightMode) && [0,1,2,3,4,9].includes(freightMode);
  add("modalidade_frete", "Modalidade do frete", freightValid,
      "Selecione a modalidade efetivamente contratada; não há valor padrão.", freightValid ? freightMode : undefined);
  const carrier = obj(transport.carrier);
  const carrierSelected = Object.keys(carrier).length > 0;
  const carrierProblems: string[] = [];
  if (carrierSelected) {
    const carrierName = text(carrier.legalName || carrier.name);
    const carrierNameValid = carrierName.length >= 2 && carrierName.length <= 60;
    if (carrierNameValid) requestPreview.nome_transportador = carrierName;
    else carrierProblems.push("nome/razão social do transportador (2 a 60 caracteres)");

    const carrierDocumentType = text(carrier.documentType).toLowerCase();
    const rawCarrierDocument = text(carrier.documentNumber);
    const carrierDocument = rawCarrierDocument.replace(/[.\-/\s]/g, "").toUpperCase();
    const alphaCarrierCnpj = carrierDocumentType === "cnpj" && /^[A-Z0-9]{12}\d{2}$/.test(carrierDocument) && /[A-Z]/.test(carrierDocument);
    if (carrierDocumentType === "cnpj" && cnpjDocumentIsValid(carrierDocument))
      requestPreview.cnpj_transportador = carrierDocument;
    else if (carrierDocumentType === "cpf" && cpfDocumentIsValid(carrierDocument))
      requestPreview.cpf_transportador = carrierDocument;
    else carrierProblems.push(alphaCarrierCnpj ?
      "CNPJ alfanumérico preservado, mas a referência Focus de homologação ainda define cnpj_transportador como Integer[14]; confirme o suporte antes de transmitir" :
      "CPF/CNPJ válido, com dígitos verificadores corretos e tipo compatível");

    const carrierIe = text(carrier.stateRegistration);
    if (carrierIe && /^.{2,14}$/.test(carrierIe)) requestPreview.inscricao_estadual_transportador = carrierIe;
    else if (carrierIe) carrierProblems.push("inscrição estadual do transportador (2 a 14 caracteres)");

    const carrierAddress = obj(carrier.address);
    const carrierAddressText = [carrierAddress.street, carrierAddress.number, carrierAddress.complement, carrierAddress.district]
      .map(text).filter(Boolean).join(", ");
    if (carrierAddressText.length >= 1 && carrierAddressText.length <= 60)
      requestPreview.endereco_transportador = carrierAddressText;
    else if (carrierAddressText.length > 60)
      carrierProblems.push("endereço do transportador excede 60 caracteres aceitos pela Focus");

    const carrierCity = text(carrierAddress.city);
    if (carrierCity.length >= 1 && carrierCity.length <= 60) requestPreview.municipio_transportador = carrierCity;
    else if (carrierCity) carrierProblems.push("município do transportador (1 a 60 caracteres)");

    const carrierUf = text(carrierAddress.state).toUpperCase();
    if (/^[A-Z]{2}$/.test(carrierUf)) requestPreview.uf_transportador = carrierUf;
    else if (carrierUf) carrierProblems.push("UF do transportador com duas letras");
  }
  const carrierValid = !carrierSelected || carrierProblems.length === 0;
  add("transportador", "Transportadora selecionada", carrierValid,
      !carrierSelected ? "Nenhuma transportadora vinculada; informe uma se a operação exigir." :
      carrierProblems.length ? carrierProblems.join("; ") :
      "Identificação e dados disponíveis mapeados para os campos Focus; confirme os dados cadastrais.");
  const vehicle = obj(transport.vehicle);
  const vehicleSelected = [vehicle.plate, vehicle.state, vehicle.rntc].some(value => text(value) !== "");
  const vehicleProblems: string[] = [];
  const mappedVehicle: Json = {};
  if (vehicleSelected) {
    const plate = text(vehicle.plate).toUpperCase();
    if (/^[A-Z0-9]{7}$/.test(plate)) mappedVehicle.veiculo_placa = plate;
    else vehicleProblems.push("placa de 7 letras ou números");
    const vehicleUf = text(vehicle.state).toUpperCase();
    if (vehicleUf) {
      if (/^[A-Z]{2}$/.test(vehicleUf)) mappedVehicle.veiculo_uf = vehicleUf;
      else vehicleProblems.push("UF do veículo com duas letras");
    }
    const rntc = text(vehicle.rntc);
    if (rntc) {
      if (rntc.length <= 20) mappedVehicle.veiculo_rntc = rntc;
      else vehicleProblems.push("RNTC/ANTT com até 20 caracteres");
    }
  }
  if (vehicleSelected && vehicleProblems.length === 0) Object.assign(requestPreview, mappedVehicle);
  add("veiculo_transporte", "Veículo de transporte", !vehicleSelected || vehicleProblems.length === 0,
      !vehicleSelected ? "Não informado; preencha quando a operação usar veículo identificado." :
      vehicleProblems.length ? vehicleProblems.join("; ") :
      "Placa e dados informados mapeados. A placa é exigida pelo leiaute quando o grupo de veículo é usado.");

  const rawVolumes = transport.volumes;
  const sourceVolumes = Array.isArray(rawVolumes) ? rawVolumes : [];
  const volumeProblems: string[] = [];
  const mappedVolumes: Json[] = [];
  if (rawVolumes != null && !Array.isArray(rawVolumes)) volumeProblems.push("A lista de volumes precisa ser válida.");
  if (sourceVolumes.length > 5000) volumeProblems.push("A lista de volumes excede 5000 itens.");
  sourceVolumes.forEach((rawVolume, index) => {
    const volume = obj(rawVolume), mapped: Json = {};
    const quantity = Number(volume.quantity);
    if (Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 999_999_999_999_999)
      mapped.quantidade = quantity;
    else volumeProblems.push(`Volume ${index + 1}: quantidade inteira positiva`);
    for (const [source, target] of [["species", "especie"], ["brand", "marca"], ["number", "numero"]]) {
      const fieldValue = text(volume[source]);
      if (fieldValue) {
        if (fieldValue.length <= 60) mapped[target] = fieldValue;
        else volumeProblems.push(`Volume ${index + 1}: ${target} excede 60 caracteres`);
      }
    }
    const netWeightMilli = volume.netWeightMilli;
    const grossWeightMilli = volume.grossWeightMilli;
    const validWeight = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 999_999_999_999_999;
    if (netWeightMilli != null) {
      if (validWeight(netWeightMilli)) mapped.peso_liquido = Number(netWeightMilli) / 1000;
      else volumeProblems.push(`Volume ${index + 1}: peso líquido positivo com até 3 casas decimais`);
    }
    if (grossWeightMilli != null) {
      if (validWeight(grossWeightMilli)) mapped.peso_bruto = Number(grossWeightMilli) / 1000;
      else volumeProblems.push(`Volume ${index + 1}: peso bruto positivo com até 3 casas decimais`);
    }
    if (validWeight(netWeightMilli) && validWeight(grossWeightMilli) && Number(netWeightMilli) > Number(grossWeightMilli))
      volumeProblems.push(`Volume ${index + 1}: peso líquido maior que o peso bruto`);
    mappedVolumes.push(mapped);
  });
  const volumesValid = volumeProblems.length === 0;
  if (volumesValid && mappedVolumes.length) requestPreview.volumes = mappedVolumes;
  add("volumes", "Volumes e pesos", volumesValid,
      !sourceVolumes.length && rawVolumes == null ? "Não informados; inclua-os quando fizerem parte da operação." :
      !sourceVolumes.length && !volumeProblems.length ? "Nenhum volume informado." :
      volumeProblems.length ? volumeProblems.slice(0, 8).join("; ") :
      "Quantidades, identificação e pesos informados convertidos para o formato Focus.");

  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  const paymentMethods = new Set(["01", "02", "03", "04", "05", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "90", "91", "99"]);
  const mappedPayments: Json[] = [];
  const paymentMissing: string[] = [];
  payments.forEach((raw, index) => {
    const payment = obj(raw);
    const indicator = Number(payment.indicator);
    const method = text(payment.method);
    const amountCents = integerCents(payment.amountCents);
    const mapped: Json = {};
    if (payment.indicator != null && Number.isInteger(indicator) && [0, 1].includes(indicator)) mapped.indicador_pagamento = indicator;
    else paymentMissing.push(`Pagamento ${index + 1}: indicador 0/1`);
    if (paymentMethods.has(method)) mapped.forma_pagamento = method;
    else paymentMissing.push(`Pagamento ${index + 1}: forma_pagamento Focus válida`);
    if (amountCents !== null) mapped.valor_pagamento = amountCents / 100;
    else paymentMissing.push(`Pagamento ${index + 1}: valor em centavos`);
    const paymentDate = text(payment.paymentDate);
    if (paymentDate) {
      const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(paymentDate);
      const parsedDate = dateMatch ? new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))) : null;
      const dateValid = Boolean(dateMatch && parsedDate && parsedDate.getUTCFullYear() === Number(dateMatch[1]) &&
        parsedDate.getUTCMonth() === Number(dateMatch[2]) - 1 && parsedDate.getUTCDate() === Number(dateMatch[3]));
      if (dateValid) mapped.data_pagamento = paymentDate;
      else paymentMissing.push(`Pagamento ${index + 1}: data de pagamento válida`);
    }
    if (method === "99") {
      const description = text(payment.description);
      if (description.length >= 2 && description.length <= 60) mapped.descricao_pagamento = description;
      else paymentMissing.push(`Pagamento ${index + 1}: descrição de 2 a 60 caracteres para a forma 99`);
    }
    if (["03", "04", "05"].includes(method)) {
      const integration = Number(payment.integration);
      if ([1, 2].includes(integration)) mapped.tipo_integracao = integration;
      else paymentMissing.push(`Pagamento ${index + 1}: tipo de integração para cartão`);
      if (integration === 1) {
        const acquirer = textDigits(payment.acquirerCnpj);
        const authorization = text(payment.authorizationNumber);
        if (/^\d{14}$/.test(acquirer) && cnpjDocumentIsValid(acquirer)) mapped.cnpj_credenciadora = acquirer;
        else paymentMissing.push(`Pagamento ${index + 1}: CNPJ da credenciadora`);
        if (authorization.length > 0 && authorization.length <= 128) mapped.numero_autorizacao = authorization;
        else paymentMissing.push(`Pagamento ${index + 1}: número de autorização`);
      }
    }
    mappedPayments.push(mapped);
  });
  const paymentsValid = payments.length === 0 || paymentMissing.length === 0;
  add("formas_pagamento", "Formas de pagamento", paymentsValid,
      payments.length === 0 ? "Coleção opcional da Focus; o rascunho ainda não captura pagamentos." :
      paymentMissing.length ? paymentMissing.slice(0, 8).join("; ") : "Campos comerciais convertidos para os nomes Focus.",
      payments.length > 0 && paymentsValid ? mappedPayments : undefined);
  const totals = obj(payload.additionalTotals);
  const totalFields: Array<[string, string, string]> = [
    ["freightCents", "valor_frete", "Frete"],
    ["insuranceCents", "valor_seguro", "Seguro"],
    ["discountCents", "valor_desconto", "Desconto"],
    ["expensesCents", "valor_outras_despesas", "Outras despesas"],
  ];
  const totalsMissing: string[] = [];
  totalFields.forEach(([source, focusField, label]) => {
    const rawAmount = Object.prototype.hasOwnProperty.call(totals, source) ? totals[source] : 0;
    const amount = integerCents(rawAmount);
    if (amount === null) totalsMissing.push(`${label}: valor não negativo em centavos`);
    else if (amount > 0) requestPreview[focusField] = amount / 100;
  });
  add("totais_adicionais", "Frete, seguro, desconto e despesas", totalsMissing.length === 0,
      totalsMissing.length ? totalsMissing.join("; ") : "Valores comerciais informados mapeados; tributos não são calculados nem presumidos.");
  const additionalInfo = text(payload.additionalInfo);
  const additionalInfoValid = additionalInfo.length <= 5000;
  if (additionalInfo && additionalInfoValid) requestPreview.informacoes_adicionais_contribuinte = additionalInfo;
  add("informacoes_adicionais", "Informações adicionais", additionalInfoValid,
      additionalInfoValid ? "Campo opcional do contribuinte convertido para o campo Focus." : "O texto pode ter até 5000 caracteres.");

  const productCents = sourceItems.reduce((sum, raw) => sum + (Number(obj(raw).subtotalCents) || 0), 0);
  const headerTotalCents = integerCents(payload.totalCents);
  const totalsMatch = sourceItems.length > 0 && Number.isSafeInteger(productCents) && productCents >= 0 &&
    headerTotalCents !== null && productCents === headerTotalCents;
  add("valor_produtos", "Totalização de produtos", totalsMatch,
      "A soma comercial d