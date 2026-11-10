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

  add("version", "Versão do rascunho", payload.schemaVersion === 3,
      payload.schemaVersion === 3 ? "Estrutura interna atual" : "Rascunho legado: refaça a preparação");
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
