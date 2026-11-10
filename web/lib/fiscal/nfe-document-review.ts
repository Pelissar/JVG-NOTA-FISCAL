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

  const supportedSchema = payload.schemaVersion === 3 || payload.schemaVersion === 4;
  add("version", "Versão do rascunho", supportedSchema,
      payload.schemaVersion === 4 ? "Estrutura interna atual" :
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
  add("taxPreview", "Estimativa separada do valor da nota",
      preview.provisional === true && preview.validForEmission === false &&
      integerCents(preview.sumOfEstimatesCents) !== null,
      "Estimativas de percentuais informados não são impostos apurados");
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
  const textDigits = (raw: unknown) => text(raw).replace(/\\D/g, "");
  const nature = text(payload.nature);
  add("natureza_operacao", "Natureza da operação", nature.length >= 1 && nature.length <= 60,
      "A Focus aceita até 60 caracteres.", nature.length >= 1 && nature.length <= 60 ? nature : undefined);
  add("tipo_documento", "Tipo da NF-e", true, "Fluxo de NF-e de saída.", 1);
  const purpose = Number(payload.purpose);
  add("finalidade_emissao", "Finalidade da emissão",
      Number.isInteger(purpose) && [1,2,3,4,5,6].includes(purpose),
      "Precisa corresponder à finalidade real da operação.", Number.isInteger(purpose) ? purpose : undefined);
  const issuerUf = text(issuer.state).toUpperCase(), recipientUf = text(recipient.state).toUpperCase();
  const validUfs = /^[A-Z]{2}$/.test(issuerUf) && /^[A-Z]{2}$/.test(recipientUf);
  add("local_destino", "Local de destino", validUfs,
      "Derivado das UFs do emitente e destinatário.", validUfs ? (issuerUf === recipientUf ? 1 : 2) : undefined);
  add("data_emissao", "Data/hora de emissão", true,
      "Será criada no servidor no momento de transmitir; não é fixada no rascunho.");
  const finalConsumer = payload.consumerFinal;
  const finalConsumerValid = typeof finalConsumer === "boolean";
  add("consumidor_final", "Consumidor final", finalConsumerValid,
      "Precisa ser indicado por operação; não é inferido pelo tipo de pessoa.",
      finalConsumerValid ? (finalConsumer ? 1 : 0) : undefined);
  const presence = Number(payload.buyerPresence);
  const presenceValid = Number.isInteger(presence) && [0,1,2,3,4,5,9].includes(presence);
  add("presenca_comprador", "Presença do comprador", presenceValid,
      "Ainda não é capturada no rascunho.", presenceValid ? presence : undefined);

  const cnpj = textDigits(issuer.cnpj), issuerName = text(issuer.legalName || issuer.name);
  const ie = text(issuer.stateRegistration);
  const regime = issuer.taxRegime === "simples_nacional" ? 1 :
    issuer.taxRegime === "lucro_presumido" || issuer.taxRegime === "lucro_real" ? 3 : null;
  add("cnpj_emitente", "CNPJ do emitente", /^\\d{14}$/.test(cnpj),
      "Informe o CNPJ numérico do estabelecimento.", /^\\d{14}$/.test(cnpj) ? cnpj : undefined);
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
      const pattern = source === "cityCode" ? /^\\d{7}$/ : source === "postalCode" ? /^\\d{8}$/ : null;
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
  const validCpf = recipientType === "cpf" && /^\\d{11}$/.test(recipientDocument);
  const validCnpj = recipientType === "cnpj" && /^\\d{14}$/.test(recipientDocument);
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
  if (/^\\d{8}$/.test(recipientPostal)) requestPreview.cep_destinatario = recipientPostal;
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
  sourceItems.forEach((raw, index) => {
    const item = obj(raw), row: Json = { numero_item: index + 1 };
    const put = (key: string, valid: boolean, mapped: unknown) => {
      if (valid && mapped !== undefined && mapped !== null && mapped !== "") row[key] = mapped;
      else itemBasicMissing.push("Item " + (index + 1) + " " + key);
    };
    const productCode = text(item.sku), description = text(item.description);
    const ncm = text(item.ncm), cfop = text(item.cfop), unit = text(item.unit);
    const quantity = Number(item.quantity), unitPrice = Number(item.unitPriceCents) / 100;
    const gross = Number(item.subtotalCents) / 100, origin = Number(item.origin);
    put("codigo_produto", productCode.length > 0, productCode);
    put("descricao", description.length > 0, description);
    put("codigo_ncm", /^\\d{8}$/.test(ncm), ncm);
    put("cfop", /^\\d{4}$/.test(cfop), cfop);
    put("unidade_comercial", unit.length > 0, unit);
    put("quantidade_comercial", Number.isFinite(quantity) && quantity > 0, quantity);
    put("valor_unitario_comercial", Number.isFinite(unitPrice) && unitPrice >= 0, unitPrice);
    put("valor_bruto", Number.isFinite(gross) && gross >= 0, gross);
    put("icms_origem", Number.isInteger(origin) && origin >= 0 && origin <= 8, origin);
    const rules = obj(obj(item.taxProfile).rules);
    const csosn = text(item.csosn), pis = text(rules.pisCst), cofins = text(rules.cofinsCst);
    if (/^\\d{3}$/.test(csosn)) row.icms_situacao_tributaria = csosn;
    else itemCodeMissing.push("Item " + (index + 1) + " CSOSN/ICMS");
    if (/^\\d{2}$/.test(pis)) row.pis_situacao_tributaria = pis;
    else itemCodeMissing.push("Item " + (index + 1) + " CST PIS");
    if (/^\\d{2}$/.test(cofins)) row.cofins_situacao_tributaria = cofins;
    else itemCodeMissing.push("Item " + (index + 1) + " CST COFINS");
    const cstIbs = text(rules.cstIbsCbs), classTrib = text(rules.classTrib);
    if (/^\\d{3}$/.test(cstIbs) && /^\\d{6}$/.test(classTrib)) {
      row.ibs_cbs_situacao_tributaria = cstIbs;
      row.ibs_cbs_classificacao_tributaria = classTrib;
    } else itemIbsMissing.push("Item " + (index + 1));
    const gtin = textDigits(item.gtin);
    if (/^(?:\\d{8}|\\d{12}|\\d{13}|\\d{14})$/.test(gtin)) row.codigo_barras_comercial = gtin;
    mappedItems.push(row);
  });
  const itemsComplete = sourceItems.length > 0 && itemBasicMissing.length === 0;
  if (itemsComplete) requestPreview.itens = mappedItems;
  add("itens", "Dados básicos dos itens", itemsComplete,
      itemBasicMissing.length ? itemBasicMissing.slice(0,8).join("; ") : "Código, descrição, NCM, CFOP, unidade, quantidade e valores mapeados.");
  add("codigos_tributarios", "CSOSN e CST de PIS/COFINS", itemCodeMissing.length === 0 && sourceItems.length > 0,
      itemCodeMissing.length ? itemCodeMissing.slice(0,8).join("; ") : "Códigos disponíveis no rascunho.");
  add("ibs_cbs", "CST/classificação IBS-CBS", itemIbsMissing.length === 0 && sourceItems.length > 0,
      itemIbsMissing.length ? itemIbsMissing.slice(0,8).join("; ") : "Códigos disponíveis; ainda precisam de conferência.");
  add("detalhes_tributarios", "Cálculo tributário", false,
      "Bases, alíquotas e valores por CST/CSOSN ainda não estão estruturados; estimativas não podem ser enviadas.");

  const transport = obj(payload.transport), freightMode = Number(transport.mode);
  const freightValid = Number.isInteger(freightMode) && [0,1,2,3,4,9].includes(freightMode);
  add("modalidade_frete", "Modalidade do frete", freightValid,
      "Campo obrigatório da Focus ainda não é salvo no rascunho.", freightValid ? freightMode : undefined);
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  add("formas_pagamento", "Dados de pagamento", payments.length > 0,
      "O rascunho ainda não persiste meio, condição e valor de pagamento.",
      payments.length > 0 ? payments : undefined);
  const productCents = sourceItems.reduce((sum, raw) => sum + (Number(obj(raw).subtotalCents) || 0), 0);
  add("valor_produtos", "Total dos produtos", Number.isSafeInteger(productCents) && productCents >= 0,
      "Soma comercial em centavos; a Focus também calcula este total.",
      Number.isSafeInteger(productCents) && productCents >= 0 ? productCents / 100 : undefined);
  add("valor_total", "Total fiscal", false,
      "Depende dos tributos, frete, descontos e demais totais aprovados.");
  return {
    environment: "homologacao",
    endpoint: "POST /v2/nfe?ref",
    requestPreview,
    checks,
    missingCount: checks.filter(check => !check.ok).length,
    autoAssignedFields: ["ref (ID fiscal interno)", "data_emissao (gerada ao transmitir)", "serie e numero (Focus)"],
    transmissionEnabled: false,
    canSend: false,
  };
}
