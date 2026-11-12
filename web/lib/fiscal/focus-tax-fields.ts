export const focusTaxFieldNames = [
  "icms_modalidade_base_calculo", "icms_reducao_base_calculo", "icms_base_calculo", "icms_aliquota", "icms_valor",
  "icms_modalidade_base_calculo_st", "icms_margem_valor_adicionado_st", "icms_reducao_base_calculo_st",
  "icms_base_calculo_st", "icms_aliquota_st", "icms_valor_st", "icms_aliquota_credito_simples", "icms_valor_credito_simples",
  "icms_base_calculo_retido_st", "icms_valor_retido_st", "icms_valor_substituto", "icms_aliquota_final",
  "pis_base_calculo", "pis_aliquota_porcentual", "pis_quantidade_vendida", "pis_aliquota_valor", "pis_valor",
  "pis_base_calculo_st", "pis_aliquota_porcentual_st", "pis_quantidade_vendida_st", "pis_aliquota_valor_st", "pis_valor_st",
  "cofins_base_calculo", "cofins_aliquota_porcentual", "cofins_quantidade_vendida", "cofins_aliquota_valor", "cofins_valor",
  "cofins_base_calculo_st", "cofins_aliquota_porcentual_st", "cofins_quantidade_vendida_st", "cofins_aliquota_valor_st", "cofins_valor_st",
  "ibs_cbs_base_calculo", "ibs_uf_aliquota", "ibs_uf_valor", "ibs_mun_aliquota", "ibs_mun_valor", "cbs_aliquota", "cbs_valor",
] as const;

export type FocusTaxFields = Record<string, number>;
export type FocusTaxRuleReview = {
  focusFields: FocusTaxFields;
  icmsMissing: string[];
  pisCofinsMissing: string[];
  ibsCbsMissing: string[];
  invalidFields: string[];
  unsupported: string[];
};

