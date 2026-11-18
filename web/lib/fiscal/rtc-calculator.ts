/** Pure URL builder for the Receita Federal RTC calculators. */
export function rtcCalculatorUrl(baseValue: string, path: string, allowLocalHttp = false): URL {
  let base: URL;
  try { base = new URL(baseValue); } catch { throw new Error("invalid calculator URL"); }
  if (base.username || base.password || base.search || base.hash) throw new Error("invalid calculator URL");
  const localHttp = allowLocalHttp && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname);
  if (base.protocol !== "https:" && !localHttp) throw new Error("calculator URL must use HTTPS");
  if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(path)) throw new Error("invalid calculator path");

  let prefix = base.pathname.replace(/\/+$/, "");
  if (prefix.endsWith("/api/calculadora")) prefix = prefix.slice(0, -"/calculadora".length);
  if (prefix !== "" && prefix !== "/api") throw new Error("calculator base path must be origin, /api, or /api/calculadora");
  const apiRoot = prefix || "/api";
  base.pathname = `${apiRoot}/${path}`.replace(/\/{2,}/g, "/");
  return base;
}

export function rtcDecimal(value: unknown, field: string, options: { required?: boolean; integerDigits?: number; fractionalDigits?: number } = {}): string | null {
  const required = options.required !== false;
  if (value == null || value === "") {
    if (required) throw new Error(`${field}: informe o valor recebido da contabilidade.`);
    return null;
  }
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const integerDigits = options.integerDigits ?? 13;
  const fractionalDigits = options.fractionalDigits ?? 4;
  const pattern = new RegExp(`^\\d{1,${integerDigits}}(?:\\.\\d{1,${fractionalDigits}})?$`);
  if (!pattern.test(text)) throw new Error(`${field}: use um decimal não negativo, sem separador de milhar, com até ${integerDigits} dígitos inteiros e ${fractionalDigits} casas decimais.`);
  return text;
}

export function hasRtcValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Keep an explicitly submitted blank/null instead of silently restoring a product default. */
export function rtcSubmittedOrFallback(input: Record<string, unknown>, key: string, fallback: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : fallback;
}

/** Validate a date using the Gregorian calendar without local-timezone shifts. */
export function rtcCalendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

/** Validate the offset date-time required by the official regular-regime API. */
export function rtcOffsetDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !rtcCalendarDate(match[1])) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = match[4] == null ? 0 : Number(match[4]);
  const offsetHour = match[7] == null ? 0 : Number(match[7]);
  const offsetMinute = match[8] == null ? 0 : Number(match[8]);
  if (hour > 23 || minute > 59 || second > 59 || offsetMinute > 59 || offsetHour > 18 || (offsetHour === 18 && offsetMinute !== 0)) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** Build the regular-regime nominal-rate group using the official year rules. */
export function rtcRegularNominalRates(
  values: Record<string, unknown>,
  taxYear: number,
  itemNumber: number,
): Record<string, unknown> | null {
  const rateKeys = ["cbs", "ibsEstadual", "ibsMunicipal"] as const;
  const selective = values.impostoSeletivo && typeof values.impostoSeletivo === "object" && !Array.isArray(values.impostoSeletivo)
    ? values.impostoSeletivo as Record<string, unknown>
    : {};
  const hasAnyRate = rateKeys.some((key) => hasRtcValue(values[key]));
  const hasAnySelectiveRate = ["adValorem", "adRem"].some((key) => hasRtcValue(selective[key]));
  if (taxYear < 2027) {
    if (hasAnyRate || hasAnySelectiveRate) throw new Error(`Item ${itemNumber}: a calculadora oficial não aceita alíquotasNominais em fatos geradores até 2026. Apague esses valores.`);
    return null;
  }
  if (!hasAnyRate && !hasAnySelectiveRate) return null;
  const present = rateKeys.filter((key) => hasRtcValue(values[key]));
  if (present.length !== 0 && present.length !== rateKeys.length) {
    const missing = rateKeys.filter((key) => !hasRtcValue(values[key]));
    const labels: Record<(typeof rateKeys)[number], string> = { cbs: "CBS", ibsEstadual: "IBS estadual", ibsMunicipal: "IBS municipal" };
    throw new Error(`Item ${itemNumber}: para informar alíquotas nominais, preencha também ${missing.map((key) => labels[key]).join(", ")} com os valores confirmados para a operação.`);
  }
  const result: Record<string, unknown> = {};
  if (present.length === rateKeys.length) {
    for (const key of rateKeys) {
      const text = rtcDecimal(values[key], `Item ${itemNumber}, alíquota nominal ${key}`, { integerDigits: 3, fractionalDigits: 4 });
      const numeric = Number(text);
      if (numeric > 100) throw new Error(`Item ${itemNumber}: alíquotas nominais devem estar entre 0 e 100.`);
      result[key] = numeric;
    }
  }
  if (hasAnySelectiveRate) {
    const nominalSelective: Record<string, number> = {};
    for (const key of ["adValorem", "adRem"] as const) {
      if (!hasRtcValue(selective[key])) continue;
      const text = rtcDecimal(selective[key], `Item ${itemNumber}, alíquota do Imposto Seletivo ${key}`, { integerDigits: key === "adValorem" ? 3 : 13, fractionalDigits: 4 });
      const numeric = Number(text);
      if (key === "adValorem" && numeric > 100) throw new Error(`Item ${itemNumber}: a alíquota ad valorem do Imposto Seletivo deve estar entre 0 e 100.`);
      nominalSelective[key] = numeric;
    }
    result.impostoSeletivo = nominalSelective;
  }
  return Object.keys(result).length ? result : null;
}
