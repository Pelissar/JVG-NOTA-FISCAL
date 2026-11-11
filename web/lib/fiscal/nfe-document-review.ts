/**
 * Checklist interno de preparação de NF-e. NÃO é leiaute XML, DANFE, nem
 * validação de schema, regras fiscais ou autorização da SEFAZ.
 * Não assume que um rascunho sem pendências está apto a emitir.
 */
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

export function reviewNfeDocument(value: unknown): NfeDocumentReview {
  const payload = obj(value), issuer = obj(payload.issuer), recipient = obj(payload.recipient);
  const preflight = obj(payload.preflight), preview = obj(payload.taxPreview);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  const checks: ReviewCheck[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string) =>
    checks.push({ key, label, ok, detail });
  const total = integerCents(payload.totalCents);

  const supportedSchema = payload.schemaVersion === 3 || payload.schemaVersion === 4 || payload.schemaVersion === 5;
  add("version", "Versão do rascunho", supportedSchema,
      payload.schemaVersion === 5 ? "Estrutura interna atual" :
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
  const profilesReviewed = items.length > 0 && items.every(row => {
    const profile = obj(obj(row).taxProfile);
    return text(profile.id) !== "" && profile.reviewStatus === "reviewed";
  });
  add("profiles", "Perfis tributários", profilesReviewed,
      "Todos os perfis vinculados devem ter revisão registrada");
  add("taxPreview", "Cálculo dos tributos",
      preview.validForEmission === true && preview.calculationMethod === "approved_rule_engine",
      "Impostos ainda não calculados por regras aprovadas; a conferência fiscal permanece bloqueada");
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
    commercialTotalCents: total,
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
  const issueAtParts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(issueAt);
  const issueAtCalendar = issueAtParts ? new Date(Date.UTC(Number(issueAtParts[1]), Number(issueAtParts[2]) - 1, Number(issueAtParts[3]))) : null;
  const issueAtValid = Boolean(issueAtParts && Number.isFinite(Date.parse(issueAt)) &&
    Number(issueAtParts[1]) >= 1900 && Number(issueAtParts[2]) >= 1 && Number(issueAtParts[2]) <= 12 &&
    Number(issueAtParts[3]) >= 1 && issueAtCalendar?.getUTCFullYear() === Number(issueAtParts[1]) &&
    issueAtCalendar?.getUTCMonth() === Number(issueAtParts[2]) - 1 && issueAtCalendar?.getUTCDate() === Number(issueAtParts[3]) &&
    Number(issueAtParts[4]) <= 23 && Number(issueAtParts[5]) <= 59 && Number(issueAtParts[6]) <= 59 &&
    Number(issueAtParts[10] || 0) <= 59 &&
    (Number(issueAtParts[9] || 0) < 14 || (Number(issueAtParts[9] || 0) === 14 && Number(issueAtParts[10] || 0) === 0)));
  add("data_emissao", "Data/hora de emissão", issueAtValid,
      "Informe data e hora explicitamente, com fuso horário.", issueAtValid ? issueAt : undefined);
  const finalConsumer = payload.consumerFinal;
  const finalConsumerValid = typeof finalConsumer === "boolean";
  add("consumidor_final", "Consumidor final", finalConsumerValid,
      "Precisa ser indicado por operação; não é inferido pelo tipo de pessoa.",
      finalConsumerValid ? (finalConsumer ? 1 : 0) : undefined);
  const presence = payload.buyerPresence === "" || payload.buyerPresence == null ? NaN : Number(payload.buyerPresence);
  const presenceValid = Number.isInteger(presence) && [0,1,2,3,4,5,9].includes(presence);
  add("presenca_comprador", "Presença do comprador", presenceValid,
      "Informe a condição real da operação; o ERP não infere presença ou canal de venda.", presenceValid ? presence : undefined);

  const cnpj = textDigits(issuer.cnpj), issuerName = text(issuer.legalName || issuer.name);
  const ie = text(issuer.stateRegistration);
  const regime = issuer.taxRegime === "simples_nacional" ? 1 :
    issuer.taxRegime === "lucro_presumido" || issuer.taxRegime === "lucro_real" ? 3 : null;
  add("cnpj_emitente", "CNPJ do emitente", /^\d{14}$/.test(cnpj),
      "Informe o CNPJ numérico do estabelecimento.", /^\d{14}$/.test(cnpj) ? cnpj : undefined);
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
  const recipientDocument = textDigits(recipient.documentNumber);
  const validCpf = recipientType === "cpf" && /^\d{11}$/.test(recipientDocument);
  const validCnpj = recipientType === "cnpj" && /^\d{14}$/.test(recipientDocument);
  const docOk = validCpf || validCnpj;
  add("documento_destinatario", "CPF/CNPJ do destinatário", docOk,
      "Documento nacional do destinatário; estrangeiro ainda não está mapeado.");
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

  const mappedItems: Json[] = [];
  const itemBasicMissing: string[] = [], itemCodeMissing: string[] = [], itemIbsMissing: string[] = [];
  const itemIcmsMissing: string[] = [], itemPisCofinsMissing: string[] = [], itemIbsDetailsMissing: string[] = [];
  sourceItems.forEach((raw, index) => {
    const item = obj(raw), row: Json = { numero_item: index + 1 };
    const put = (key: string, valid: boolean, mapped: unknown) => {
      if (valid && mapped !== undefined && mapped !== null && mapped !== "") row[key] = mapped;
      else itemBasicMissing.push("Item " + (index + 1) + " " + key);
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
    const focusFields = obj(rules.focusFields);
    const csosn = text(item.csosn), pis = text(rules.pisCst), cofins = text(rules.cofinsCst);
    if (/^\d{3}$/.test(csosn) && supportedCsosn.has(csosn)) row.icms_situacao_tributaria = csosn;
    else itemCodeMissing.push("Item " + (index + 1) + " CSOSN/ICMS");
    if (/^\d{2}$/.test(pis)) row.pis_situacao_tributaria = pis;
    else itemCodeMissing.push("Item " + (index + 1) + " CST PIS");
    if (/^\d{2}$/.test(cofins)) row.cofins_situacao_tributaria = cofins;
    else itemCodeMissing.push("Item " + (index + 1) + " CST COFINS");
    const cstIbs = text(rules.cstIbsCbs), classTrib = text(rules.classTrib);
    if (/^\d{3}$/.test(cstIbs) && /^\d{6}$/.test(classTrib)) {
      row.ibs_cbs_situacao_tributaria = cstIbs;
      row.ibs_cbs_classificacao_tributaria = classTrib;
    } else itemIbsMissing.push("Item " + (index + 1));
    for (const [field, rawValue] of Object.entries(focusFields)) {
      if (!focusTaxFieldNames.has(field)) continue;
      const numericValue = typeof rawValue === "number" ? rawValue :
        typeof rawValue === "string" && /^\d+(?:\.\d+)?$/.test(rawValue.trim()) ? Number(rawValue) : Number.NaN;
      if (Number.isFinite(numericValue) && numericValue >= 0) row[field] = numericValue;
    }
    const missingIcms = conditionalIcmsMissing(csosn, focusFields);
    if (!supportedCsosn.has(csosn)) missingIcms.push("CSOSN válido para o regime confirmado");
    if (missingIcms.length) itemIcmsMissing.push(`Item ${index + 1}: ${missingIcms.join(", ")}`);
    for (const [prefix, cst] of [["pis", pis], ["cofins", cofins]] as const) {
      const expectedFields = conditionalPisCofinsFields(cst, prefix);
      const missing = missingTaxFields(expectedFields, focusFields);
      if (missing.length) itemPisCofinsMissing.push(`Item ${index + 1}: ${missing.join(", ")}`);
      if (cst && !expectedFields.length && !["04", "06", "07", "08", "09"].includes(cst))
        itemPisCofinsMissing.push(`Item ${index + 1}: revisar o grupo condicional do ${prefix.toUpperCase()} para CST ${cst} com a tabela Focus e a contabilidade`);
    }
    if (cstIbs && classTrib) {
      if (cstIbs === "000") {
        const required = ["ibs_cbs_base_calculo", "ibs_uf_aliquota", "ibs_uf_valor", "ibs_mun_aliquota", "ibs_mun_valor", "cbs_aliquota", "cbs_valor"];
        const missing = missingTaxFields(required, focusFields);
        if (missing.length) itemIbsDetailsMissing.push(`Item ${index + 1}: ${missing.join(", ")}`);
      } else {
        itemIbsDetailsMissing.push(`Item ${index + 1}: campos IBS/CBS condicionais ao CST ${cstIbs} e classificação ${classTrib} precisam de definição e revisão específica`);
      }
    }
    const gtin = textDigits(item.gtin);
    if (/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) row.codigo_barras_comercial = gtin;
    mappedItems.push(row);
  });
  const itemsComplete = sourceItems.length > 0 && itemBasicMissing.length === 0;
  requestPreview.items = mappedItems;
  add("itens", "Dados básicos dos itens", itemsComplete,
      itemBasicMissing.length ? itemBasicMissing.slice(0,8).join("; ") : "Código, descrição, NCM, CFOP, unidade, quantidade e valores mapeados.");
  add("codigos_tributarios", "CSOSN e CST de PIS/COFINS", itemCodeMissing.length === 0 && sourceItems.length > 0,
      itemCodeMissing.length ? itemCodeMissing.slice(0,8).join("; ") : "Códigos disponíveis no rascunho.");
  add("ibs_cbs", "CST/classificação IBS-CBS", itemIbsMissing.length === 0 && sourceItems.length > 0,
      itemIbsMissing.length ? itemIbsMissing.slice(0,8).join("; ") : "Códigos disponíveis; ainda precisam de conferência.");
  add("icms_campos_condicionais", "Campos de ICMS exigidos pelo CSOSN", itemIcmsMissing.length === 0 && sourceItems.length > 0,
      itemIcmsMissing.length ? itemIcmsMissing.slice(0,8).join("; ") : "A combinação exige apenas origem e CSOSN, ou não pede grupo numérico adicional.");
  add("pis_cofins_campos_condicionais", "Campos condicionais de PIS/Cofins", itemCodeMissing.length === 0 && itemPisCofinsMissing.length === 0 && sourceItems.length > 0,
      itemPisCofinsMissing.length ? itemPisCofinsMissing.slice(0,8).join("; ") : "Confira se os grupos numéricos exigidos para cada CST foram informados e revisados.");
  add("ibs_cbs_campos_condicionais", "Campos condicionais de IBS/CBS", itemIbsMissing.length === 0 && itemIbsDetailsMissing.length === 0 && sourceItems.length > 0,
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
    const carrierDocument = rawCarrierDocument.replace(/[.\-/\s]/g, "");
    if (carrierDocumentType === "cnpj" && cnpjDocumentIsValid(carrierDocument))
      requestPreview.cnpj_transportador = carrierDocument;
    else if (carrierDocumentType === "cpf" && cpfDocumentIsValid(carrierDocument))
      requestPreview.cpf_transportador = carrierDocument;
    else carrierProblems.push("CPF/CNPJ válido, com dígitos verificadores corretos e tipo compatível");

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
    else volumeProblems.push(\`Volume \${index + 1}: quantidade inteira positiva\`);
    for (const [source, target] of [["species", "especie"], ["brand", "marca"], ["number", "numero"]]) {
      const fieldValue = text(volume[source]);
      if (fieldValue) {
        if (fieldValue.length <= 60) mapped[target] = fieldValue;
        else volumeProblems.push(\`Volume \${index + 1}: \${target} excede 60 caracteres\`);
      }
    }
    const netWeightMilli = volume.netWeightMilli;
    const grossWeightMilli = volume.grossWeightMilli;
    const validWeight = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 999_999_999_999_999;
    if (netWeightMilli != null) {
      if (validWeight(netWeightMilli)) mapped.peso_liquido = Number(netWeightMilli) / 1000;
      else volumeProblems.push(\`Volume \${index + 1}: peso líquido positivo com até 3 casas decimais\`);
    }
    if (grossWeightMilli != null) {
      if (validWeight(grossWeightMilli)) mapped.peso_bruto = Number(grossWeightMilli) / 1000;
      else volumeProblems.push(\`Volume \${index + 1}: peso bruto positivo com até 3 casas decimais\`);
    }
    if (validWeight(netWeightMilli) && validWeight(grossWeightMilli) && Number(netWeightMilli) > Number(grossWeightMilli))
      volumeProblems.push(\`Volume \${index + 1}: peso líquido maior que o peso bruto\`);
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
        if (/^\d{14}$/.test(acquirer)) mapped.cnpj_credenciadora = acquirer;
        else paymentMissing.push(`Pagamento ${index + 1}: CNPJ da credenciadora`);
        if (authorization.length > 0 && authorization.length <= 60) mapped.numero_autorizacao = authorization;
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
  const productCents = sourceItems.reduce((sum, raw) => sum + (Number(obj(raw).subtotalCents) || 0), 0);
  add("valor_produtos", "Totalização de produtos", Number.isSafeInteger(productCents) && productCents >= 0,
      "A soma comercial foi conferida; a Focus totaliza os itens. O total não é enviado duas vezes.");
  add("valor_total", "Total fiscal", false,
      "A Focus calcula os totais a partir dos itens e dos valores fiscais informados; esses grupos ainda estão incompletos.");
  return {
    environment: "homologacao",
    endpoint: "POST /v2/nfe?ref",
    requestPreview,
    checks,
    missingCount: checks.filter(check => !check.ok).length,
    autoAssignedFields: ["ref (ID fiscal interno)", "serie e numero (Focus, se a numeração automática estiver configurada)"],
    transmissionEnabled: false,
    canSend: false,
  };
}