const allowedFocusFields = new Set<string>(focusTaxFieldNames);
const supportedCsosn = new Set(["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]);
const supportedPisCofinsCst = new Set(["01", "02", "03", "04", "05", "06", "07", "08", "09"]);
const icmsStFields = [
  "icms_modalidade_base_calculo_st", "icms_margem_valor_adicionado_st", "icms_reducao_base_calculo_st",
  "icms_base_calculo_st", "icms_aliquota_st", "icms_valor_st",
];
const icmsBasicFields = [
  "icms_modalidade_base_calculo", "icms_base_calculo", "icms_reducao_base_calculo", "icms_aliquota", "icms_valor",
];
const icmsRetainedStFields = ["icms_base_calculo_retido_st", "icms_valor_retido_st", "icms_aliquota_final", "icms_valor_substituto"];
const icmsCreditFields = ["icms_aliquota_credito_simples", "icms_valor_credito_simples"];
const ibsCbs000Fields = [
  "ibs_cbs_base_calculo", "ibs_uf_aliquota", "ibs_uf_valor", "ibs_mun_aliquota", "ibs_mun_valor", "cbs_aliquota", "cbs_valor",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseNumericField(name: string, value: unknown): number | null {
  let numeric: number;
  if (typeof value === "number") numeric = value;
  else if (typeof value === "string") {
    const text = value.trim();
    if (!text || text.length > 32 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
    numeric = Number(text);
  } else return null;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if ((name === "icms_modalidade_base_calculo" || name === "icms_modalidade_base_calculo_st") && !Number.isInteger(numeric)) return null;
  return numeric;
}

export function inspectFocusTaxFields(raw: unknown): { fields: FocusTaxFields; invalid: string[] } {
  if (raw == null) return { fields: {}, invalid: [] };
  if (!isRecord(raw)) return { fields: {}, invalid: ["focusFields"] };
  const fields: FocusTaxFields = {};
  const invalid: string[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (value == null || value === "") continue;
    if (!allowedFocusFields.has(name)) {
      invalid.push(name);
      continue;
    }
    const numeric = parseNumericField(name, value);
    if (numeric === null) {
      invalid.push(name);
      continue;
    }
    fields[name] = numeric;
  }
  return { fields, invalid };
}

export function parseFocusTaxFields(raw: unknown): FocusTaxFields {
  const result = inspectFocusTaxFields(raw);
  if (result.invalid.length) throw new Error(`Campos numéricos Focus inválidos: ${result.invalid.join(", ")}.`);
  return result.fields;
}

function missing(fields: string[], values: FocusTaxFields): string[] {
  return fields.filter(name => values[name] === undefined);
}

function anyPresent(fields: string[], values: FocusTaxFields): boolean {
  return fields.some(name => values[name] !== undefined);
}

function pisCofinsFields(cst: string, prefix: "pis" | "cofins"): string[] | null {
  if (cst === "01" || cst === "02") return [`${prefix}_base_calculo`, `${prefix}_aliquota_porcentual`, `${prefix}_valor`];
  if (cst === "03") return [`${prefix}_quantidade_vendida`, `${prefix}_aliquota_valor`, `${prefix}_valor`];
  if (cst === "05") return [`${prefix}_base_calculo_st`, `${prefix}_aliquota_porcentual_st`, `${prefix}_valor_st`];
  if (supportedPisCofinsCst.has(cst)) return [];
  return null;
}

export function reviewFocusTaxRule(rule: Record<string, unknown>): FocusTaxRuleReview {
  const inspected = inspectFocusTaxFields(rule.focusFields);
  const focusFields = inspected.fields;
  const result: FocusTaxRuleReview = {
    focusFields, icmsMissing: [], pisCofinsMissing: [], ibsCbsMissing: [],
    invalidFields: inspected.invalid, unsupported: [],
  };
  const csosn = typeof rule.csosn === "string" ? rule.csosn.trim() : "";
  if (!supportedCsosn.has(csosn)) {
    result.unsupported.push(`CSOSN ${csosn || "(vazio)"} ainda não tem mapeamento completo.`);
  } else if (csosn === "101") {
    result.icmsMissing.push(...missing(["icms_aliquota_credito_simples", "icms_valor_credito_simples"], focusFields));
  } else if (csosn === "201") {
    result.icmsMissing.push(...missing([...icmsStFields, "icms_aliquota_credito_simples", "icms_valor_credito_simples"], focusFields));
  } else if (csosn === "202" || csosn === "203") {
    result.icmsMissing.push(...missing(icmsStFields, focusFields));
  } else if (csosn === "900") {
    const basicPresent = anyPresent(icmsBasicFields, focusFields);
    const stPresent = anyPresent(icmsStFields, focusFields);
    if (basicPresent === stPresent)
      result.icmsMissing.push("CSOSN 900 exige exatamente um dos grupos opcionais de ICMS ou ICMS-ST.");
    if (basicPresent) result.icmsMissing.push(...missing(icmsBasicFields, focusFields));
    if (stPresent) result.icmsMissing.push(...missing(icmsStFields, focusFields));
    if (anyPresent(icmsCreditFields, focusFields)) result.icmsMissing.push(...missing(icmsCreditFields, focusFields));
  } else if (csosn === "500" && anyPresent(icmsRetainedStFields, focusFields)) {
    result.icmsMissing.push(...missing(icmsRetainedStFields, focusFields));
  }
  for (const [prefix, rawCst] of [["pis", rule.pisCst], ["cofins", rule.cofinsCst]] as const) {
    const cst = typeof rawCst === "string" ? rawCst.trim() : "";
    const fields = pisCofinsFields(cst, prefix);
    if (fields === null) result.unsupported.push(`CST ${prefix.toUpperCase()} ${cst || "(vazio)"} ainda não tem grupo Focus mapeado.`);
    else result.pisCofinsMissing.push(...missing(fields, focusFields));
  }
  const cstIbsCbs = typeof rule.cstIbsCbs === "string" ? rule.cstIbsCbs.trim() : "";
  const classTrib = typeof rule.classTrib === "string" ? rule.classTrib.trim() : "";
  if (cstIbsCbs === "000" && (classTrib === "000001" || classTrib === "000005")) {
    result.ibsCbsMissing.push(...missing(ibsCbs000Fields, focusFields));
  } else if (cstIbsCbs || classTrib) {
    result.unsupported.push(`Combinação IBS/CBS ${cstIbsCbs || "(CST vazio)"}/${classTrib || "(classificação vazia)"} ainda não tem grupo Focus mapeado.`);
  }
  return result;
}
