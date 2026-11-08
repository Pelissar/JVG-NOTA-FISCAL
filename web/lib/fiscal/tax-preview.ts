/**
 * Estimativa matemática não fiscal. Alíquotas são informadas pelo usuário e
 * NÃO são obtidas de legislação, regras do Simples ou integração externa.
 * Valores nunca podem autorizar transmissão, preencher XML ou substituir contador.
 */
export const PREVIEW_TAXES = ["pis", "cofins", "ibs", "cbs"] as const;
export type PreviewTax = typeof PREVIEW_TAXES[number];
export type PreviewRates = Partial<Record<PreviewTax, string>>;
export type PreviewLine = { tax: PreviewTax; ratePercent: string; estimateCents: number };
export type TaxPreview = {
  baseCents: number;
  lines: PreviewLine[];
  sumOfEstimatesCents: number;
  provisional: true;
  validForEmission: false;
};

export function parsePreviewRate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^(?:\d{1,3})(?:\.\d{1,4})?$/.test(value))
    throw new Error("Informe alíquota percentual com até 4 casas decimais e ponto decimal.");
  const [whole, frac = ""] = value.split(".");
  if (Number(whole) > 100 || (Number(whole) === 100 && Number(frac) > 0))
    throw new Error("Alíquota informada deve estar entre 0% e 100%.");
  return String(Number(whole)) + (frac ? "." + frac : "");
}

function rateUnits(rate: string): bigint {
  const [whole, fraction = ""] = rate.split(".");
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
}

export function calculateTaxPreview(baseCents: number, rates: PreviewRates): TaxPreview {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0 || baseCents > 100_000_000_000)
    throw new Error("Base comercial inválida para estimativa.");
  const lines: PreviewLine[] = [];
  for (const tax of PREVIEW_TAXES) {
    const rate = parsePreviewRate(rates[tax]);
    if (rate === null) continue;
    // Arredondamento aritmético HALF UP, com base em centavos; não é regra de XML.
    const estimate = (BigInt(baseCents) * rateUnits(rate) + 500000n) / 1000000n;
    lines.push({ tax, ratePercent: rate, estimateCents: Number(estimate) });
  }
  return {
    baseCents,
    lines,
    sumOfEstimatesCents: lines.reduce((sum, line) => sum + line.estimateCents, 0),
    provisional: true,
    validForEmission: false,
  };
}
